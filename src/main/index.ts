import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { join, basename } from 'node:path'
import { access, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  IMAGE_SCHEME,
  type DataSnapshot,
  type ImageRef,
  type LayoutDoc,
  type OpenResult,
  type RecentEntry,
  type SessionSnapshot
} from '../shared/types'
import { parseLayoutDoc } from '../shared/layout'
import {
  addRecent,
  clearRecents,
  listRecents,
  readKeymap,
  readSession,
  removeRecent,
  writeKeymap,
  writeSession
} from './userStore'
import { resolveKeymap, sanitiseKeymap, type Keymap, type ResolvedKeymap } from '../shared/actions'
import { addPack, currentSnapshot, loadPacks, removePack, setDatasetEnabled } from './packStore'
import { IMAGE_EXTENSIONS, imageId, mimeFor, registerImage, servedPath } from './imageStore'
import { buildMenu, type DataActions } from './menu'

const LAYOUT_FILTERS = [
  { name: 'DM Screen Layout', extensions: ['dmscreen', 'json'] },
  { name: 'All Files', extensions: ['*'] }
]

let mainWindow: BrowserWindow | null = null
/** Mirrors the renderer's unsaved-changes flag so we can warn on close. */
let documentDirty = false
let documentName = 'Untitled layout'
/** Set once the user has confirmed a close, so the second close event passes. */
let forceClose = false
/** Set by before-quit so a confirmed close resumes Cmd+Q instead of only hiding its window. */
let quitRequested = false
/**
 * The user's keybinding overrides, sparse. Main owns them because main builds
 * the menu that carries the accelerators; the renderer gets a resolved copy for
 * its labels.
 */
let keymapOverrides: Keymap = {}

function fileNameFor(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '-').trim()
  return `${safe || 'layout'}.dmscreen`
}

async function readLayoutFile(path: string): Promise<LayoutDoc> {
  const raw = await readFile(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${basename(path)} is not valid JSON.`)
  }
  const doc = parseLayoutDoc(parsed)
  if (!doc) throw new Error(`${basename(path)} is not a valid DM Screen layout.`)
  return doc
}

async function writeLayoutFile(path: string, doc: LayoutDoc): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  )
}

/** Pushes fresh data to the renderer and rebuilds the menu around it. */
async function applySnapshot(snapshot: DataSnapshot): Promise<void> {
  mainWindow?.webContents.send('data:changed', snapshot)
  await refreshMenu()
}

const DATAPACK_FILTERS = [
  { name: 'DM Screen Data Pack', extensions: ['dmpack.json', 'dmpack', 'json'] },
  { name: 'All Files', extensions: ['*'] }
]

const IMAGE_FILTERS = [
  { name: 'Images', extensions: IMAGE_EXTENSIONS },
  { name: 'All Files', extensions: ['*'] }
]

/* ------------------------------------------------------------------ images */

/**
 * Must run before `app.whenReady()`, which is why it is a bare statement rather
 * than a step inside the ready handler: Chromium reads the scheme registry once
 * during startup, and a scheme registered after that point is handled but never
 * treated as secure — the page then refuses the image as insecure content, with
 * nothing in the handler to show for it.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

/**
 * Serves a registered image, and nothing else.
 *
 * The bytes are streamed rather than read into a buffer, which is the reason
 * this exists at all instead of the renderer asking for a `data:` URL over IPC:
 * a battle map arrives as a decoded bitmap Chromium owns and can drop, not as a
 * base64 string a third larger than the file sitting in renderer memory for as
 * long as the panel is open.
 *
 * The Content-Type is set from the extension rather than passed through. A
 * `file:` fetch guesses, and a guess of `text/plain` is a blank panel with no
 * error anywhere.
 */
function serveImages(): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const id = new URL(request.url).pathname.replace(/^\//, '')
    const path = servedPath(id)
    const mime = path && mimeFor(path)
    if (!path || !mime) return new Response('Unknown image', { status: 404 })

    try {
      const file = await net.fetch(pathToFileURL(path).toString())
      if (!file.ok) return new Response('Unreadable image', { status: 404 })
      return new Response(file.body, { headers: { 'Content-Type': mime } })
    } catch {
      // A map on a drive that is no longer mounted. The panel already draws a
      // missing-file state from `exists`; this is only the race where the file
      // goes between the check and the read.
      return new Response('Unreadable image', { status: 404 })
    }
  })
}

/**
 * Puts a path on the guest list and reports whether it is still there.
 *
 * Two callers, one path: the file dialog below, and the renderer restoring a
 * panel out of a layout that was saved on some earlier day. The second is why
 * `exists` is answered here rather than assumed — a `.dmscreen` copied to
 * another machine names files that are not on it.
 */
async function resolveImage(path: string): Promise<ImageRef> {
  const id = registerImage(path)
  if (!id) return { id: imageId(path), path, exists: false }
  try {
    await access(path)
    return { id, path, exists: true }
  } catch {
    return { id, path, exists: false }
  }
}

const dataActions: DataActions = {
  importPack: () => {
    void (async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import data pack',
        properties: ['openFile'],
        filters: DATAPACK_FILTERS
      })
      const path = result.filePaths[0]
      if (result.canceled || !path) return

      const snapshot = await addPack(path)
      if (!snapshot) {
        // Adjacent extensions and the same dialog — picking a .dmscreen by
        // mistake is easy, so say what happened rather than doing nothing.
        await dialog.showMessageBox(mainWindow!, {
          type: 'error',
          message: `${basename(path)} is not a valid data pack.`,
          detail: 'A data pack is a JSON file with a formatVersion, an id and a name.'
        })
        return
      }
      await applySnapshot(snapshot)
    })()
  },

  reloadPacks: () => {
    void loadPacks().then(applySnapshot)
  },

  removePack: (id) => {
    void removePack(id).then(applySnapshot)
  },

  setEnabled: (datasets, value) => {
    void setDatasetEnabled(datasets, value).then(applySnapshot)
  }
}

async function refreshMenu(): Promise<void> {
  buildMenu(
    await listRecents(),
    currentSnapshot(),
    resolveKeymap(keymapOverrides),
    (action, payload) => mainWindow?.webContents.send('menu:action', action, payload),
    dataActions
  )
}

/**
 * Persists a rebinding, rebuilds the menu around it and tells the renderer, so a
 * changed shortcut takes effect on the accelerator and on every label at once
 * without a restart.
 */
async function applyKeymap(overrides: Keymap): Promise<ResolvedKeymap> {
  keymapOverrides = sanitiseKeymap(overrides).keymap
  await writeKeymap(keymapOverrides)
  const resolved = resolveKeymap(keymapOverrides)
  mainWindow?.webContents.send('keymap:changed', resolved)
  await refreshMenu()
  return resolved
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * One thing a smoke shot does before its screenshot. Exactly one field is set —
 * `scripts/smoke.mjs` rejects a step with none or several before the spawn, so
 * this side dispatches on whichever it finds and needs no fallback.
 */
interface SmokeStep {
  menu?: string
  click?: string
  press?: Record<string, unknown>
  type?: { selector: string; text: string }
  select?: { selector: string; start: number; end: number }
  wheel?: { selector: string; deltaY: number; offsetX?: number; offsetY?: number }
  hover?: string
  wait?: number
}

/**
 * The steps as the driver compiled them.
 *
 * Ordered, and repeatable per kind, because the interesting states are the ones
 * two inputs apart: a reason shown for a greyed palette row and then a fresh
 * query typed over it is a transition no single input reaches. Five separate
 * environment variables fired in a fixed order could not express it — `type`
 * always ran after `press`, so "narrow the list, then walk it" was unreachable.
 */
function readSteps(): SmokeStep[] {
  const raw = (process.env['DMSCREEN_SMOKE_STEPS'] ?? '').trim()
  return raw ? (JSON.parse(raw) as SmokeStep[]) : []
}

async function runStep(window: BrowserWindow, step: SmokeStep): Promise<void> {
  // A menu command, for UI that has no other way in. The About and Keyboard
  // Shortcuts dialogs open from the native menu only, and a native menu is not
  // something a CSS selector can reach — without this they had no coverage.
  if (step.menu !== undefined) {
    window.webContents.send('menu:action', step.menu)
    return wait(400)
  }

  if (step.click !== undefined) {
    // Focus as well as click, so hover/focus-revealed UI (the condition
    // cross-reference popovers) can be captured too.
    // executeJavaScript resolves as `any`; the script below returns a boolean
    // and nothing else can change that, so name the type here.
    const found = (await window.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(step.click)})
        el?.focus?.()
        el?.click?.()
        return !!el
      })()`
    )) as boolean
    if (!found) console.log(`[renderer:error] no element matched ${step.click}`)
    return wait(500)
  }

  // A synthetic keypress. The only way to photograph a half-typed two-stroke
  // sequence: its prefix is a key, not a control, so there is nothing for
  // `click` to select.
  //
  // Dispatched at the focused element rather than at `window`. A real keydown
  // starts there and bubbles, so a window listener — the chord dispatcher, the
  // Escape chain — hears it either way, while a React `onKeyDown` on the
  // focused control only hears it this way: React listens at the root, which is
  // below `window` and never on an event's path when `window` is the target.
  // Dispatching at `window` therefore reached the app-wide listeners and
  // nothing else, which put the action palette's own arrow keys out of reach.
  if (step.press !== undefined) {
    await window.webContents.executeJavaScript(
      `(() => {
        const init = ${JSON.stringify(step.press)}
        const target = document.activeElement ?? window
        target.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
        )
        return true
      })()`
    )
    return wait(400)
  }

  // Type into one field. Needed for anything whose interesting state is a
  // *query* — the action palette filtering itself, say — where clicking gets
  // you to the box and no further.
  //
  // The write goes through the native value setter rather than `el.value`
  // because React tracks the last value it wrote on the node itself: a plain
  // assignment updates the DOM but leaves the tracker agreeing with it, so the
  // change event that follows is discarded as a no-op.
  if (step.type !== undefined) {
    const typed = (await window.webContents.executeJavaScript(
      `(() => {
        const { selector, text } = ${JSON.stringify(step.type)}
        const el = document.querySelector(selector)
        if (!el) return false
        // The prototype is taken from the element, not assumed to be
        // HTMLInputElement: calling an input's setter on a textarea throws
        // "Illegal invocation", which put every textarea beyond this step.
        const proto =
          el instanceof window.HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`
    )) as boolean
    if (!typed) console.log(`[renderer:error] nothing to type into: ${step.type.selector}`)
    return wait(400)
  }

  // Put a selection range on a field. `type` leaves the caret at the end and a
  // synthetic Ctrl+A performs no default action, so without this there was no
  // way to reach any behaviour that acts on selected text — Ctrl+B and Ctrl+I
  // over a word being the ones that need it.
  if (step.select !== undefined) {
    const selected = (await window.webContents.executeJavaScript(
      `(() => {
        const { selector, start, end } = ${JSON.stringify(step.select)}
        const el = document.querySelector(selector)
        if (!el) return false
        el.focus()
        el.setSelectionRange(start, end)
        return true
      })()`
    )) as boolean
    if (!selected) console.log(`[renderer:error] nothing to select in: ${step.select.selector}`)
    return wait(400)
  }

  // A wheel notch over one element, for behaviour a click cannot express. Zoom
  // is the case: it has buttons too, but the wheel is the path with the
  // interesting parts on it — the listener has to be the element's own and
  // non-passive to refuse the scroll, and the zoom is aimed at the pointer
  // rather than at the centre, neither of which a button press exercises.
  //
  // `offsetX`/`offsetY` move the pointer off centre, which is the only way to
  // tell an aimed zoom from a centred one: from the middle the two agree.
  if (step.wheel !== undefined) {
    const found = (await window.webContents.executeJavaScript(
      `(() => {
        const { selector, deltaY, offsetX, offsetY } = ${JSON.stringify(step.wheel)}
        const el = document.querySelector(selector)
        if (!el) return false
        const box = el.getBoundingClientRect()
        el.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY,
            clientX: box.left + box.width / 2 + (offsetX ?? 0),
            clientY: box.top + box.height / 2 + (offsetY ?? 0)
          })
        )
        return true
      })()`
    )) as boolean
    if (!found) console.log(`[renderer:error] no element matched ${step.wheel.selector}`)
    return wait(400)
  }

  // Park the pointer on one control, for UI that only a hover reveals.
  // Dispatched as `pointerover`, not `pointerenter`: React listens at the root
  // and synthesises enter from the bubbling event, so an enter event sent
  // straight to the element goes unheard.
  if (step.hover !== undefined) {
    const found = (await window.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(step.hover)})
        if (!el) return false
        const box = el.getBoundingClientRect()
        const init = {
          bubbles: true,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
          pointerType: 'mouse'
        }
        el.dispatchEvent(new PointerEvent('pointerover', init))
        el.dispatchEvent(new MouseEvent('mouseover', init))
        return true
      })()`
    )) as boolean
    if (!found) console.log(`[renderer:error] no element matched ${step.hover}`)
    return
  }

  // A dwell mid-sequence, for a step whose effect is on a timer. The shot-level
  // `settle` is the same thing at the end, where most shots want it.
  if (step.wait !== undefined) return wait(step.wait)
}

/** Backstop for an app that never booted, not a dwell anyone is meant to pay. */
const READY_TIMEOUT_MS = 20_000
const READY_POLL_MS = 50

/**
 * Block until the renderer has restored its session and painted it.
 *
 * This replaced a flat 1800 ms dwell, and the reason is not only that the dwell
 * was usually longer than the wait it stood in for. It was *fixed*, and a fixed
 * wait has no way to be right on two machines: too short and the shot drives an
 * app still showing its pre-restore state, too long and every shot in the suite
 * pays for the slowest. Under the parallel driver the short end stopped being
 * theoretical
 * — several Electrons starting at once on a 4-core runner is exactly the load
 * that stretches a restore past a constant.
 *
 * The failure that avoids matters more than the seconds it saves. A dwell that
 * expires early does not time out; it photographs the wrong screen and fails an
 * expectation, which reads as a broken feature rather than a slow one. A poll
 * gets slower under load instead of getting wrong.
 *
 * `data-ready` comes from an effect in `App.tsx`, so it cannot appear before the
 * commit that rendered the restored layout. Fonts are awaited because the emoji
 * font is scoped and load-bearing, and two frames because the DOM being right is
 * not yet the window being painted — the expectations would not notice, but the
 * screenshot is the half of this harness that only an eye checks.
 */
async function waitForReady(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ready = (await window.webContents.executeJavaScript(
      `document.documentElement.dataset.ready === 'true'`
    )) as boolean
    if (ready) {
      await window.webContents.executeJavaScript(
        `(async () => {
          await document.fonts.ready
          // Self-limiting: a window that never gets a frame would otherwise hang
          // here until the driver's own timeout, turning a slow shot into a
          // mystery one.
          await new Promise((done) => {
            const bail = setTimeout(() => done(true), 500)
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                clearTimeout(bail)
                done(true)
              })
            )
          })
          return true
        })()`
      )
      return
    }
    await wait(READY_POLL_MS)
  }
  // Reported the way a renderer crash is, so the driver fails the shot and the
  // screenshot still lands: an app that never restored is worth looking at.
  console.log('[renderer:error] the app never finished restoring its session')
}

/** How long an expectation is given to come true before the shot is failed. */
const EXPECT_TIMEOUT_MS = 3000
const EXPECT_POLL_MS = 150

/**
 * Check what the shot claims to show, retrying until it holds or time runs out.
 *
 * The steps before this each dwell a fixed 400-500 ms, which is generous for a
 * React state update and stops being generous when four shots share four cores.
 * Retrying is what keeps that from being a flake: a UI that is merely late
 * arrives on a later poll, and one that is actually broken still fails, having
 * cost the run three seconds it only spends on red.
 *
 * The whole spec has to pass in a *single* evaluation. Accumulating passes
 * across polls would let `found` and `missing` be satisfied at different
 * instants, which is a state the app may never actually have been in.
 */
async function checkExpectations(window: BrowserWindow, spec: string): Promise<string[]> {
  const deadline = Date.now() + EXPECT_TIMEOUT_MS
  for (;;) {
    const failures = (await window.webContents.executeJavaScript(
      `(() => {
        const spec = ${spec}
        const failed = []
        // Present *and* laid out. A display:none match would otherwise
        // pass, which is the same false green as photographing an
        // absent feature.
        for (const selector of spec.found ?? []) {
          const el = document.querySelector(selector)
          if (!el) failed.push('nothing matched ' + selector)
          else if (!el.getClientRects().length) failed.push('not visible: ' + selector)
        }
        for (const selector of spec.missing ?? []) {
          if (document.querySelector(selector)) failed.push('expected no match for ' + selector)
        }
        const text = document.body.innerText
        for (const needle of spec.text ?? []) {
          if (!text.includes(needle)) failed.push('text not present: ' + needle)
        }
        return failed
      })()`
    )) as string[]

    if (!failures.length || Date.now() >= deadline) return failures
    await wait(EXPECT_POLL_MS)
  }
}

/**
 * Development aid, inert unless DMSCREEN_SMOKE_SHOT is set: forwards renderer
 * console messages to stdout, checks what the shot claims to show, then
 * screenshots the window and exits. Used by `scripts/smoke.mjs` to check the UI
 * actually renders in a headless container.
 */
function installSmokeHook(window: BrowserWindow): void {
  const shotPath = process.env['DMSCREEN_SMOKE_SHOT']
  if (!shotPath) return

  const levels = ['verbose', 'info', 'warning', 'error'] as const
  window.webContents.on('console-message', (_event, level, message, line, source) => {
    console.log(`[renderer:${levels[level] ?? level}] ${message} (${source}:${line})`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.log(`[renderer:error] render process gone: ${details.reason}`)
    app.exit(1)
  })

  /**
   * The screenshot, retried.
   *
   * `capturePage()` rejects with `UnknownVizError` when Chromium's compositor
   * has no frame sink ready yet. It is a cold-start problem — it has taken out
   * the *first* shot of a CI run twice, while the other 45 passed — so the fix
   * is to ask again rather than to lengthen the fixed wait every shot already
   * pays.
   *
   * An empty image counts as a failure too. Nothing downstream would catch one:
   * the expectations are checked in the renderer and pass regardless of what the
   * capture returned, so a blank PNG is the exact false green this harness
   * exists to prevent.
   *
   * Logged as `[smoke:retry]`, which the driver prints but does not fail on — a
   * shot that needed two goes is worth seeing without being worth failing.
   */
  const capturePng = async (): Promise<Buffer> => {
    let last: Error | null = null
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const image = await window.webContents.capturePage()
        if (image.isEmpty()) throw new Error('capturePage returned an empty image')
        return image.toPNG()
      } catch (error) {
        last = error as Error
        console.log(`[smoke:retry] capture attempt ${attempt} failed: ${last.message}`)
        await wait(600)
      }
    }
    throw last ?? new Error('capturePage never returned an image')
  }

  window.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        await waitForReady(window)

        // Everything the shot does before the capture, in the order it declared.
        // The driver has already validated the list and desugared the shorthand
        // fields into it, so each step here has exactly one action set.
        for (const step of readSteps()) {
          await runStep(window, step)
        }

        // Extra dwell for shots of something that changes over time — and for a
        // hover the reveal delay has to run out inside.
        const settle = Number(process.env['DMSCREEN_SMOKE_SETTLE'] ?? 0)
        if (Number.isFinite(settle) && settle > 0) await wait(settle)

        // What the shot claims to show. Checked before the capture but reported
        // after it, so a failure still leaves the screenshot on disk to look at
        // — the image is the diagnostic, not the verdict.
        const expectations = (process.env['DMSCREEN_SMOKE_EXPECT'] ?? '').trim()
        const failures = expectations ? await checkExpectations(window, expectations) : []

        await writeFile(shotPath, await capturePng())

        // Reported, not judged: `scripts/smoke.mjs` decides what a failed
        // expectation means, exactly as it already does for console errors.
        for (const failure of failures) console.log(`[smoke:expect] ${failure}`)
        app.exit(0)
      } catch (error) {
        console.log(`[renderer:error] smoke run failed: ${(error as Error).message}`)
        app.exit(1)
      }
    })()
  })
}

function createWindow(): void {
  // macOS keeps the process alive after its last window closes. A newly opened
  // window must get its own close confirmation rather than inheriting the
  // previous window's one-shot bypass.
  forceClose = false
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#12141a',
    title: 'Digital DM Screen',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The preload only touches contextBridge/ipcRenderer, both of which work
      // in a sandboxed context — no reason to hand the renderer a Node-capable one.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  installSmokeHook(mainWindow)

  // Keep the app self-contained; anything the UI links out to opens in the
  // system browser rather than an in-app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The app is one page and never navigates. Chromium's default for a file
  // dropped on a window is to open that file *as* the window, which throws the
  // whole running app away — including the layout that had not been saved yet.
  // The Image module catches a drop on its own panel; this catches every drop
  // that misses.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  mainWindow.on('close', (event) => {
    if (forceClose || !documentDirty) return
    event.preventDefault()
    const closingApp = quitRequested || process.platform !== 'darwin'
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: [
        closingApp ? 'Save and quit' : 'Save and close',
        closingApp ? 'Quit anyway' : 'Close anyway',
        'Cancel'
      ],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: `"${documentName}" has unsaved changes.`,
      detail:
        `${closingApp ? 'Quitting' : 'Closing'} anyway is safe — the current screen is restored automatically next launch. ` +
        'It just will not be written to the layout file.'
    })
    if (choice === 2) {
      quitRequested = false
      return
    }

    const finishClose = (): void => {
      forceClose = true
      // Calling app.quit() again is intentional: the first quit was cancelled
      // by preventDefault(), and forceClose lets this second close pass.
      if (quitRequested) app.quit()
      else mainWindow?.close()
    }

    if (choice === 1) {
      finishClose()
      return
    }
    // Ask the renderer to save, then close once it reports success. A cancelled
    // save dialog reports false and the window simply stays open.
    mainWindow?.webContents.send('menu:action', 'layout:save')
    ipcMain.once('window:saveComplete', (_event, saved: boolean) => {
      if (!saved) {
        quitRequested = false
        return
      }
      finishClose()
    })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* -------------------------------------------------------------------- ipc */

ipcMain.handle('layout:open', async (_event, path?: string): Promise<OpenResult | null> => {
  let target = path
  if (!target) {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open layout',
      properties: ['openFile'],
      filters: LAYOUT_FILTERS
    })
    if (result.canceled || result.filePaths.length === 0) return null
    target = result.filePaths[0]
  }

  try {
    const doc = await readLayoutFile(target)
    await addRecent(target, doc.name)
    await refreshMenu()
    return { filePath: target, doc }
  } catch (error) {
    // A recent entry pointing at a moved/deleted file is the common case here;
    // drop it so the list stays honest.
    await removeRecent(target)
    await refreshMenu()
    await dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: 'Could not open layout',
      message: (error as Error).message
    })
    return null
  }
})

ipcMain.handle(
  'layout:save',
  async (_event, filePath: string, doc: LayoutDoc): Promise<string | null> => {
    try {
      await writeLayoutFile(filePath, doc)
      await addRecent(filePath, doc.name)
      await refreshMenu()
      return filePath
    } catch (error) {
      await dialog.showMessageBox(mainWindow!, {
        type: 'error',
        title: 'Could not save layout',
        message: (error as Error).message
      })
      return null
    }
  }
)

ipcMain.handle('layout:saveAs', async (_event, doc: LayoutDoc): Promise<string | null> => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save layout as',
    defaultPath: fileNameFor(doc.name),
    filters: LAYOUT_FILTERS
  })
  if (result.canceled || !result.filePath) return null

  try {
    await writeLayoutFile(result.filePath, doc)
    await addRecent(result.filePath, doc.name)
    await refreshMenu()
    return result.filePath
  } catch (error) {
    await dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: 'Could not save layout',
      message: (error as Error).message
    })
    return null
  }
})

/**
 * Picks an image and puts it on the guest list. The renderer stores the path it
 * gets back, and the id is what the `<img>` points at until the panel unmounts.
 */
ipcMain.handle('image:pick', async (): Promise<ImageRef | null> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose image',
    properties: ['openFile'],
    filters: IMAGE_FILTERS
  })
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  return resolveImage(path)
})

/** The restore and drag-and-drop route to the same list. */
ipcMain.handle('image:resolve', (_event, path: string): Promise<ImageRef> => resolveImage(path))

ipcMain.handle('recents:list', (): Promise<RecentEntry[]> => listRecents())

ipcMain.handle('recents:remove', async (_event, path: string): Promise<RecentEntry[]> => {
  const next = await removeRecent(path)
  await refreshMenu()
  return next
})

ipcMain.handle('recents:clear', async (): Promise<RecentEntry[]> => {
  const next = await clearRecents()
  await refreshMenu()
  return next
})

ipcMain.handle('session:read', (): Promise<SessionSnapshot | null> => readSession())

ipcMain.handle('session:write', async (_event, snapshot: SessionSnapshot): Promise<void> => {
  documentDirty = snapshot.dirty
  documentName = snapshot.doc.name
  await writeSession(snapshot)
})

ipcMain.handle('window:setDirty', (_event, dirty: boolean, name: string): void => {
  documentDirty = dirty
  documentName = name
  if (mainWindow) {
    mainWindow.setTitle(`${dirty ? '• ' : ''}${name} — Digital DM Screen`)
  }
})

/**
 * Asked before New or Open replaces the document. Deliberately the same shape
 * as the close confirmation — three ways out, cancel last — so the two prompts
 * are answered the same way rather than being subtly different dialogs.
 */
ipcMain.handle('window:confirmDiscard', (_event, name: string): 'save' | 'discard' | 'cancel' => {
  const choice = dialog.showMessageBoxSync(mainWindow!, {
    type: 'warning',
    buttons: ['Save and continue', 'Discard changes', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved changes',
    message: `"${name}" has unsaved changes.`,
    detail: 'Discarding loses them for good — this layout has not been written to a file.'
  })
  if (choice === 0) return 'save'
  return choice === 1 ? 'discard' : 'cancel'
})

/**
 * Quit from the action palette, which has no menu item to click for it.
 *
 * `app.quit()` and not `mainWindow.close()`: the two are deliberately distinct
 * paths here — on macOS `window-all-closed` is a no-op, so closing the window
 * would strand the process windowless rather than quitting. This lands in
 * `before-quit`, so the unsaved-changes prompt reads "Save and quit".
 */
ipcMain.handle('window:quit', (): void => app.quit())

ipcMain.handle('window:toggleFullScreen', (): boolean => {
  if (!mainWindow) return false
  const next = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(next)
  return next
})

/**
 * The one synchronous channel. Everything else is `handle`, but the renderer
 * needs this before its first paint: with an async gate there is a window where
 * no conditions are loaded, and every reference card renders through code that
 * assumes there are some. Cheap — the snapshot is already in memory.
 */
ipcMain.on('data:snapshot', (event) => {
  event.returnValue = currentSnapshot()
})

/**
 * Synchronous for the same reason as `data:snapshot`: the top bar and the panel
 * headers print shortcut labels on first paint, and an async gate would show
 * them blank for a frame and then reflow.
 */
ipcMain.on('keymap:snapshot', (event) => {
  event.returnValue = resolveKeymap(keymapOverrides)
})

/** The sparse overrides, which is what the editor edits — not the resolved map. */
ipcMain.handle('keymap:overrides', (): Keymap => keymapOverrides)

/** Same entry points the Data menu items use, for a shortcut bound to them. */
ipcMain.handle('data:importPack', (): void => dataActions.importPack())
ipcMain.handle('data:reloadPacks', (): void => dataActions.reloadPacks())

ipcMain.handle('keymap:set', (_event, overrides: Keymap): Promise<ResolvedKeymap> =>
  applyKeymap(overrides)
)

ipcMain.handle('keymap:reset', (): Promise<ResolvedKeymap> => applyKeymap({}))

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  userData: app.getPath('userData')
}))

/* ---------------------------------------------------------------- lifecycle */

// One screen at a time — a second instance just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('before-quit', () => {
    quitRequested = true
  })

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    // Before the window exists, so the renderer can take the snapshot
    // synchronously at preload and never render a half-loaded state. The keymap
    // is read here for the same reason: the top bar prints shortcut labels in
    // its very first paint.
    const loaded = await readKeymap()
    keymapOverrides = loaded.keymap
    for (const warning of loaded.warnings) console.warn(`keybindings.json: ${warning}`)

    serveImages()
    await loadPacks()
    await refreshMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { NativeImage } from 'electron'
import { join, basename } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import type {
  DataSnapshot,
  LayoutDoc,
  OpenResult,
  RecentEntry,
  SessionSnapshot
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

  const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

  window.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        // Long enough for the session restore round-trip to land.
        await wait(1800)

        // Fire a menu command first, for UI that has no other way in. The About
        // and Keyboard Shortcuts dialogs open from the native menu only, and a
        // native menu is not something a CSS selector can reach — so without
        // this they had no smoke coverage at all.
        const menuAction = (process.env['DMSCREEN_SMOKE_MENU'] ?? '').trim()
        if (menuAction) {
          window.webContents.send('menu:action', menuAction)
          await wait(400)
        }

        // Optionally drive controls through the real UI before capturing.
        // Newline-separated so several can be clicked in sequence.
        const selectors = (process.env['DMSCREEN_SMOKE_CLICK'] ?? '')
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean)

        for (const selector of selectors) {
          // Focus as well as click, so hover/focus-revealed UI (the condition
          // cross-reference popovers) can be captured too.
          // executeJavaScript resolves as `any`; the script below returns a
          // boolean and nothing else can change that, so name the type here.
          const found = (await window.webContents.executeJavaScript(
            `(() => {
              const el = document.querySelector(${JSON.stringify(selector)})
              el?.focus?.()
              el?.click?.()
              return !!el
            })()`
          )) as boolean
          if (!found) console.log(`[renderer:error] no element matched ${selector}`)
          await wait(500)
        }

        // Send one synthetic keypress. The only way to photograph a half-typed
        // two-stroke sequence: its prefix is a key, not a control, so there is
        // nothing for `click` to select.
        const press = (process.env['DMSCREEN_SMOKE_PRESS'] ?? '').trim()
        if (press) {
          await window.webContents.executeJavaScript(
            `(() => {
              const init = ${press}
              window.dispatchEvent(
                new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
              )
              return true
            })()`
          )
          await wait(400)
        }

        // Type into one field. Needed for anything whose interesting state is a
        // *query* — the action palette filtering itself, say — where clicking
        // gets you to the box and no further.
        //
        // The write goes through the native value setter rather than `el.value`
        // because React tracks the last value it wrote on the node itself: a
        // plain assignment updates the DOM but leaves the tracker agreeing with
        // it, so the change event that follows is discarded as a no-op.
        const typing = (process.env['DMSCREEN_SMOKE_TYPE'] ?? '').trim()
        if (typing) {
          const typed = (await window.webContents.executeJavaScript(
            `(() => {
              const { selector, text } = ${typing}
              const el = document.querySelector(selector)
              if (!el) return false
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              ).set
              setter.call(el, text)
              el.dispatchEvent(new Event('input', { bubbles: true }))
              return true
            })()`
          )) as boolean
          if (!typed) console.log(`[renderer:error] nothing to type into: ${typing}`)
          await wait(400)
        }

        // Park the pointer on one control, for UI that only a hover reveals.
        // Dispatched as `pointerover`, not `pointerenter`: React listens at the
        // root and synthesises enter from the bubbling event, so an enter event
        // sent straight to the element goes unheard.
        const hover = (process.env['DMSCREEN_SMOKE_HOVER'] ?? '').trim()
        if (hover) {
          const found = (await window.webContents.executeJavaScript(
            `(() => {
              const el = document.querySelector(${JSON.stringify(hover)})
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
          if (!found) console.log(`[renderer:error] no element matched ${hover}`)
        }

        // Extra dwell for shots of something that changes over time — and for a
        // hover the reveal delay has to run out inside.
        const settle = Number(process.env['DMSCREEN_SMOKE_SETTLE'] ?? 0)
        if (Number.isFinite(settle) && settle > 0) await wait(settle)

        // What the shot claims to show. Checked before the capture but reported
        // after it, so a failure still leaves the screenshot on disk to look at
        // — the image is the diagnostic, not the verdict.
        const expectations = (process.env['DMSCREEN_SMOKE_EXPECT'] ?? '').trim()
        const failures = expectations
          ? ((await window.webContents.executeJavaScript(
              `(() => {
                const spec = ${expectations}
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
            )) as string[])
          : []

        // capturePage() reads a frame from the Viz compositor, which on the
        // first cold launch of a fresh headless runner has not produced one
        // yet — it rejects with UnknownVizError a second or two in. The frame
        // lands shortly after, so retry rather than fail the shot; every later
        // launch in the run is already warm and captures first time.
        const capture = async (): Promise<NativeImage> => {
          for (let attempt = 0; ; attempt++) {
            try {
              return await window.webContents.capturePage()
            } catch (error) {
              if (attempt >= 9) throw error
              await wait(500)
            }
          }
        }
        const image = await capture()
        await writeFile(shotPath, image.toPNG())

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

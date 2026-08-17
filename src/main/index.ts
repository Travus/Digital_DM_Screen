import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, shell } from 'electron'
import { join, basename } from 'node:path'
import { access, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  IMAGE_SCHEME,
  type DataSnapshot,
  type DocumentSnapshot,
  type DocumentStatus,
  type ImageRef,
  type LayoutDoc,
  type RecentEntry,
  type WindowBounds
} from '../shared/types'
import {
  addWindow,
  createEmptyDoc,
  findWindow,
  isPrimaryWindow,
  mergeWindowSlice,
  parseLayoutDoc,
  removeWindow,
  renameWindow,
  setWindowOpen
} from '../shared/layout'
import { cascadeFrom, clampToDisplays, isUsableBounds } from './windowBounds'
import {
  addRecent,
  clearRecents,
  listRecents,
  readKeymap,
  removeRecent,
  writeKeymap
} from './userStore'
import {
  current as currentDoc,
  flushSession,
  isDirty,
  markSaved,
  name as documentName,
  onStatus,
  publish,
  rememberBounds,
  rememberedBounds,
  replace,
  restore,
  snapshot as documentSnapshot,
  status as documentStatus
} from './document'
import { resolveKeymap, sanitiseKeymap, type Keymap, type ResolvedKeymap } from '../shared/actions'
import { addPack, currentSnapshot, loadPacks, removePack, setDatasetEnabled } from './packStore'
import { IMAGE_EXTENSIONS, imageId, mimeFor, registerImage, servedPath } from './imageStore'
import { buildMenu, type DataActions } from './menu'
import { installSmokeHook } from './smoke'

const LAYOUT_FILTERS = [
  { name: 'DM Screen Layout', extensions: ['dmscreen', 'json'] },
  { name: 'All Files', extensions: ['*'] }
]

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

/* --------------------------------------------------------------- document */

/** A different document entirely, so the renderer redraws from scratch. */
function announceDocument(snapshot: DocumentSnapshot): void {
  broadcast('document:changed', snapshot)
}

/**
 * The file path and the unsaved flag, which move without the document moving —
 * a save clears the flag and names the file, and neither touches a panel.
 */
onStatus((status: DocumentStatus) => {
  broadcast('document:status', status)
  applyTitle()
})

/**
 * Asked before New or Open replaces the document.
 *
 * Deliberately the same shape as the close confirmation — three ways out, cancel
 * last — so the two prompts are answered the same way rather than being subtly
 * different dialogs. Returns false when the document must be left alone: the
 * user cancelled, or asked to save first and that save failed or was dismissed.
 */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true
  const choice = dialog.showMessageBoxSync(dialogParent()!, {
    type: 'warning',
    buttons: ['Save and continue', 'Discard changes', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved changes',
    message: `"${documentName()}" has unsaved changes.`,
    detail: 'Discarding loses them for good — this layout has not been written to a file.'
  })
  if (choice === 2) return false
  if (choice === 1) return true
  return saveDocument()
}

async function newDocument(): Promise<void> {
  if (!(await confirmDiscard())) return
  replace(createEmptyDoc(), null)
  announceDocument(documentSnapshot())
}

async function openDocument(path?: string): Promise<void> {
  // Guarded before the file picker, not after — being asked about unsaved work
  // only once a file has been chosen is a worse order to answer in.
  if (!(await confirmDiscard())) return

  let target = path
  if (!target) {
    const result = await dialog.showOpenDialog(dialogParent()!, {
      title: 'Open layout',
      properties: ['openFile'],
      filters: LAYOUT_FILTERS
    })
    if (result.canceled || result.filePaths.length === 0) return
    target = result.filePaths[0]
  }

  try {
    const doc = await readLayoutFile(target)
    await addRecent(target, doc.name)
    replace(doc, target)
    announceDocument(documentSnapshot())
  } catch (error) {
    // A recent entry pointing at a moved or deleted file is the common case
    // here; drop it so the list stays honest.
    await removeRecent(target)
    await dialog.showMessageBox(dialogParent()!, {
      type: 'error',
      title: 'Could not open layout',
      message: (error as Error).message
    })
  }
  await refreshMenu()
}

async function saveDocument(): Promise<boolean> {
  const { filePath } = documentStatus()
  if (!filePath) return saveDocumentAs()
  return writeDocument(filePath)
}

async function saveDocumentAs(): Promise<boolean> {
  const result = await dialog.showSaveDialog(dialogParent()!, {
    title: 'Save layout as',
    defaultPath: fileNameFor(documentName()),
    filters: LAYOUT_FILTERS
  })
  if (result.canceled || !result.filePath) return false
  return writeDocument(result.filePath)
}

async function writeDocument(path: string): Promise<boolean> {
  try {
    await writeLayoutFile(path, currentDoc())
    // Before the recents, so the session records the save even if that fails.
    await markSaved(path)
    await addRecent(path, documentName())
    await refreshMenu()
    return true
  } catch (error) {
    await dialog.showMessageBox(dialogParent()!, {
      type: 'error',
      title: 'Could not save layout',
      message: (error as Error).message
    })
    return false
  }
}

/** Pushes fresh data to the renderer and rebuilds the menu around it. */
async function applySnapshot(snapshot: DataSnapshot): Promise<void> {
  broadcast('data:changed', snapshot)
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
      const result = await dialog.showOpenDialog(dialogParent()!, {
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
        await dialog.showMessageBox(dialogParent()!, {
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
    // To the window in front, not to a remembered one. The menu is the
    // application's on every platform, so a command reached from it means the
    // screen being looked at — "Split Right" run from the players' window has
    // to split a panel there.
    (action, payload) =>
      (BrowserWindow.getFocusedWindow() ?? dialogParent())?.webContents.send(
        'menu:action',
        action,
        payload
      ),
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
  broadcast('keymap:changed', resolved)
  await refreshMenu()
  return resolved
}

/* ---------------------------------------------------------------- windows */

/**
 * Every window on screen, by the id of the document window it shows.
 *
 * A document is a list of windows, and this is the half of that list which
 * exists as pixels. The two are kept in step by `syncWindows`, which is the only
 * thing that opens or destroys one.
 */
const windows = new Map<string, BrowserWindow>()

/** Set while the app is going away, so a closing window is not read as intent. */
let shuttingDown = false

function windowIdFor(contents: Electron.WebContents): string | null {
  for (const [id, window] of windows) {
    if (window.webContents === contents) return id
  }
  return null
}

/**
 * The window a dialog hangs off: the one in front, else any. Nearly every
 * dialog here is raised by something the user just did, so the focused window is
 * almost always the one that asked.
 */
function dialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? windows.values().next().value
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of windows.values()) window.webContents.send(channel, ...args)
}

function applyTitle(): void {
  const dot = documentStatus().dirty ? '• ' : ''
  const doc = currentDoc()
  for (const [windowId, window] of windows) {
    const name = findWindow(doc, windowId)?.name
    // The primary is the document, so it is named after it. A second screen
    // says which screen it is, since that is the question being asked of it.
    const lead = isPrimaryWindow(doc, windowId) ? documentName() : `${name} — ${documentName()}`
    window.setTitle(`${dot}${lead} — Digital DM Screen`)
  }
}

function workAreas(): WindowBounds[] {
  return screen.getAllDisplays().map((display) => display.workArea)
}

/** Where a window should open: what was remembered for it, else beside the last. */
function placementFor(windowId: string): WindowBounds {
  const remembered = rememberedBounds()[windowId]
  if (isUsableBounds(remembered)) return clampToDisplays(remembered, workAreas())

  const last = [...windows.values()].pop()
  return cascadeFrom(last ? last.getBounds() : null, workAreas())
}

function createWindow(windowId: string): BrowserWindow {
  // macOS keeps the process alive after its last window closes. A newly opened
  // window must get its own close confirmation rather than inheriting the
  // previous window's one-shot bypass.
  forceClose = false

  const window = new BrowserWindow({
    ...placementFor(windowId),
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

  // Registered before the load, because the renderer asks which window it is
  // during preload — synchronously, before its first paint.
  windows.set(windowId, window)

  // The restored document is already in hand, so the window opens named after
  // it rather than showing the app's own name until the first edit.
  applyTitle()

  window.on('ready-to-show', () => window.show())

  installSmokeHook(window, windows.size - 1)

  // Keep the app self-contained; anything the UI links out to opens in the
  // system browser rather than an in-app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The app is one page and never navigates. Chromium's default for a file
  // dropped on a window is to open that file *as* the window, which throws the
  // whole running app away — including the layout that had not been saved yet.
  // The Image module catches a drop on its own panel; this catches every drop
  // that misses.
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // Geometry is remembered per machine, so it is tracked here rather than
  // published by the renderer, which cannot see where its own window sits.
  const remember = (): void => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
    rememberBounds(windowId, window.getBounds())
  }
  window.on('resize', remember)
  window.on('move', remember)

  window.on('close', (event) => onWindowClose(windowId, window, event))
  window.on('closed', () => windows.delete(windowId))

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

/**
 * A window closing, which means two different things.
 *
 * On a secondary window it is an instruction: the DM is putting that screen
 * away, so it is marked closed in the document and the Windows menu offers it
 * back with its panels intact. On the primary it is the app going away, which is
 * where the unsaved-changes prompt belongs — so the primary takes every other
 * window with it rather than leaving a document whose main window is missing.
 *
 * Neither applies while the app is already shutting down. A quit closes every
 * window, and reading those as instructions would save a layout whose screens
 * had all marked themselves closed on the way out.
 */
function onWindowClose(windowId: string, window: BrowserWindow, event: Electron.Event): void {
  if (shuttingDown) return

  if (!isPrimaryWindow(currentDoc(), windowId)) {
    closeDocumentWindow(windowId)
    return
  }

  if (!forceClose && isDirty()) {
    event.preventDefault()
    promptBeforeClosing(window)
    return
  }
  shutDownWindows(windowId)
}

/** Take the other windows down with the primary, without marking any closed. */
function shutDownWindows(exceptId: string): void {
  shuttingDown = true
  for (const [id, other] of windows) {
    if (id !== exceptId && !other.isDestroyed()) other.destroy()
  }
}

function promptBeforeClosing(window: BrowserWindow): void {
  const closingApp = quitRequested || process.platform !== 'darwin'
  const choice = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: [
      closingApp ? 'Save and quit' : 'Save and close',
      closingApp ? 'Quit anyway' : 'Close anyway',
      'Cancel'
    ],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved changes',
    message: `"${documentName()}" has unsaved changes.`,
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
    else window.close()
  }

  if (choice === 1) {
    // Nothing to write, but the session still has to record where the
    // document got to — that is the whole point of "closing anyway is safe".
    void flushSession().then(finishClose)
    return
  }
  // Saved here rather than asked of the renderer. Main holds the document, so
  // this no longer needs a round trip and a reply channel to find out how it
  // went. A cancelled save dialog returns false and the window stays open.
  void saveDocument().then((saved) => {
    if (!saved) {
      quitRequested = false
      return
    }
    finishClose()
  })
}

/**
 * Bring the windows on screen into line with the document.
 *
 * The one place a window is opened or destroyed, so "which screens exist" has a
 * single answer derived from the document rather than accumulating from
 * whichever commands happened to run.
 */
function syncWindows(): void {
  const doc = currentDoc()
  const wanted = doc.windows.filter((window) => window.open)

  for (const [id, window] of [...windows]) {
    if (wanted.some((entry) => entry.id === id)) continue
    windows.delete(id)
    if (!window.isDestroyed()) window.destroy()
  }

  for (const entry of wanted) {
    if (!windows.has(entry.id)) createWindow(entry.id)
  }
  applyTitle()
}

/**
 * A change to the window list: everyone redraws, and the screens follow.
 *
 * Sent as a peer update rather than a replacement, so adding a second screen
 * does not drop the first one out of fullscreen — the document is the same one,
 * with one more window on it.
 */
function announceWindows(): void {
  syncWindows()
  broadcast('document:peer', documentSnapshot())
}

function closeDocumentWindow(windowId: string): void {
  replace(setWindowOpen(currentDoc(), windowId, false), documentStatus().filePath, true)
  announceWindows()
}

/* -------------------------------------------------------------------- ipc */

ipcMain.handle('layout:new', (): Promise<void> => newDocument())
ipcMain.handle('layout:open', (_event, path?: string): Promise<void> => openDocument(path))
ipcMain.handle('layout:save', (): Promise<boolean> => saveDocument())
ipcMain.handle('layout:saveAs', (): Promise<boolean> => saveDocumentAs())

/**
 * An edit, straight from the renderer that made it.
 *
 * Sent on every mutation rather than on a timer. The debounce that used to sit
 * in front of this guarded the *disk* — serialising and pretty-printing the
 * whole document — and that one is still here, one layer down in
 * `scheduleSession`. Debouncing the message as well would only buy a window in
 * which main's copy is behind the screen, which is exactly the copy a save
 * reads: Ctrl+S landing inside it would write the document as it stood a moment
 * ago, with nothing on screen to say so.
 */
ipcMain.handle('document:publish', (event, doc: LayoutDoc): void => {
  const windowId = windowIdFor(event.sender)
  if (!windowId) return
  // Read for the part its sender owns, never adopted whole. Several windows hold
  // the same document, and the last message to arrive would otherwise undo an
  // edit made in another one a moment earlier.
  publish(mergeWindowSlice(currentDoc(), doc, windowId))
  // Back out to the others, so a party panel on one screen shows the HP typed
  // into the initiative tracker on the other. Not to the sender: it is already
  // showing this, and echoing would fight its own caret.
  for (const [id, window] of windows) {
    if (id !== windowId) window.webContents.send('document:peer', documentSnapshot())
  }
})

/**
 * The layout's own name and its lock, which no single window speaks for.
 *
 * Routed through main rather than riding a published document, so two windows
 * cannot disagree about them. A renderer applies the change locally first for
 * the sake of the button that was just pressed, and this is what makes it true
 * everywhere.
 */
ipcMain.handle('document:setMeta', (_event, meta: { name?: string; locked?: boolean }): void => {
  const doc = currentDoc()
  publish({
    ...doc,
    name: meta.name?.trim() ? meta.name : doc.name,
    locked: meta.locked ?? doc.locked
  })
  broadcast('document:peer', documentSnapshot())
  applyTitle()
})

/**
 * A write aimed at a panel in another window, forwarded to the window that owns
 * it.
 *
 * The initiative tracker pushing HP back to a party panel is the case: the two
 * are often on different screens, and a window may only speak for its own
 * panels. The sender holds the whole document, so it already knows where to send
 * this — main only carries it.
 */
ipcMain.handle(
  'document:patchPanel',
  (
    _event,
    targetWindowId: string,
    panelId: string,
    patch: Record<string, unknown>,
    kind: 'state' | 'settings'
  ): void => {
    windows.get(targetWindowId)?.webContents.send('document:patchPanel', panelId, patch, kind)
  }
)

/**
 * The theme, relayed to every window.
 *
 * It lives in `localStorage`, which the windows already share — a window opened
 * later reads the right one without being told. What it cannot do is notice a
 * change made next door, and a secondary window has no theme control of its own,
 * so without this the players' screen would stay dark until it was reopened.
 */
ipcMain.handle('theme:set', (event, theme: string): void => {
  for (const window of windows.values()) {
    if (window.webContents !== event.sender) window.webContents.send('theme:changed', theme)
  }
})

/* ----------------------------------------------------------- window list */

/** Which window this renderer is. Synchronous, because it is asked at preload. */
ipcMain.on('window:identity', (event) => {
  const windowId = windowIdFor(event.sender)
  event.returnValue = {
    windowId,
    isPrimary: windowId ? isPrimaryWindow(currentDoc(), windowId) : true
  }
})

ipcMain.handle('window:add', (): void => {
  publish(addWindow(currentDoc()))
  announceWindows()
})

ipcMain.handle('window:setOpen', (_event, windowId: string, open: boolean): void => {
  publish(setWindowOpen(currentDoc(), windowId, open))
  announceWindows()
})

ipcMain.handle('window:rename', (_event, windowId: string, name: string): void => {
  publish(renameWindow(currentDoc(), windowId, name))
  announceWindows()
})

ipcMain.handle('window:remove', (_event, windowId: string): void => {
  publish(removeWindow(currentDoc(), windowId))
  announceWindows()
})

/** Bring a window to the front, which is what clicking its row in the menu does. */
ipcMain.handle('window:focus', (_event, windowId: string): void => {
  const window = windows.get(windowId)
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

/**
 * Picks an image and puts it on the guest list. The renderer stores the path it
 * gets back, and the id is what the `<img>` points at until the panel unmounts.
 */
ipcMain.handle('image:pick', async (): Promise<ImageRef | null> => {
  const result = await dialog.showOpenDialog(dialogParent()!, {
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

/**
 * Quit from the action palette, which has no menu item to click for it.
 *
 * `app.quit()` and not a window close: the two are deliberately distinct paths
 * here — on macOS `window-all-closed` is a no-op, so closing the window would
 * strand the process windowless rather than quitting. This lands in
 * `before-quit`, so the unsaved-changes prompt reads "Save and quit".
 */
ipcMain.handle('window:quit', (): void => app.quit())

/** The window that asked, so a second screen can go fullscreen on its own. */
ipcMain.handle('window:toggleFullScreen', (event): boolean => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return false
  const next = !window.isFullScreen()
  window.setFullScreen(next)
  return next
})

/**
 * Synchronous, like the two below it. Everything else is `handle`, but the
 * renderer needs this before its first paint — an async gate would mean a frame
 * with no layout in it, and then the restored one arriving over the top.
 *
 * Cheap, because `restore()` already ran: this reads an object in memory rather
 * than the file it came from.
 */
ipcMain.on('document:snapshot', (event) => {
  event.returnValue = documentSnapshot()
})

/**
 * Synchronous for the same reason. With an async gate there is a window where
 * no conditions are loaded, and every reference card renders through code that
 * assumes there are some.
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

// One copy of the app at a time. A layout may have several windows, but a
// second *instance* would be a second document, so it just focuses this one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('before-quit', () => {
    quitRequested = true
  })

  app.on('second-instance', () => {
    // The primary, since that is the one carrying the file commands — a second
    // launch means someone looking for the app, not for a particular screen.
    const primary = windows.get(currentDoc().windows[0]?.id ?? '') ?? dialogParent()
    if (!primary) return
    if (primary.isMinimized()) primary.restore()
    primary.focus()
  })

  void app.whenReady().then(async () => {
    // Before the window exists, so the renderer can take the snapshot
    // synchronously at preload and never render a half-loaded state. The keymap
    // is read here for the same reason: the top bar prints shortcut labels in
    // its very first paint.
    const loaded = await readKeymap()
    keymapOverrides = loaded.keymap
    for (const warning of loaded.warnings) console.warn(`keybindings.json: ${warning}`)

    // Same reason, one rung up: the layout is read before the window exists, so
    // the renderer takes it synchronously at preload and the first frame it
    // paints is already the restored screen.
    await restore()

    serveImages()
    await loadPacks()
    await refreshMenu()
    // Opens every window the restored document says is open, which on a first
    // run is one and after a two-screen session is two.
    syncWindows()

    app.on('activate', () => {
      // macOS, coming back from a windowless app. The document still says which
      // screens it has, so they all come back rather than only the primary.
      if (BrowserWindow.getAllWindows().length === 0) {
        shuttingDown = false
        syncWindows()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

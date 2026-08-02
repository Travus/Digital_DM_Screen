import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
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
  readSession,
  removeRecent,
  writeSession
} from './userStore'
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
    (action, payload) => mainWindow?.webContents.send('menu:action', action, payload),
    dataActions
  )
}

/**
 * Development aid, inert unless DMSCREEN_SMOKE_SHOT is set: forwards renderer
 * console messages to stdout, then screenshots the window and exits. Used by
 * `scripts/smoke.mjs` to check the UI actually renders in a headless container.
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

        // Extra dwell for shots of something that changes over time.
        const settle = Number(process.env['DMSCREEN_SMOKE_SETTLE'] ?? 0)
        if (Number.isFinite(settle) && settle > 0) await wait(settle)

        const image = await window.webContents.capturePage()
        await writeFile(shotPath, image.toPNG())
        app.exit(0)
      } catch (error) {
        console.log(`[renderer:error] smoke run failed: ${(error as Error).message}`)
        app.exit(1)
      }
    })()
  })
}

function createWindow(): void {
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
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: ['Save and quit', 'Quit anyway', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: `"${documentName}" has unsaved changes.`,
      detail:
        'Quitting anyway is safe — the current screen is restored automatically next launch. It just will not be written to the layout file.'
    })
    if (choice === 2) return
    if (choice === 1) {
      forceClose = true
      mainWindow?.close()
      return
    }
    // Ask the renderer to save, then close once it reports success. A cancelled
    // save dialog reports false and the window simply stays open.
    mainWindow?.webContents.send('menu:action', 'layout:save')
    ipcMain.once('window:saveComplete', (_event, saved: boolean) => {
      if (!saved) return
      forceClose = true
      mainWindow?.close()
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
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    // Before the window exists, so the renderer can take the snapshot
    // synchronously at preload and never render a half-loaded state.
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

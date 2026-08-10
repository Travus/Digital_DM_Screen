import { app, BrowserWindow, Menu } from 'electron'
import type { DataSnapshot, RecentEntry } from '../shared/types'
import type { ResolvedKeymap } from '../shared/actions'
import { menuTemplate, type DataActions, type MenuDispatch, type ShellRole } from './menuTemplate'

export type { DataActions, MenuDispatch }

/** Electron's own zoom step, so a hand-run zoom moves the same distance. */
const ZOOM_STEP = 0.5

/**
 * What a role did, for the rows that had to stop being roles so the user could
 * have the key.
 *
 * Lives here rather than in the template for the usual reason: this is the half
 * that needs a window, and the template is meant to stay assertable without one.
 */
function runShellRole(role: ShellRole): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return
  const contents = win.webContents

  switch (role) {
    case 'reload':
      contents.reload()
      break
    case 'forceReload':
      contents.reloadIgnoringCache()
      break
    case 'toggleDevTools':
      contents.toggleDevTools()
      break
    case 'resetZoom':
      contents.setZoomLevel(0)
      break
    case 'zoomIn':
      contents.setZoomLevel(contents.getZoomLevel() + ZOOM_STEP)
      break
    case 'zoomOut':
      contents.setZoomLevel(contents.getZoomLevel() - ZOOM_STEP)
      break
    case 'togglefullscreen':
      win.setFullScreen(!win.isFullScreen())
      break
    case 'minimize':
      win.minimize()
      break
  }
}

/**
 * Installs the application menu.
 *
 * The template itself is `menuTemplate`, which knows nothing about Electron and
 * takes the platform as a parameter — everything worth asserting about this menu
 * is asserted there. What is left here is the one step that needs a running app,
 * and `buildFromTemplate` throwing on a malformed accelerator is why the template
 * refuses to emit one.
 */
export function buildMenu(
  recents: RecentEntry[],
  data: DataSnapshot,
  keymap: ResolvedKeymap,
  dispatch: MenuDispatch,
  dataActions: DataActions
): void {
  const template = menuTemplate({
    recents,
    data,
    keymap,
    dispatch,
    dataActions,
    shellActions: runShellRole,
    platform: process.platform,
    appName: app.getName()
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

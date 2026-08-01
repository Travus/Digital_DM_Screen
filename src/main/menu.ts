import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction, RecentEntry } from '../shared/types'

export type MenuDispatch = (action: MenuAction, payload?: string) => void

/**
 * Builds the application menu. Everything that touches the layout is forwarded
 * to the renderer as a `MenuAction`, so the menu and the in-app buttons run the
 * exact same code paths.
 *
 * Note: no Escape accelerator here — a menu accelerator would swallow Escape
 * app-wide, including inside text fields. The renderer owns that key.
 */
export function buildMenu(recents: RecentEntry[], dispatch: MenuDispatch): void {
  const send = (action: MenuAction) => () => dispatch(action)

  const recentItems: MenuItemConstructorOptions[] = recents.length
    ? [
        ...recents.map((entry) => ({
          label: entry.name,
          sublabel: entry.path,
          click: () => dispatch('layout:openRecent', entry.path)
        })),
        { type: 'separator' as const },
        { label: 'Clear Recent Layouts', click: send('recents:clear') }
      ]
    : [{ label: 'No recent layouts', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&Layout',
      submenu: [
        { label: 'New Layout', accelerator: 'CmdOrCtrl+N', click: send('layout:new') },
        { label: 'Open Layout…', accelerator: 'CmdOrCtrl+O', click: send('layout:open') },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('layout:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('layout:saveAs') },
        { label: 'Rename…', accelerator: 'F2', click: send('layout:rename') },
        { label: 'Lock / Unlock Layout', accelerator: 'CmdOrCtrl+L', click: send('layout:toggleLock') },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' }
      ]
    },
    {
      label: '&Panel',
      submenu: [
        { label: 'Split Right', accelerator: 'CmdOrCtrl+\\', click: send('panel:splitRight') },
        { label: 'Split Down', accelerator: 'CmdOrCtrl+Shift+\\', click: send('panel:splitDown') },
        { type: 'separator' },
        {
          label: 'Fullscreen Panel (Esc to exit)',
          accelerator: 'CmdOrCtrl+Enter',
          click: send('panel:maximize')
        },
        { type: 'separator' },
        { label: 'Close Panel', accelerator: 'CmdOrCtrl+W', click: send('panel:close') }
      ]
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Window Fullscreen' }
      ]
    },
    {
      label: '&Help',
      submenu: [{ label: `About ${app.getName()}`, click: send('app:about') }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

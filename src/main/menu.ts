import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { basename } from 'node:path'
import type { DataSnapshot, Dataset, MenuAction, RecentEntry } from '../shared/types'

export type MenuDispatch = (action: MenuAction, payload?: string) => void

/**
 * Data commands run in the main process rather than being dispatched to the
 * renderer: packs are read and indexed there, so a round trip would buy nothing
 * and `MenuAction` would grow for no reason.
 */
export interface DataActions {
  importPack: () => void
  reloadPacks: () => void
  removePack: (id: string) => void
  setEnabled: (datasets: Dataset[], value: boolean) => void
}

const SRD_DATASETS: Dataset[] = ['conditions', 'rules', 'abilities', 'diseases']

/**
 * Builds the application menu. Everything that touches the layout is forwarded
 * to the renderer as a `MenuAction`, so the menu and the in-app buttons run the
 * exact same code paths.
 *
 * Note: no Escape accelerator here — a menu accelerator would swallow Escape
 * app-wide, including inside text fields. The renderer owns that key.
 */
export function buildMenu(
  recents: RecentEntry[],
  data: DataSnapshot,
  dispatch: MenuDispatch,
  dataActions: DataActions
): void {
  const send = (action: MenuAction) => () => dispatch(action)
  const isMac = process.platform === 'darwin'

  // No sublabels anywhere in this menu: Windows renders them but sizes the menu
  // off the label alone, so anything longer than the label is cut mid-word. The
  // full path of a broken pack lives in the sidebar's warning tooltip instead.
  //
  // Failed packs are still listed — a pack whose file moved would otherwise just
  // look like a dataset that quietly went thin.
  const packItems: MenuItemConstructorOptions[] =
    data.refs.length || data.failed.length
      ? [
          ...data.refs.map((ref) => ({
            label: ref.name,
            submenu: [{ label: 'Remove', click: () => dataActions.removePack(ref.id) }]
          })),
          ...data.failed.map((failure) => ({
            label: `⚠ ${basename(failure.path)} — ${failure.reason}`,
            enabled: false
          }))
        ]
      : [{ label: 'No data packs', enabled: false }]

  const srdOn = SRD_DATASETS.every((dataset) => data.enabled[dataset])

  // Layouts are often all called "Untitled layout", so the name alone doesn't
  // identify one. The path used to be a sublabel, but those get cut to about the
  // widest label in the submenu — and since every layout shares a path prefix,
  // all that survived was "D:\Users\Docum…" on every row. The filename is the
  // part that actually differs, so it goes in the label, and only where there is
  // something to disambiguate.
  const nameCounts = new Map<string, number>()
  for (const entry of recents) {
    nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1)
  }

  const recentItems: MenuItemConstructorOptions[] = recents.length
    ? [
        ...recents.map((entry) => ({
          label:
            (nameCounts.get(entry.name) ?? 0) > 1
              ? `${entry.name} — ${basename(entry.path)}`
              : entry.name,
          click: () => dispatch('layout:openRecent', entry.path)
        })),
        { type: 'separator' as const },
        { label: 'Clear Recent Layouts', click: send('recents:clear') }
      ]
    : [{ label: 'No recent layouts', enabled: false }]

  const macAppMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            // Not `role: 'about'`. The native panel shows name, version and
            // copyright only; the in-app dialog carries the SRD attribution that
            // CC BY 4.0 requires wherever the material is used, and the app menu
            // is where a Mac user looks for it.
            { label: `About ${app.getName()}`, click: send('app:about') },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }
      ]
    : []

  const layoutQuitItems: MenuItemConstructorOptions[] = isMac
    ? []
    : [{ type: 'separator' }, { role: 'quit', label: 'Quit' }]
  const macPasteItems: MenuItemConstructorOptions[] = isMac ? [{ role: 'pasteAndMatchStyle' }] : []
  const macWindowMenu: MenuItemConstructorOptions[] = isMac ? [{ role: 'windowMenu' }] : []
  const helpMenu: MenuItemConstructorOptions[] = [
    {
      label: isMac ? 'Help' : '&Help',
      submenu: [
        {
          label: isMac ? 'About, Shortcuts & License…' : `About ${app.getName()}`,
          click: send('app:about')
        }
      ]
    }
  ]

  const template: MenuItemConstructorOptions[] = [
    ...macAppMenu,
    {
      label: isMac ? 'Layout' : '&Layout',
      submenu: [
        { label: 'New Layout', accelerator: 'CmdOrCtrl+N', click: send('layout:new') },
        { label: 'Open Layout…', accelerator: 'CmdOrCtrl+O', click: send('layout:open') },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('layout:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('layout:saveAs') },
        { label: 'Rename…', accelerator: 'F2', click: send('layout:rename') },
        {
          label: 'Lock / Unlock Layout',
          accelerator: 'CmdOrCtrl+L',
          click: send('layout:toggleLock')
        },
        ...layoutQuitItems
      ]
    },
    {
      label: isMac ? 'Edit' : '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...macPasteItems,
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: isMac ? 'Panel' : '&Panel',
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
      label: isMac ? 'Data' : '&Data',
      submenu: [
        {
          label: 'Import Data Pack…',
          accelerator: 'CmdOrCtrl+I',
          click: () => dataActions.importPack()
        },
        { label: 'Reload Data Packs from Disk', click: () => dataActions.reloadPacks() },
        { type: 'separator' },
        { label: 'Data Packs', submenu: packItems },
        { type: 'separator' },
        {
          label: 'Bundled SRD Content',
          type: 'checkbox',
          checked: srdOn,
          click: () => dataActions.setEnabled(SRD_DATASETS, !srdOn)
        },
        {
          label: 'Bundled Name Pools',
          type: 'checkbox',
          checked: data.enabled.names,
          click: () => dataActions.setEnabled(['names'], !data.enabled.names)
        }
      ]
    },
    {
      label: isMac ? 'View' : '&View',
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
    ...macWindowMenu,
    ...helpMenu
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

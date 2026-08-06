import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { basename } from 'node:path'
import type { DataSnapshot, Dataset, MenuAction, RecentEntry } from '../shared/types'
import { formatBinding, isChordBinding, isValidBinding } from '../shared/accelerator'
import type { ActionId, ResolvedKeymap } from '../shared/actions'

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
 * Accelerators come from `keymap`, which is the user's keybindings merged over
 * the catalogue in `src/shared/actions.ts`. They are not written here any more:
 * this file and the renderer's labels used to hold separate copies that had to
 * be edited together, which stops being merely untidy once the user can change
 * one of them.
 *
 * Note: no Escape accelerator here — a menu accelerator would swallow Escape
 * app-wide, including inside text fields. The renderer owns that key, which is
 * why `panel:restore` is `fixed` in the catalogue and has no item below.
 */
export function buildMenu(
  recents: RecentEntry[],
  data: DataSnapshot,
  keymap: ResolvedKeymap,
  dispatch: MenuDispatch,
  dataActions: DataActions
): void {
  const send = (action: MenuAction) => () => dispatch(action)
  const isMac = process.platform === 'darwin'

  /**
   * Builds a menu item's label and accelerator together, because for a two-stroke
   * sequence they are the same decision.
   *
   * An Electron accelerator is single-stroke only, so `CmdOrCtrl+K CmdOrCtrl+S`
   * cannot go in the accelerator field — it goes in the label instead. Dropping
   * it would leave the menu claiming the command has no shortcut at all, which
   * is precisely the lying caption this catalogue exists to prevent.
   *
   * The validity check is also the last line of defence before
   * `Menu.buildFromTemplate`, which throws on a malformed accelerator — and a
   * throw here means no menu, so no Help item, so no way to reach the editor and
   * undo whatever caused it.
   */
  const item = (id: ActionId, label: string): { label: string; accelerator?: string } => {
    const binding = keymap[id]
    if (!binding || !isValidBinding(binding)) return { label }
    if (isChordBinding(binding)) {
      return { label: `${label}  (${formatBinding(binding, process.platform)})` }
    }
    return { label, accelerator: binding }
  }

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
        { ...item('app:shortcuts', 'Keyboard Shortcuts…'), click: send('app:shortcuts') },
        { type: 'separator' },
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
        { ...item('layout:new', 'New Layout'), click: send('layout:new') },
        { ...item('layout:open', 'Open Layout…'), click: send('layout:open') },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { ...item('layout:save', 'Save'), click: send('layout:save') },
        { ...item('layout:saveAs', 'Save As…'), click: send('layout:saveAs') },
        { ...item('layout:rename', 'Rename…'), click: send('layout:rename') },
        { ...item('layout:toggleLock', 'Lock / Unlock Layout'), click: send('layout:toggleLock') },
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
        { ...item('panel:splitRight', 'Split Right'), click: send('panel:splitRight') },
        { ...item('panel:splitDown', 'Split Down'), click: send('panel:splitDown') },
        { type: 'separator' },
        {
          ...item('panel:maximize', 'Fullscreen Panel (Esc to exit)'),
          click: send('panel:maximize')
        },
        { type: 'separator' },
        { ...item('panel:close', 'Close Panel'), click: send('panel:close') }
      ]
    },
    {
      label: isMac ? 'Data' : '&Data',
      submenu: [
        { ...item('data:importPack', 'Import Data Pack…'), click: () => dataActions.importPack() },
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

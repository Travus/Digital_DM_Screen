/**
 * The application menu as data, with nothing Electron-shaped about it.
 *
 * Split out of `menu.ts` for the same reason `menuPlacement.ts` and `palette.ts`
 * were split out of their components: what is worth checking here is a table of
 * decisions — which items exist, what each one is labelled, which accelerator it
 * carries — and none of that needs a running app to answer. `menu.ts` keeps the
 * two lines that hand the result to Electron.
 *
 * `platform` and `appName` are parameters rather than reads of `process` and
 * `app`. The menu branches on macOS fifteen times, and a branch that can only be
 * exercised by being on a Mac is a branch nobody exercises.
 */

import { basename } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import type { DataSnapshot, Dataset, MenuAction, RecentEntry } from '../shared/types'
import { isChordBinding, isValidBinding } from '../shared/accelerator'
import { rendererSingles, type ActionId, type ResolvedKeymap } from '../shared/actions'

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

export interface MenuTemplateOptions {
  recents: RecentEntry[]
  data: DataSnapshot
  keymap: ResolvedKeymap
  dispatch: MenuDispatch
  dataActions: DataActions
  /** `process.platform` in the app. */
  platform: string
  /** `app.getName()`, which the About items and the macOS app menu are named for. */
  appName: string
}

const SRD_DATASETS: Dataset[] = ['conditions', 'rules', 'abilities', 'diseases']

/**
 * Builds the application menu template. Everything that touches the layout is
 * forwarded to the renderer as a `MenuAction`, so the menu and the in-app buttons
 * run the exact same code paths.
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
export function menuTemplate({
  recents,
  data,
  keymap,
  dispatch,
  dataActions,
  platform,
  appName
}: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const send = (action: MenuAction) => () => dispatch(action)
  const isMac = platform === 'darwin'

  // Strokes the menu must not register, because a sequence needs the renderer to
  // see them. Computed once from the same keymap the renderer reads, so the two
  // always agree on who owns which key without talking to each other.
  const handedOver = new Set(rendererSingles(keymap).map(([, binding]) => binding))

  /**
   * The accelerator column shows exactly what this menu will fire, and nothing
   * else.
   *
   * Two kinds of binding fall outside that. A two-stroke sequence cannot go in
   * the field at all — Electron accelerators are single-stroke — and a stroke
   * handed to the renderer must not be registered here, or the menu would fire it
   * before the sequence could ever use it.
   *
   * Both are left blank rather than written into the label. The column means one
   * thing on every platform, and a sequence is not something it can express;
   * spelling it out in the label instead put two different treatments in one
   * menu, which read as a mistake. The ⋯ panel menu and the shortcuts editor both
   * render sequences properly, and both sit closer to where they get used.
   *
   * The validity check is also the last line of defence before
   * `Menu.buildFromTemplate`, which throws on a malformed accelerator — and a
   * throw here means no menu, so no Help item, so no way to reach the editor and
   * undo whatever caused it.
   */
  const item = (id: ActionId, label: string): { label: string; accelerator?: string } => {
    const binding = keymap[id]
    if (!binding || !isValidBinding(binding)) return { label }
    if (isChordBinding(binding) || handedOver.has(binding)) return { label }
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

  /**
   * Quit is `fixed` in the catalogue, and goes through `item()` like everything
   * else so its accelerator would come off the keymap rather than being left
   * implicit — every accelerator this menu registers is meant to be one the
   * palette and the shortcuts editor can also name.
   *
   * **It is the one item where that does not happen.** `CmdOrCtrl+Q` is on the
   * reserved list in `accelerator.ts`, so `isValidBinding` rejects it and
   * `item()` returns a bare label: reserved means "nothing else may bind this",
   * and that check cannot tell it apart from "this string is malformed". The key
   * still works, because `role: 'quit'` supplies `CommandOrControl+Q` on its own
   * — so the menu and the editor agree here by coincidence rather than by
   * construction. `menuTemplate.test.ts` pins the current behaviour; undoing the
   * coincidence means teaching `item()` that an action's own reserved chord is
   * not a reason to drop it.
   */
  const quit = item('app:quit', 'Quit')

  const macAppMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: appName,
          submenu: [
            // Not `role: 'about'`. The native panel shows name, version and
            // copyright only; the in-app dialog carries the SRD attribution that
            // CC BY 4.0 requires wherever the material is used, and the app menu
            // is where a Mac user looks for it.
            { label: `About ${appName}`, click: send('app:about') },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            // Label untouched — the role spells it "Quit Digital DM Screen",
            // which is what a Mac user is looking for.
            { role: 'quit', accelerator: quit.accelerator }
          ]
        }
      ]
    : []

  const layoutQuitItems: MenuItemConstructorOptions[] = isMac
    ? []
    : [{ type: 'separator' }, { ...quit, role: 'quit' }]
  const macPasteItems: MenuItemConstructorOptions[] = isMac ? [{ role: 'pasteAndMatchStyle' }] : []
  const macWindowMenu: MenuItemConstructorOptions[] = isMac ? [{ role: 'windowMenu' }] : []
  const helpMenu: MenuItemConstructorOptions[] = [
    {
      label: isMac ? 'Help' : '&Help',
      submenu: [
        { ...item('app:shortcuts', 'Keyboard Shortcuts…'), click: send('app:shortcuts') },
        { type: 'separator' },
        {
          label: isMac ? 'About, Shortcuts & License…' : `About ${appName}`,
          click: send('app:about')
        }
      ]
    }
  ]

  return [
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
        // Every bindable action needs an item here, not only for discovery: an
        // accelerator is registered by *being* on a menu item, so a default with
        // no row to sit on would simply never fire.
        { ...item('panel:rename', 'Rename Panel…'), click: send('panel:rename') },
        {
          ...item('panel:changeModule', 'Change Module…'),
          click: send('panel:changeModule')
        },
        { type: 'separator' },
        { ...item('panel:splitRight', 'Split Right'), click: send('panel:splitRight') },
        { ...item('panel:splitDown', 'Split Down'), click: send('panel:splitDown') },
        { ...item('split:flip', 'Flip Surrounding Split'), click: send('split:flip') },
        {
          ...item('split:equalise', 'Even Out Surrounding Split'),
          click: send('split:equalise')
        },
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
        {
          ...item('data:reloadPacks', 'Reload Data Packs from Disk'),
          click: () => dataActions.reloadPacks()
        },
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
        // Where VS Code, Zed and Sublime all put theirs, so it is the first
        // place anyone will look for it.
        { ...item('app:palette', 'Action Palette…'), click: send('app:palette') },
        { type: 'separator' },
        {
          ...item('view:toggleTheme', 'Switch Light / Dark Theme'),
          click: send('view:toggleTheme')
        },
        {
          ...item('view:toggleSidebar', 'Recent Layouts'),
          click: send('view:toggleSidebar')
        },
        { type: 'separator' },
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
}

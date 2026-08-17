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
import {
  bindingStrokes,
  formatAccelerator,
  isChordBinding,
  isValidBinding
} from '../shared/accelerator'
import { rendererSingles, type ActionId, type ResolvedKeymap } from '../shared/actions'

export type MenuDispatch = (action: MenuAction, payload?: string) => void

/**
 * Roles on this menu that register an accelerator of their own.
 *
 * Electron hands each of these a key, and none of them is a catalogue action —
 * so `findConflict` cannot see them. A user binding `CmdOrCtrl+R` gets a chord
 * the editor accepts, the palette prints, and Reload then eats before the page
 * is ever asked. That is the same failure as a sequence losing its opening
 * stroke to a menu accelerator, one layer down, and it takes the same answer:
 * **the menu gives the stroke up.**
 *
 * It has to give up being a *role* to do it. An item with a role carries either
 * the role's key or one you name; there is no way to say "no accelerator". So a
 * role whose key the keymap wants becomes a plain item that calls `shellActions`
 * — which is why that callback exists at all.
 */
export type ShellRole =
  | 'reload'
  | 'forceReload'
  | 'toggleDevTools'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'togglefullscreen'
  | 'minimize'

/** What Electron performs for a role that has stopped being one. */
export type ShellActions = (role: ShellRole) => void

/**
 * Electron's own defaults, copied from `lib/browser/api/menu-item-roles.ts`
 * rather than remembered — the spellings differ from ours (`CommandOrControl`,
 * `Command`) and are normalised before anything is compared to them.
 */
const ROLE_ACCELERATORS: Record<ShellRole, (isMac: boolean) => string> = {
  reload: () => 'CmdOrCtrl+R',
  forceReload: () => 'Shift+CmdOrCtrl+R',
  toggleDevTools: (isMac) => (isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I'),
  resetZoom: () => 'CommandOrControl+0',
  zoomIn: () => 'CommandOrControl+Plus',
  zoomOut: () => 'CommandOrControl+-',
  togglefullscreen: (isMac) => (isMac ? 'Control+Command+F' : 'F11'),
  minimize: () => 'CommandOrControl+M'
}

/** The label the role would have shown, for the item that replaces it. */
const ROLE_LABELS: Record<ShellRole, string> = {
  reload: 'Reload',
  forceReload: 'Force Reload',
  toggleDevTools: 'Toggle Developer Tools',
  resetZoom: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  togglefullscreen: 'Toggle Full Screen',
  minimize: 'Minimize'
}

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
  /** Runs what a role would have done, for a role that had to give up its key. */
  shellActions: ShellActions
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
  shellActions,
  platform,
  appName
}: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const send = (action: MenuAction) => () => dispatch(action)
  const isMac = platform === 'darwin'

  /*
   * Every stroke the keymap spends, either half of either kind of binding, in
   * the platform's own spelling — a role's key and a recorded chord write the
   * primary modifier differently (`Command`, `CommandOrControl`, `CmdOrCtrl`),
   * so they are only comparable once resolved.
   *
   * Both halves, because a role fires whether or not a prefix is pending. That
   * is the same reason `checkBinding` treats every stroke as reserved rather
   * than only the first.
   */
  const claimed = new Set(
    Object.values(keymap).flatMap((binding) =>
      binding ? bindingStrokes(binding).map((stroke) => formatAccelerator(stroke, platform)) : []
    )
  )

  const wants = (role: ShellRole): boolean =>
    claimed.has(formatAccelerator(ROLE_ACCELERATORS[role](isMac), platform))

  /**
   * A role, unless the keymap wants its key — in which case the same row, doing
   * the same thing, with nothing registered.
   *
   * The common case is untouched: with no binding on any of these strokes every
   * one of them is still a plain role, which is what keeps the ordinary menu
   * exactly as Electron builds it.
   */
  const shellItem = (role: ShellRole, label?: string): MenuItemConstructorOptions => {
    if (!wants(role)) return label ? { role, label } : { role }
    return { label: label ?? ROLE_LABELS[role], click: () => shellActions(role) }
  }

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
  /*
   * `role: 'windowMenu'` is a whole submenu, and Minimize inside it holds
   * `Cmd+M`. Freeing that stroke means writing the submenu out — Electron's own
   * composition, which on macOS is minimize, zoom, separator, front.
   *
   * Only when the stroke is actually wanted. Expanding it unconditionally would
   * trade the OS's window handling for nothing: a plain submenu is not
   * registered as the application's Window menu, so the system stops listing
   * open windows in it. One window is all this app has, which is what makes that
   * an acceptable price for a key the user asked for — and no price at all for
   * everyone who never binds it.
   */
  const macWindowMenu: MenuItemConstructorOptions[] = !isMac
    ? []
    : wants('minimize')
      ? [
          {
            label: 'Window',
            submenu: [
              shellItem('minimize'),
              { role: 'zoom' },
              { type: 'separator' },
              { role: 'front' }
            ]
          }
        ]
      : [{ role: 'windowMenu' }]
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
        // Flat rather than two submenus: these carry the only accelerators in
        // the app anyone has to hunt for, and a key one level further in is a
        // key nobody finds.
        { ...item('panel:swapLeft', 'Swap With Panel Left'), click: send('panel:swapLeft') },
        { ...item('panel:swapRight', 'Swap With Panel Right'), click: send('panel:swapRight') },
        { ...item('panel:swapUp', 'Swap With Panel Above'), click: send('panel:swapUp') },
        { ...item('panel:swapDown', 'Swap With Panel Below'), click: send('panel:swapDown') },
        { type: 'separator' },
        { ...item('panel:wider', 'Make Panel Wider'), click: send('panel:wider') },
        { ...item('panel:narrower', 'Make Panel Narrower'), click: send('panel:narrower') },
        { ...item('panel:taller', 'Make Panel Taller'), click: send('panel:taller') },
        { ...item('panel:shorter', 'Make Panel Shorter'), click: send('panel:shorter') },
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
        shellItem('reload'),
        shellItem('forceReload'),
        shellItem('toggleDevTools'),
        { type: 'separator' },
        shellItem('resetZoom'),
        shellItem('zoomIn'),
        shellItem('zoomOut'),
        { type: 'separator' },
        shellItem('togglefullscreen', 'Window Fullscreen')
      ]
    },
    ...macWindowMenu,
    ...helpMenu
  ]
}

/**
 * The application menu, read back as data.
 *
 * Two things are being checked. The macOS branches — fifteen of them, none
 * reachable from a Linux CI runner or a Windows desktop — and the accelerator
 * column, which is the one place the menu could contradict what the palette and
 * the shortcuts editor say a key does.
 */
import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { resolveKeymap, type ResolvedKeymap } from '../shared/actions'
import type { DataSnapshot } from '../shared/types'
import { menuTemplate, type DataActions, type MenuTemplateOptions } from './menuTemplate'

const snapshot = (over: Partial<DataSnapshot> = {}): DataSnapshot => ({
  packs: [],
  refs: [],
  failed: [],
  enabled: { conditions: true, rules: true, abilities: true, diseases: true, names: true },
  ...over
})

const dataActions = (): DataActions => ({
  importPack: vi.fn(),
  reloadPacks: vi.fn(),
  removePack: vi.fn(),
  setEnabled: vi.fn()
})

const build = (over: Partial<MenuTemplateOptions> = {}): MenuItemConstructorOptions[] =>
  menuTemplate({
    recents: [],
    data: snapshot(),
    keymap: resolveKeymap({}),
    dispatch: vi.fn(),
    dataActions: dataActions(),
    platform: 'win32',
    appName: 'Digital DM Screen',
    ...over
  })

const mac = (over: Partial<MenuTemplateOptions> = {}): MenuItemConstructorOptions[] =>
  build({ platform: 'darwin', ...over })

const items = (item?: MenuItemConstructorOptions): MenuItemConstructorOptions[] =>
  (item?.submenu as MenuItemConstructorOptions[] | undefined) ?? []

const byLabel = (
  list: MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions | undefined => list.find((entry) => entry.label === label)

/** One menu of the bar, by the label it carries on that platform. */
const menu = (
  template: MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions[] => items(byLabel(template, label))

const roles = (list: MenuItemConstructorOptions[]): (string | undefined)[] =>
  list.map((entry) => entry.role)

/** The click handlers here take no arguments; Electron's type says otherwise. */
const activate = (item?: MenuItemConstructorOptions): void => {
  ;(item?.click as unknown as (() => void) | undefined)?.()
}

describe('the shape of the bar', () => {
  it('runs Layout, Edit, Panel, Data, View, Help on Windows and Linux', () => {
    expect(build().map((entry) => entry.label)).toEqual([
      '&Layout',
      '&Edit',
      '&Panel',
      '&Data',
      '&View',
      '&Help'
    ])
  })

  it('leads with the application menu on macOS and drops the mnemonics', () => {
    // The `&` marks an Alt access key, which is a Windows and Linux convention;
    // on macOS it renders as a literal ampersand in the menu bar.
    expect(mac().map((entry) => entry.label)).toEqual([
      'Digital DM Screen',
      'Layout',
      'Edit',
      'Panel',
      'Data',
      'View',
      undefined,
      'Help'
    ])
    // The unlabelled one is the window menu, which the role names for us.
    expect(mac()[6].role).toBe('windowMenu')
  })

  it('names the application menu after the app, not after a constant', () => {
    expect(mac({ appName: 'DM Screen Nightly' })[0].label).toBe('DM Screen Nightly')
  })
})

describe('quit', () => {
  it('sits at the foot of the Layout menu everywhere but macOS', () => {
    const layout = menu(build(), '&Layout')
    const last = layout[layout.length - 1]
    expect(last).toMatchObject({ label: 'Quit', role: 'quit' })
    expect(layout[layout.length - 2].type).toBe('separator')
  })

  it('moves to the application menu on macOS, keeping the role’s own label', () => {
    // The role spells it "Quit Digital DM Screen", which is what a Mac user
    // looks for; overriding the label would be worse than leaving it.
    const app = items(mac()[0])
    expect(app.at(-1)).toMatchObject({ role: 'quit' })
    expect(app.at(-1)?.label).toBeUndefined()
    expect(menu(mac(), 'Layout').some((entry) => entry.role === 'quit')).toBe(false)
  })

  it('is the one item whose key comes from the role and not from the keymap', () => {
    // Not what this file set out to do. `item()` drops any binding
    // `isValidBinding` rejects, and CmdOrCtrl+Q is on the *reserved* list — it
    // is reserved so nothing else can take it, but that check cannot tell
    // "nobody may bind this" from "this string is malformed", so Quit's own key
    // is filtered out of Quit's own item.
    //
    // Nothing breaks: `role: 'quit'` supplies CommandOrControl+Q by itself, so
    // the menu fires the key the palette and the editor both advertise. They
    // agree by coincidence, which is precisely what writing the accelerator on
    // was meant to rule out. Asserted as it is rather than as intended, so the
    // day it changes is a decision rather than a surprise.
    expect(menu(build(), '&Layout').at(-1)?.accelerator).toBeUndefined()
    expect(items(mac()[0]).at(-1)?.accelerator).toBeUndefined()

    // What the mechanism does when the key is not reserved: an explicit
    // accelerator, straight off the keymap.
    const keymap: ResolvedKeymap = { ...resolveKeymap({}), 'app:quit': 'CmdOrCtrl+Alt+Q' }
    expect(menu(build({ keymap }), '&Layout').at(-1)?.accelerator).toBe('CmdOrCtrl+Alt+Q')
  })
})

describe('the Edit menu', () => {
  it('keeps the roles that make Cmd+C, Cmd+V and friends work in text fields', () => {
    // On macOS these keys reach a text field only because the OS routes them
    // through the menu. Losing a role here kills copy and paste app-wide.
    expect(roles(menu(mac(), 'Edit'))).toEqual([
      'undo',
      'redo',
      undefined,
      'cut',
      'copy',
      'paste',
      'pasteAndMatchStyle',
      'delete',
      undefined,
      'selectAll'
    ])
  })

  it('leaves out paste-and-match-style where it is not a platform convention', () => {
    expect(roles(menu(build(), '&Edit'))).not.toContain('pasteAndMatchStyle')
  })
})

describe('the Help and About items', () => {
  it('names the About item after the app off macOS', () => {
    const help = menu(build(), '&Help')
    expect(help.map((entry) => entry.label)).toEqual([
      'Keyboard Shortcuts…',
      undefined,
      'About Digital DM Screen'
    ])
  })

  it('says what the dialog actually contains on macOS, where About is up top', () => {
    // The app menu already has "About Digital DM Screen"; a second item under
    // that name would look like the same thing twice.
    expect(menu(mac(), 'Help').at(-1)?.label).toBe('About, Shortcuts & License…')
  })

  it('is the in-app dialog on both, not the native panel', () => {
    // `role: 'about'` shows name, version and copyright — not the SRD
    // attribution CC BY 4.0 requires wherever the material is used.
    const dispatch = vi.fn()
    activate(items(mac({ dispatch })[0])[0])
    activate(menu(build({ dispatch }), '&Help').at(-1))
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(1, 'app:about')
    expect(dispatch).toHaveBeenNthCalledWith(2, 'app:about')
  })
})

describe('the accelerator column', () => {
  it('shows the binding the keymap holds, rebound or not', () => {
    const panel = menu(
      build({ keymap: resolveKeymap({ 'panel:close': 'CmdOrCtrl+Alt+W' }) }),
      '&Panel'
    )
    expect(byLabel(panel, 'Close Panel')?.accelerator).toBe('CmdOrCtrl+Alt+W')
    expect(byLabel(panel, 'Split Right')?.accelerator).toBe('CmdOrCtrl+\\')
  })

  it('leaves an unbound command blank rather than inventing one', () => {
    expect(
      byLabel(menu(build(), '&View'), 'Switch Light / Dark Theme')?.accelerator
    ).toBeUndefined()
  })

  it('blanks a two-stroke sequence, which the field cannot express', () => {
    const keymap = resolveKeymap({ 'app:shortcuts': 'CmdOrCtrl+K CmdOrCtrl+S' })
    expect(
      byLabel(menu(build({ keymap }), '&Help'), 'Keyboard Shortcuts…')?.accelerator
    ).toBeUndefined()
  })

  it('gives up a stroke a sequence needs, so the renderer can arbitrate', () => {
    // Ctrl+S is Save *and* the tail of Ctrl+K Ctrl+S. Electron fires an
    // accelerator before the page sees the key, so the menu has to stop
    // registering that stroke or the sequence could never complete.
    const keymap = resolveKeymap({ 'app:shortcuts': 'CmdOrCtrl+K CmdOrCtrl+S' })
    expect(byLabel(menu(build({ keymap }), '&Layout'), 'Save')?.accelerator).toBeUndefined()
    // Nothing else is given up — Open is untouched by the sequence.
    expect(byLabel(menu(build({ keymap }), '&Layout'), 'Open Layout…')?.accelerator).toBe(
      'CmdOrCtrl+O'
    )
  })

  it('drops a binding it cannot parse rather than handing it to Electron', () => {
    // `Menu.buildFromTemplate` throws on a malformed accelerator, and a throw
    // there means no menu at all — including the Help item that opens the editor
    // where the bad binding could be undone.
    const keymap: ResolvedKeymap = { ...resolveKeymap({}), 'layout:save': 'CmdOrCtrl+F25' }
    expect(byLabel(menu(build({ keymap }), '&Layout'), 'Save')?.accelerator).toBeUndefined()
  })

  it('gives every bindable command a row to sit on', () => {
    // An accelerator registers by *being* on a menu item, so a default with no
    // row would simply never fire. Escape is the exception: the renderer owns it.
    const panel = menu(build(), '&Panel').map((entry) => entry.label)
    expect(panel).toEqual(
      expect.arrayContaining([
        'Rename Panel…',
        'Change Module…',
        'Split Right',
        'Split Down',
        'Flip Surrounding Split',
        'Even Out Surrounding Split',
        'Fullscreen Panel (Esc to exit)',
        'Close Panel'
      ])
    )
    expect(JSON.stringify(build())).not.toContain('"Escape"')
  })
})

describe('the recent layouts submenu', () => {
  const recent = (
    name: string,
    path: string
  ): { name: string; path: string; openedAt: string } => ({
    name,
    path,
    openedAt: '2026-01-01T00:00:00.000Z'
  })

  const openRecent = (template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
    items(byLabel(menu(template, '&Layout'), 'Open Recent'))

  it('adds the filename only where the layout name does not identify one', () => {
    // Layouts are often all called "Untitled layout"; the filename is the part
    // that differs, and it goes in the label because a sublabel gets cut.
    const list = openRecent(
      build({
        recents: [
          recent('Untitled layout', '/a/one.dmscreen'),
          recent('Untitled layout', '/b/two.dmscreen'),
          recent('Waterdeep', '/c/wd.dmscreen')
        ]
      })
    )
    expect(list.map((entry) => entry.label)).toEqual([
      'Untitled layout — one.dmscreen',
      'Untitled layout — two.dmscreen',
      'Waterdeep',
      undefined,
      'Clear Recent Layouts'
    ])
  })

  it('opens the path it was listed with, not the label', () => {
    const dispatch = vi.fn()
    activate(openRecent(build({ dispatch, recents: [recent('Waterdeep', '/c/wd.dmscreen')] }))[0])
    expect(dispatch).toHaveBeenCalledWith('layout:openRecent', '/c/wd.dmscreen')
  })

  it('says so, inertly, when there are none', () => {
    expect(openRecent(build())).toEqual([{ label: 'No recent layouts', enabled: false }])
  })
})

describe('the Data menu', () => {
  const packs = (template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
    items(byLabel(menu(template, '&Data'), 'Data Packs'))

  it('lists each pack with a way to remove it', () => {
    const actions = dataActions()
    const template = build({
      data: snapshot({ refs: [{ id: 'p1', name: 'Homebrew', path: '/packs/hb.dmpack.json' }] }),
      dataActions: actions
    })
    const pack = packs(template)[0]
    expect(pack.label).toBe('Homebrew')
    activate(items(pack)[0])
    expect(actions.removePack).toHaveBeenCalledWith('p1')
  })

  it('lists a pack that failed to load, so it cannot look like thin data', () => {
    // A pack whose file moved would otherwise just look like a dataset that
    // quietly went short.
    const template = build({
      data: snapshot({ failed: [{ path: '/gone/hb.dmpack.json', reason: 'could not be read' }] })
    })
    expect(packs(template)).toEqual([
      { label: '⚠ hb.dmpack.json — could not be read', enabled: false }
    ])
  })

  it('says so, inertly, when there are none', () => {
    expect(packs(build())).toEqual([{ label: 'No data packs', enabled: false }])
  })

  it('ticks the SRD switch only when every bundled dataset is on', () => {
    const on = byLabel(menu(build(), '&Data'), 'Bundled SRD Content')
    expect(on).toMatchObject({ type: 'checkbox', checked: true })

    const data = snapshot({
      enabled: { conditions: true, rules: false, abilities: true, diseases: true, names: true }
    })
    expect(byLabel(menu(build({ data }), '&Data'), 'Bundled SRD Content')?.checked).toBe(false)
  })

  it('turns the four SRD datasets on or off together, and the name pools apart', () => {
    const actions = dataActions()
    const template = build({ dataActions: actions })
    activate(byLabel(menu(template, '&Data'), 'Bundled SRD Content'))
    activate(byLabel(menu(template, '&Data'), 'Bundled Name Pools'))
    expect(actions.setEnabled).toHaveBeenNthCalledWith(
      1,
      ['conditions', 'rules', 'abilities', 'diseases'],
      false
    )
    expect(actions.setEnabled).toHaveBeenNthCalledWith(2, ['names'], false)
  })

  it('runs the pack commands in the main process rather than dispatching them', () => {
    const actions = dataActions()
    const dispatch = vi.fn()
    const data = menu(build({ dataActions: actions, dispatch }), '&Data')
    activate(byLabel(data, 'Import Data Pack…'))
    activate(byLabel(data, 'Reload Data Packs from Disk'))
    expect(actions.importPack).toHaveBeenCalled()
    expect(actions.reloadPacks).toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('dispatching to the renderer', () => {
  it('sends the catalogue action, so the menu and the buttons share a path', () => {
    const dispatch = vi.fn()
    const template = build({ dispatch })
    activate(byLabel(menu(template, '&Layout'), 'Save'))
    activate(byLabel(menu(template, '&Panel'), 'Close Panel'))
    activate(byLabel(menu(template, '&View'), 'Action Palette…'))
    expect(dispatch.mock.calls).toEqual([['layout:save'], ['panel:close'], ['app:palette']])
  })
})

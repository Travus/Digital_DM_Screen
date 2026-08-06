/**
 * Every command a keybinding can point at, in one place.
 *
 * Bindings used to live twice: as `accelerator:` strings on menu items in
 * `src/main/menu.ts`, and again as display labels in the renderer's
 * `lib/shortcuts.ts`, whose own comment admitted the two had to be edited
 * together. That was survivable while they were constants. Once the user can
 * change one, a second copy is just a way for the menu and the buttons to
 * disagree — so the accelerator lives here and nowhere else.
 *
 * Display *labels* are deliberately not centralised the same way. The native
 * menu uses title case with ellipses ("Save As…") and the in-app surfaces use
 * sentence case ("Save layout as"); those are different registers and forcing
 * one on the other would make both worse. `label` here is the in-app one, which
 * is what the shortcuts editor shows. The menu keeps its own.
 */

import { checkAccelerator, normaliseAccelerator } from './accelerator'

export type ActionId =
  | 'layout:new'
  | 'layout:open'
  | 'layout:save'
  | 'layout:saveAs'
  | 'layout:rename'
  | 'layout:toggleLock'
  | 'panel:splitRight'
  | 'panel:splitDown'
  | 'panel:maximize'
  | 'panel:restore'
  | 'panel:close'
  | 'data:importPack'
  | 'app:about'
  | 'app:shortcuts'

export type ActionCategory = 'Layout' | 'Panel' | 'Data' | 'Application'

/**
 * What an action needs to know about the app to say whether it currently
 * applies.
 *
 * Deliberately a plain value rather than a store handle: this module is shared
 * with the main process, which has no store, and a predicate over a small
 * struct is testable without mounting anything.
 */
export interface ActionContext {
  /** The layout is locked — everything structural is off. */
  locked: boolean
  /** There is a panel for the command to act on. */
  hasPanel: boolean
  /** Some panel is currently fullscreen. */
  maximized: boolean
}

export interface ActionDef {
  id: ActionId
  label: string
  category: ActionCategory
  /**
   * `CmdOrCtrl` rather than a per-platform table: Electron already resolves it
   * to Cmd on Darwin and Ctrl elsewhere, and nothing here wants a structurally
   * different chord per platform. `null` means shipped unbound.
   */
  defaultAccelerator: string | null
  /**
   * Bindings the user cannot take over. Only Escape, and only because a menu
   * accelerator for Escape swallows the key application-wide — including inside
   * text fields — which is why the renderer owns it in `App.tsx`. Listing it
   * here rather than hiding it is the point: it shows up in the editor as fixed,
   * so nobody goes looking for where it went.
   */
  fixed?: boolean
  /**
   * Whether the action currently applies.
   *
   * Nothing consumes this yet. It is here because the command palette in #20 is
   * the surface that needs it — a menu can get away with listing a command that
   * quietly does nothing, but a palette is the discovery surface and listing
   * "Close panel" on a locked layout actively misleads. Adding it while the
   * entries are being written is free; retrofitting it means re-deriving every
   * guard from wherever it currently lives (`store.closePanel`'s early return,
   * `PanelFrame`'s omitted rows, `App`'s `if (target)`).
   */
  enabled?: (context: ActionContext) => boolean
}

/** Display order — the shortcuts editor groups on `category` and keeps this. */
export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'layout:new',
    label: 'New layout',
    category: 'Layout',
    defaultAccelerator: 'CmdOrCtrl+N'
  },
  {
    id: 'layout:open',
    label: 'Open layout',
    category: 'Layout',
    defaultAccelerator: 'CmdOrCtrl+O'
  },
  {
    id: 'layout:save',
    label: 'Save layout',
    category: 'Layout',
    defaultAccelerator: 'CmdOrCtrl+S'
  },
  {
    id: 'layout:saveAs',
    label: 'Save layout as',
    category: 'Layout',
    defaultAccelerator: 'CmdOrCtrl+Shift+S'
  },
  {
    id: 'layout:rename',
    label: 'Rename layout',
    category: 'Layout',
    defaultAccelerator: 'F2'
  },
  {
    id: 'layout:toggleLock',
    label: 'Lock or unlock layout',
    category: 'Layout',
    defaultAccelerator: 'CmdOrCtrl+L'
  },

  {
    id: 'panel:splitRight',
    label: 'Split panel right',
    category: 'Panel',
    defaultAccelerator: 'CmdOrCtrl+\\',
    enabled: (context) => !context.locked && context.hasPanel
  },
  {
    id: 'panel:splitDown',
    label: 'Split panel down',
    category: 'Panel',
    defaultAccelerator: 'CmdOrCtrl+Shift+\\',
    enabled: (context) => !context.locked && context.hasPanel
  },
  {
    id: 'panel:maximize',
    label: 'Fullscreen panel',
    category: 'Panel',
    defaultAccelerator: 'CmdOrCtrl+Enter',
    enabled: (context) => context.hasPanel
  },
  {
    id: 'panel:restore',
    label: 'Leave panel fullscreen',
    category: 'Panel',
    defaultAccelerator: 'Escape',
    fixed: true,
    enabled: (context) => context.maximized
  },
  {
    id: 'panel:close',
    label: 'Close panel',
    category: 'Panel',
    defaultAccelerator: 'CmdOrCtrl+W',
    enabled: (context) => !context.locked && context.hasPanel
  },

  {
    id: 'data:importPack',
    label: 'Import data pack',
    category: 'Data',
    defaultAccelerator: 'CmdOrCtrl+I'
  },

  {
    id: 'app:shortcuts',
    label: 'Keyboard shortcuts',
    category: 'Application',
    // Unbound by default. VS Code's Ctrl+K Ctrl+S is a chord, which Electron
    // accelerators cannot express, and every single-chord candidate worth having
    // is already spoken for.
    defaultAccelerator: null
  },
  {
    id: 'app:about',
    label: 'About',
    category: 'Application',
    defaultAccelerator: null
  }
]

export const ACTION_CATEGORIES: readonly ActionCategory[] = [
  'Layout',
  'Panel',
  'Data',
  'Application'
]

const BY_ID = new Map<ActionId, ActionDef>(ACTIONS.map((action) => [action.id, action]))

export function findAction(id: ActionId): ActionDef | undefined {
  return BY_ID.get(id)
}

/**
 * The user's changes only. Sparse on purpose, exactly like panel state: an entry
 * exists for an action the user has rebound and for nothing else, so a later
 * change to a default still reaches everyone who never touched it. `null` is a
 * deliberate unbinding, which is not the same as an absent key.
 */
export type Keymap = Partial<Record<ActionId, string | null>>

/** Catalogue defaults with the user's overrides merged over them. */
export type ResolvedKeymap = Record<ActionId, string | null>

export function resolveKeymap(overrides: Keymap): ResolvedKeymap {
  const resolved = {} as ResolvedKeymap
  for (const action of ACTIONS) {
    // A fixed binding ignores whatever is on disk. Nothing in the app writes one
    // there, but a hand-edited file should not be able to swallow Escape.
    if (action.fixed) {
      resolved[action.id] = action.defaultAccelerator
      continue
    }
    // Presence, not truthiness: `?? default` would turn a deliberate unbinding
    // back into the default, which is the one thing the sparse map exists to
    // tell apart from having never been touched.
    resolved[action.id] = Object.prototype.hasOwnProperty.call(overrides, action.id)
      ? (overrides[action.id] ?? null)
      : action.defaultAccelerator
  }
  return resolved
}

export interface KeymapLoad {
  keymap: Keymap
  /** What was dropped and why. */
  warnings: string[]
}

/**
 * Reads whatever was on disk into a keymap, keeping only entries that are
 * usable.
 *
 * **Total, like `resolve()` for data packs, and for a sharper reason.** An
 * unparseable accelerator reaching `Menu.buildFromTemplate` throws, and a throw
 * there leaves the app with no application menu — including the Help item that
 * opens the editor where the bad binding could be undone. A hand-edited or
 * half-written file has to degrade to "that one binding went back to default",
 * never to a window with no way out.
 */
export function sanitiseKeymap(raw: unknown): KeymapLoad {
  const keymap: Keymap = {}
  const warnings: string[] = []

  if (raw === null || typeof raw !== 'object') {
    if (raw !== null && raw !== undefined) warnings.push('Keybindings file is not an object.')
    return { keymap, warnings }
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const action = BY_ID.get(key as ActionId)
    if (!action) {
      warnings.push(`Unknown action "${key}".`)
      continue
    }
    if (action.fixed) {
      warnings.push(`"${key}" cannot be rebound.`)
      continue
    }
    if (value === null) {
      keymap[action.id] = null
      continue
    }
    if (typeof value !== 'string') {
      warnings.push(`"${key}" is not a key combination.`)
      continue
    }
    const problem = checkAccelerator(value)
    if (problem) {
      warnings.push(`"${key}" is bound to ${value}, which is ${problem}.`)
      continue
    }
    keymap[action.id] = normaliseAccelerator(value)
  }

  return { keymap, warnings }
}

/**
 * The action already holding a chord, if any. Compared on normalised form so
 * `Shift+CmdOrCtrl+s` and `CmdOrCtrl+Shift+S` count as the clash they are.
 */
export function findConflict(
  keymap: ResolvedKeymap,
  accelerator: string,
  exclude: ActionId
): ActionId | null {
  const wanted = normaliseAccelerator(accelerator)
  if (!wanted) return null

  for (const action of ACTIONS) {
    if (action.id === exclude) continue
    const current = keymap[action.id]
    if (current && normaliseAccelerator(current) === wanted) return action.id
  }
  return null
}

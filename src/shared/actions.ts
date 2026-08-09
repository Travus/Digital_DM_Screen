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

import { bindingStrokes, checkBinding, isChordBinding, normaliseBinding } from './accelerator'

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
  | 'panel:rename'
  | 'panel:changeModule'
  | 'split:flip'
  | 'split:equalise'
  | 'view:toggleTheme'
  | 'view:toggleSidebar'
  | 'data:importPack'
  | 'data:reloadPacks'
  | 'app:palette'
  | 'app:about'
  | 'app:shortcuts'
  | 'app:quit'

export type ActionCategory = 'Layout' | 'Panel' | 'View' | 'Data' | 'Application'

/**
 * What an action needs to know about the app to say whether it currently
 * applies.
 *
 * Deliberately a plain value rather than a store handle: this module is shared
 * with the main process, which has no store, and a predicate over a small
 * struct is testable without mounting anything.
 */
export interface ActionContext {
  /** The layout is locked — the arrangement is frozen, and so are the names on it. */
  locked: boolean
  /** There is a panel for the command to act on. */
  hasPanel: boolean
  /** Some panel is currently fullscreen. */
  maximized: boolean
  /** The target panel sits inside a split, so there is one to flip or even out. */
  hasSplit: boolean
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
   * Why this binding is not the user's to change. Presence is the flag; the text
   * is what keeps "fixed" from reading as an unexplained refusal, and it is shown
   * on the row in the editor.
   *
   * Both cases are keys some other layer has already claimed app-wide: Escape,
   * because a menu accelerator for it swallows the key inside text fields too
   * (so `App.tsx` owns it), and Quit, because it is the system's item. Listing
   * them rather than hiding them is the point — a binding that simply vanished
   * from the editor reads as a bug.
   */
  fixed?: string
  /**
   * Why the action does not currently apply, or `null` when it does.
   *
   * The action palette and the ⋯ panel menu consume this: a menu can get away
   * with listing a command that quietly does nothing, but the palette is the
   * discovery surface, and offering "Close panel" on a locked layout actively
   * misleads. Every predicate is the same guard that already lives somewhere
   * imperative — `store.closePanel`'s early return, `App`'s `if (target)` —
   * restated where a list can read it before drawing a row.
   *
   * **It returns the reason rather than a boolean, and there is deliberately no
   * second field beside it.** `!locked && hasPanel` cannot say which half
   * failed, so a surface showing a greyed row would have to guess between "the
   * layout is locked" and "there are no panels" — and a `disabledReason` field
   * sitting next to a predicate is two things that must agree with nothing
   * enforcing it. The first condition added without its reason updated produces
   * a row that states the wrong cause. Same argument as the accelerators
   * collapsing into this catalogue.
   *
   * The text is a **sentence fragment, lowercase and unpunctuated**, because
   * every consumer prefixes it: the palette says "“Close panel” is unavailable —
   * …" and the ⋯ menu tooltip says "Unavailable — …".
   */
  unavailable?: (context: ActionContext) => string | null
}

/*
 * One guard per condition, so a predicate is its reasons in priority order and
 * the reason cannot drift from the test that produced it.
 *
 * The lock comes first wherever it competes: it is the one of these the user can
 * undo on the spot, so it is the more useful answer when both hold.
 */
const ifLocked = (context: ActionContext): string | null =>
  context.locked ? 'the layout is locked' : null

const ifNoPanel = (context: ActionContext): string | null =>
  context.hasPanel ? null : 'this layout has no panels'

const ifNoSplit = (context: ActionContext): string | null =>
  context.hasSplit ? null : 'this panel is not inside a split'

const ifNotFullscreen = (context: ActionContext): string | null =>
  context.maximized ? null : 'no panel is fullscreen'

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
    // F2 went to the panel, which is the thing you are usually looking at when
    // you reach for a rename key. The layout keeps the same key one rung up.
    defaultAccelerator: 'Shift+F2',
    unavailable: ifLocked
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
    unavailable: (context) => ifLocked(context) ?? ifNoPanel(context)
  },
  {
    id: 'panel:splitDown',
    label: 'Split panel down',
    category: 'Panel',
    defaultAccelerator: 'CmdOrCtrl+Shift+\\',
    unavailable: (context) => ifLocked(context) ?? ifNoPanel(context)
  },
  {
    id: 'panel:maximize',
    label: 'Fullscreen panel',
    category: 'Panel',
    defaultAccelerator: 'CmdOrCtrl+Enter',
    unavailable: ifNoPanel
  },
  {
    id: 'panel:restore',
    label: 'Leave panel fullscreen',
    category: 'Panel',
    defaultAccelerator: 'Escape',
    fixed: 'Escape is handled by the app itself, so the menu cannot swallow it in a text field.',
    unavailable: ifNotFullscreen
  },
  {
    id: 'panel:close',
    label: 'Close panel',
    category: 'Panel',
    defaultAccelerator: 'CmdOrCtrl+W',
    unavailable: (context) => ifLocked(context) ?? ifNoPanel(context)
  },

  {
    id: 'panel:rename',
    label: 'Rename panel',
    category: 'Panel',
    defaultAccelerator: 'F2',
    // A name is part of the arrangement, not part of the contents: a locked
    // screen is one nothing can be knocked out of place on mid-session, and a
    // title relabelled by a stray double-click is exactly that.
    unavailable: (context) => ifLocked(context) ?? ifNoPanel(context)
  },
  {
    id: 'panel:changeModule',
    label: 'Change module',
    category: 'Panel',
    defaultAccelerator: null,
    unavailable: ifNoPanel
  },
  // Both ship unbound. They are occasional tidying commands rather than
  // something reached for mid-session, and every chord worth spending is better
  // spent elsewhere — the ⋯ menu is where these actually get used.
  {
    id: 'split:flip',
    label: 'Flip surrounding split',
    category: 'Panel',
    defaultAccelerator: null,
    unavailable: (context) => ifLocked(context) ?? ifNoSplit(context)
  },
  {
    id: 'split:equalise',
    label: 'Even out surrounding split',
    category: 'Panel',
    defaultAccelerator: null,
    unavailable: (context) => ifLocked(context) ?? ifNoSplit(context)
  },

  {
    id: 'view:toggleTheme',
    label: 'Switch light or dark theme',
    category: 'View',
    defaultAccelerator: null
  },
  {
    id: 'view:toggleSidebar',
    label: 'Show or hide recent layouts',
    category: 'View',
    defaultAccelerator: null
  },

  {
    id: 'data:importPack',
    label: 'Import data pack',
    category: 'Data',
    defaultAccelerator: 'CmdOrCtrl+I'
  },
  {
    id: 'data:reloadPacks',
    label: 'Reload data packs from disk',
    category: 'Data',
    defaultAccelerator: null
  },

  {
    id: 'app:palette',
    label: 'Action palette',
    category: 'Application',
    // The one Application command worth a default, because it is how every other
    // unbound command is reached. Ctrl+Shift+P is what VS Code, Zed and Sublime
    // all use for the same thing, so for most people it is already in the
    // fingers — which is worth more than a mnemonic matching our own name for it.
    defaultAccelerator: 'CmdOrCtrl+Shift+P'
  },
  {
    id: 'app:shortcuts',
    label: 'Keyboard shortcuts',
    category: 'Application',
    // Unbound by default. VS Code's Ctrl+K Ctrl+S is a chord, which Electron
    // accelerators cannot express, and every single-chord candidate worth having
    // is already spoken for. The palette reaches it without one.
    defaultAccelerator: null
  },
  {
    id: 'app:about',
    label: 'About',
    category: 'Application',
    defaultAccelerator: null
  },
  {
    id: 'app:quit',
    label: 'Quit',
    category: 'Application',
    // Here so the palette can offer it and the editor can say what the key is,
    // not so it can be rebound. The menu's `role: 'quit'` does the work; this
    // entry is what stops Ctrl+Q looking unaccounted for beside every other
    // command in the app.
    defaultAccelerator: 'CmdOrCtrl+Q',
    fixed: 'Quit belongs to the system menu item, which is what makes it work everywhere.'
  }
]

export const ACTION_CATEGORIES: readonly ActionCategory[] = [
  'Layout',
  'Panel',
  'View',
  'Data',
  'Application'
]

const BY_ID = new Map<ActionId, ActionDef>(ACTIONS.map((action) => [action.id, action]))

export function findAction(id: ActionId): ActionDef | undefined {
  return BY_ID.get(id)
}

/**
 * Why one command cannot run right now, for a surface that asks by id.
 *
 * The palette walks the whole catalogue and reads `unavailable` itself; the ⋯
 * panel menu has a hand-written row order and asks about five commands by name.
 * Both get their reasons from here rather than restating any guard locally —
 * that restatement is exactly what put a lock check in `PanelFrame` deciding
 * which rows to omit.
 */
export function actionUnavailable(id: ActionId, context: ActionContext): string | null {
  return BY_ID.get(id)?.unavailable?.(context) ?? null
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
    const problem = checkBinding(value)
    if (problem) {
      warnings.push(`"${key}" is bound to ${value}, which is ${problem}.`)
      continue
    }
    keymap[action.id] = normaliseBinding(value)
  }

  return { keymap, warnings }
}

/**
 * Every stroke used by a two-stroke binding, either half.
 *
 * This is the set that decides who dispatches what. A stroke in here cannot be a
 * menu accelerator, because Electron fires those before the web page sees the
 * key — the sequence would lose that stroke to the menu every time.
 */
export function chordStrokes(keymap: ResolvedKeymap): Set<string> {
  const strokes = new Set<string>()
  for (const [, binding] of chordBindings(keymap)) {
    for (const stroke of bindingStrokes(binding)) strokes.add(stroke)
  }
  return strokes
}

/**
 * Single-stroke bindings the menu has to give up, because some sequence uses
 * that same stroke.
 *
 * They move to the renderer, which can tell the two apart from context: with a
 * prefix pending the stroke finishes the sequence, and with nothing pending it
 * fires on its own. The menu cannot make that distinction — it only ever sees
 * one key at a time — which is why the accelerator has to go rather than be
 * cleverly suppressed. Their menu items print the binding in the label instead.
 */
export function rendererSingles(keymap: ResolvedKeymap): [ActionId, string][] {
  const strokes = chordStrokes(keymap)
  return (Object.entries(keymap) as [ActionId, string | null][])
    .filter((entry): entry is [ActionId, string] => {
      const binding = entry[1]
      return !!binding && !isChordBinding(binding) && strokes.has(binding)
    })
    .map(([id, binding]) => [id, normaliseBinding(binding) ?? binding])
}

/**
 * Why a binding cannot be used.
 *
 * Only the **first** stroke of a sequence is contested. Pressing it has to mean
 * one thing: if some other action is bound to that stroke alone, there is no way
 * to tell whether the user wants that action now or is opening a sequence, and
 * no amount of waiting resolves it — the single-stroke binding would have to
 * fire late, on a timeout, every time.
 *
 * A *second* stroke has no such problem and is deliberately allowed to collide.
 * With a prefix pending the context is unambiguous, so `CmdOrCtrl+K CmdOrCtrl+S`
 * coexists with `CmdOrCtrl+S` for Save; see `rendererSingles` for what that
 * costs. This is what makes the VS Code, Zed and Sublime keymaps expressible at
 * all — every one of them reuses a bound stroke as a finisher.
 */
export type Conflict =
  | { kind: 'duplicate'; action: ActionId }
  /** The candidate sequence opens on a stroke another action already owns alone. */
  | { kind: 'prefix-taken'; action: ActionId; stroke: string }
  /** The candidate single stroke is already how another action's sequence opens. */
  | { kind: 'prefix-blocks'; action: ActionId; stroke: string }

export function findConflict(
  keymap: ResolvedKeymap,
  binding: string,
  exclude: ActionId
): Conflict | null {
  const wanted = normaliseBinding(binding)
  if (!wanted) return null

  const wantedStrokes = bindingStrokes(wanted)
  const wantedIsChord = wantedStrokes.length > 1

  for (const action of ACTIONS) {
    if (action.id === exclude) continue

    const current = keymap[action.id]
    if (!current) continue
    const other = normaliseBinding(current)
    if (!other) continue

    if (other === wanted) return { kind: 'duplicate', action: action.id }

    const otherStrokes = bindingStrokes(other)
    const otherIsChord = otherStrokes.length > 1

    if (wantedIsChord && !otherIsChord && wantedStrokes[0] === other) {
      return { kind: 'prefix-taken', action: action.id, stroke: other }
    }

    if (!wantedIsChord && otherIsChord && otherStrokes[0] === wanted) {
      return { kind: 'prefix-blocks', action: action.id, stroke: wanted }
    }
  }
  return null
}

/** Bindings that need the renderer's sequence dispatcher rather than the menu. */
export function chordBindings(keymap: ResolvedKeymap): [ActionId, string][] {
  return (Object.entries(keymap) as [ActionId, string | null][])
    .filter((entry): entry is [ActionId, string] => !!entry[1] && isChordBinding(entry[1]))
    .map(([id, binding]) => [id, normaliseBinding(binding) ?? binding])
}

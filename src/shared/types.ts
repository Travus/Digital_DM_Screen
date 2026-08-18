/** Types shared between the Electron main process and the renderer. */

/**
 * Bumped to 2 when the document grew a list of windows in place of one `root`.
 *
 * `parseLayoutDoc` reads either, so every layout written before this still
 * opens. The migration is one way: a version 2 file has no `root` at the top and
 * an older build rejects it rather than half-loading it.
 */
export const LAYOUT_FORMAT_VERSION = 2

export type SplitDirection = 'row' | 'column'

/**
 * Where a command reaches, relative to the panel it starts from — the four
 * directions a panel can be swapped in. Screen directions rather than tree ones:
 * "the panel to the right" is a question about what the DM is looking at, and
 * `left`/`right` on a `column` split would be nonsense.
 */
export type MoveDirection = 'left' | 'right' | 'up' | 'down'

export const MOVE_DIRECTIONS: MoveDirection[] = ['left', 'right', 'up', 'down']

/** A leaf of the layout tree. Points at an entry in `LayoutDoc.panels`. */
export interface PanelNode {
  type: 'panel'
  id: string
  panelId: string
}

/**
 * An n-ary split. `sizes` runs parallel to `children` and holds flex weights;
 * they are normalised to sum to 1 but only their ratio matters.
 */
export interface SplitNode {
  type: 'split'
  id: string
  direction: SplitDirection
  children: LayoutNode[]
  sizes: number[]
}

export type LayoutNode = PanelNode | SplitNode

/** Per-panel payload: which module is mounted, plus its settings and live state. */
export interface PanelData {
  moduleId: string
  /** Overrides the module's own name in the panel header when set. */
  title?: string
  settings: Record<string, unknown>
  state: Record<string, unknown>
}

/**
 * One window of a layout: its own tiling, over the document's shared panels.
 *
 * A DM screen is often two screens — the laptop and the television the players
 * can see — so a layout is a list of these rather than one tree. `windows[0]` is
 * the primary: it carries the file buttons and closing it closes the app.
 */
export interface WindowDef {
  id: string
  name: string
  root: LayoutNode
  /**
   * False when the DM closed it. The window stays in the layout and keeps its
   * panels, and the Windows menu offers it back — a stray close of the players'
   * screen should not cost the arrangement on it.
   */
  open: boolean
}

export interface LayoutDoc {
  formatVersion: number
  name: string
  /** Never empty. The primary window is `windows[0]` and cannot be removed. */
  windows: WindowDef[]
  /**
   * Every panel in the document, whichever window shows it. Flat rather than
   * per-window so a panel keeps its identity if it ever moves between them, and
   * so anything reading another panel's state does not first have to find out
   * where it is.
   */
  panels: Record<string, PanelData>
  /**
   * Freezes the arrangement: no splitting, closing or resizing of panes.
   * Panel contents stay fully editable. Saved with the layout, and covering
   * every window of it.
   */
  locked: boolean
  createdAt: string
  updatedAt: string
}

export interface RecentEntry {
  path: string
  name: string
  openedAt: string
}

/**
 * What changes about a document without the document itself changing: a save
 * clears the unsaved flag and names the file, and neither touches a panel.
 */
export interface DocumentStatus {
  filePath: string | null
  dirty: boolean
}

/** The document and its status together — what a renderer boots from. */
export interface DocumentSnapshot extends DocumentStatus {
  doc: LayoutDoc
}

/** Where a window sat on screen, in screen pixels. */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A remembered window position, plus whether it was maximized.
 *
 * The rectangle is always the *normal* one — where the window sits when it is
 * not maximized — so un-maximizing a restored window puts it back somewhere
 * sensible rather than filling the screen a second time.
 *
 * Minimized is deliberately absent. Maximizing is an arrangement someone chose
 * and expects to find again; minimizing is "get out of the way for a moment",
 * and a layout that came back with its main window minimized would read as an
 * app that failed to start.
 */
export interface WindowPlacement extends WindowBounds {
  maximized?: boolean
}

/**
 * What gets stashed in userData so an unexpected quit loses nothing.
 *
 * A document snapshot plus where its windows were. The geometry is deliberately
 * here rather than in the `.dmscreen`: a layout describes a tiling, and which
 * monitor the players' screen is on is a fact about this desk. A layout copied
 * to another machine would otherwise arrive carrying an arrangement of displays
 * that machine does not have.
 *
 * Keyed by window id, and only the current document's windows are kept — open a
 * second layout and the first one's geometry is gone.
 */
export interface SessionSnapshot extends DocumentSnapshot {
  bounds?: Record<string, WindowPlacement>
}

/**
 * The scheme main serves picked image files over, and the URL shape the
 * renderer points an `<img>` at.
 *
 * Both halves live here so the handler and the `<img src>` cannot drift, the
 * way accelerators live in one catalogue. The host is fixed and the id is a
 * path segment: registering the scheme as `standard` makes the host part of the
 * origin, and an id per host would give every image its own.
 */
export const IMAGE_SCHEME = 'dmscreen-image'

export function imageUrl(id: string): string {
  return `${IMAGE_SCHEME}://image/${id}`
}

/**
 * One image the renderer is allowed to display.
 *
 * The layout stores `path`; `id` is what an `<img>` actually points at, since a
 * sandboxed renderer cannot read a file and the CSP does not allow `file:`.
 * `exists` is carried rather than inferred, so a panel restored from a layout
 * whose image has moved says so instead of showing a broken image icon.
 */
export interface ImageRef {
  id: string
  path: string
  exists: boolean
}

/* ---------------------------------------------------------- reference data */

/**
 * One reference card. Conditions, diseases and player abilities are all this
 * shape — deliberately, so a data pack has one entry format to learn rather
 * than three near-identical ones.
 *
 * `id` is the storage key: panel state records favourites and expansion by it.
 * For conditions `name` is load-bearing too, since cross-reference popovers scan
 * prose for it.
 */
export interface ReferenceEntry {
  id: string
  name: string
  summary: string
  lines: string[]
  /** Small tag beside the name — cost, source, class, whatever fits. */
  meta?: string
  /** Rendered under the effects in italics. */
  note?: string
}

/**
 * A tab in the abilities module. Groups are containers: a pack declaring one
 * whose id is already loaded merges its entries in rather than replacing it,
 * so adding a single option doesn't mean restating the rest.
 */
export interface AbilityGroup {
  id: string
  title: string
  blurb: string
  entries: ReferenceEntry[]
}

export interface RuleItem {
  term: string
  text: string
}

export interface RuleTable {
  caption?: string
  head: string[]
  rows: string[][]
}

/** Rendered as a definition list rather than cards. Also a container. */
export interface RuleSection {
  id: string
  title: string
  items?: RuleItem[]
  tables?: RuleTable[]
  note?: string
}

/* ----------------------------------------------------------------- packs */

export const DATAPACK_FORMAT_VERSION = 1

/**
 * The datasets a source can contribute. Stored per dataset even though the UI
 * offers two switches, so finer control is a UI change rather than a migration.
 */
export type Dataset = 'conditions' | 'rules' | 'abilities' | 'diseases' | 'names'

export const DATASETS: Dataset[] = ['conditions', 'rules', 'abilities', 'diseases', 'names']

/**
 * A pack adds content on top of whatever is already loaded; it never replaces a
 * source wholesale. Every section is optional.
 *
 * Entry ids are namespaced by the pack's own `id`, so two packs defining
 * `mm-careful` cannot collide — use the bundled-content switches to drop
 * duplicates rather than expecting one to win.
 */
export interface DataPack {
  formatVersion: number
  id: string
  name: string
  description?: string
  conditions?: ReferenceEntry[]
  rules?: RuleSection[]
  abilityGroups?: AbilityGroup[]
  diseases?: ReferenceEntry[]
}

/** A pack as recorded in the index: where it lives, and what it turned out to be. */
export interface DataPackRef {
  id: string
  name: string
  /**
   * Referenced rather than copied, so editing the file and reloading shows the
   * change. A moved file therefore empties whatever it provided — reported, not
   * swallowed.
   */
  path: string
}

/** A pack that failed to load, kept so the UI can say why rather than go quiet. */
export interface DataPackError {
  path: string
  reason: string
}

/**
 * Everything the renderer needs to build its reference data, handed over once at
 * startup and again whenever it changes.
 */
export interface DataSnapshot {
  packs: DataPack[]
  /** Parallel to `packs`, in load order. */
  refs: DataPackRef[]
  failed: DataPackError[]
  enabled: Record<Dataset, boolean>
}

export type MenuAction =
  | 'layout:new'
  | 'layout:open'
  | 'layout:openRecent'
  | 'recents:clear'
  | 'layout:save'
  | 'layout:saveAs'
  | 'layout:rename'
  | 'layout:toggleLock'
  | 'panel:splitRight'
  | 'panel:splitDown'
  | 'panel:swapLeft'
  | 'panel:swapRight'
  | 'panel:swapUp'
  | 'panel:swapDown'
  | 'panel:wider'
  | 'panel:narrower'
  | 'panel:taller'
  | 'panel:shorter'
  | 'panel:close'
  | 'panel:maximize'
  | 'panel:restore'
  | 'panel:rename'
  | 'panel:changeModule'
  | 'split:flip'
  | 'split:equalise'
  | 'window:new'
  | 'window:close'
  | 'view:toggleTheme'
  | 'view:toggleSidebar'
  | 'app:palette'
  | 'app:about'
  | 'app:shortcuts'

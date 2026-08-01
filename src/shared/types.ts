/** Types shared between the Electron main process and the renderer. */

export const LAYOUT_FORMAT_VERSION = 1

export type SplitDirection = 'row' | 'column'

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

export interface LayoutDoc {
  formatVersion: number
  name: string
  root: LayoutNode
  panels: Record<string, PanelData>
  /**
   * Freezes the arrangement: no splitting, closing or resizing of panes.
   * Panel contents stay fully editable. Saved with the layout.
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

/** What gets stashed in userData so an unexpected quit loses nothing. */
export interface SessionSnapshot {
  doc: LayoutDoc
  filePath: string | null
  dirty: boolean
}

export interface OpenResult {
  filePath: string
  doc: LayoutDoc
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
  | 'panel:close'
  | 'panel:maximize'
  | 'panel:restore'
  | 'app:about'

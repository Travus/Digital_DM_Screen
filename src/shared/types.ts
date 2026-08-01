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

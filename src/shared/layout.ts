/**
 * Layout tree model + pure operations, shared by main (validation on load) and
 * renderer (everything else). Every operation returns new nodes; nothing here
 * mutates its input.
 */
import {
  LAYOUT_FORMAT_VERSION,
  type LayoutDoc,
  type LayoutNode,
  type PanelData,
  type PanelNode,
  type SplitDirection,
  type SplitNode
} from './types'

let counter = 0
export function uid(prefix = 'id'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

export const EMPTY_MODULE_ID = 'empty'

export function makePanelData(moduleId = EMPTY_MODULE_ID): PanelData {
  return { moduleId, settings: {}, state: {} }
}

export function makePanelNode(panelId: string): PanelNode {
  return { type: 'panel', id: uid('node'), panelId }
}

export function createEmptyDoc(name = 'Untitled layout'): LayoutDoc {
  const panelId = uid('panel')
  const now = new Date().toISOString()
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    name,
    root: makePanelNode(panelId),
    panels: { [panelId]: makePanelData() },
    locked: false,
    createdAt: now,
    updatedAt: now
  }
}

/* ------------------------------------------------------------------ lookups */

export function findNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node
  if (node.type === 'split') {
    for (const child of node.children) {
      const hit = findNode(child, id)
      if (hit) return hit
    }
  }
  return null
}

export function findParent(node: LayoutNode, id: string): SplitNode | null {
  if (node.type !== 'split') return null
  for (const child of node.children) {
    if (child.id === id) return node
    const hit = findParent(child, id)
    if (hit) return hit
  }
  return null
}

export function collectPanelNodes(node: LayoutNode): PanelNode[] {
  if (node.type === 'panel') return [node]
  return node.children.flatMap(collectPanelNodes)
}

/** Depth-first panel-node order — this is what tab-cycling walks. */
export function panelNodeOrder(root: LayoutNode): string[] {
  return collectPanelNodes(root).map((node) => node.id)
}

/* --------------------------------------------------------------- transforms */

function replaceNode(root: LayoutNode, id: string, next: LayoutNode): LayoutNode {
  if (root.id === id) return next
  if (root.type !== 'split') return root
  return { ...root, children: root.children.map((child) => replaceNode(child, id, next)) }
}

function normalise(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (total <= 0) return sizes.map(() => 1 / sizes.length)
  return sizes.map((size) => size / total)
}

/**
 * Split `targetId` in two. When the target already sits inside a split running
 * the same direction we add a sibling instead of nesting, which keeps the tree
 * flat and makes drag-resizing behave the way you'd expect.
 */
export function splitNode(
  root: LayoutNode,
  targetId: string,
  direction: SplitDirection,
  newNode: LayoutNode
): LayoutNode {
  const parent = findParent(root, targetId)

  if (parent && parent.direction === direction) {
    const index = parent.children.findIndex((child) => child.id === targetId)
    const share = parent.sizes[index] ?? 1 / parent.children.length
    const children = [...parent.children]
    const sizes = [...parent.sizes]
    children.splice(index + 1, 0, newNode)
    sizes.splice(index, 1, share / 2, share / 2)
    return replaceNode(root, parent.id, { ...parent, children, sizes: normalise(sizes) })
  }

  const target = findNode(root, targetId)
  if (!target) return root
  const split: SplitNode = {
    type: 'split',
    id: uid('split'),
    direction,
    children: [target, newNode],
    sizes: [0.5, 0.5]
  }
  return replaceNode(root, targetId, split)
}

/**
 * Drop a node from the tree, handing its space to its siblings. A split left
 * with a single child collapses into that child so we never accumulate
 * pointless one-child wrappers. Returns null if the whole tree was removed.
 */
export function removeNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.id === id) return null
  if (root.type !== 'split') return root

  const index = root.children.findIndex((child) => child.id === id)
  if (index >= 0) {
    const children = root.children.filter((_, i) => i !== index)
    const sizes = root.sizes.filter((_, i) => i !== index)
    if (children.length === 1) return children[0]
    return { ...root, children, sizes: normalise(sizes) }
  }

  return {
    ...root,
    children: root.children.map((child) => {
      const next = removeNode(child, id)
      // A nested removal can only return null if `child.id === id`, which the
      // index check above already handled, so `next` is non-null here.
      return next ?? child
    })
  }
}

export function setSplitSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  const split = findNode(root, splitId)
  if (!split || split.type !== 'split') return root
  return replaceNode(root, splitId, { ...split, sizes: normalise(sizes) })
}

/** Flip a split between side-by-side and stacked. */
export function toggleSplitDirection(root: LayoutNode, splitId: string): LayoutNode {
  const split = findNode(root, splitId)
  if (!split || split.type !== 'split') return root
  return replaceNode(root, splitId, {
    ...split,
    direction: split.direction === 'row' ? 'column' : 'row'
  })
}

/** Even out one split's children. */
export function equaliseSplit(root: LayoutNode, splitId: string): LayoutNode {
  const split = findNode(root, splitId)
  if (!split || split.type !== 'split') return root
  return setSplitSizes(root, splitId, split.children.map(() => 1))
}

/** Drop any panel payloads no longer referenced by the tree. */
export function pruneOrphanPanels(doc: LayoutDoc): LayoutDoc {
  const live = new Set(collectPanelNodes(doc.root).map((node) => node.panelId))
  const panels: Record<string, PanelData> = {}
  for (const [panelId, data] of Object.entries(doc.panels)) {
    if (live.has(panelId)) panels[panelId] = data
  }
  return { ...doc, panels }
}

/* --------------------------------------------------------------- validation */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateNode(value: unknown, panelIds: Set<string>): value is LayoutNode {
  if (!isRecord(value) || typeof value.id !== 'string') return false

  if (value.type === 'panel') {
    if (typeof value.panelId !== 'string') return false
    panelIds.add(value.panelId)
    return true
  }

  if (value.type === 'split') {
    if (value.direction !== 'row' && value.direction !== 'column') return false
    if (!Array.isArray(value.children) || value.children.length === 0) return false
    if (!Array.isArray(value.sizes) || value.sizes.length !== value.children.length) return false
    if (!value.sizes.every((size) => typeof size === 'number' && Number.isFinite(size))) return false
    return value.children.every((child) => validateNode(child, panelIds))
  }

  return false
}

/**
 * Structural check for a layout file. Deliberately strict about the tree (a
 * malformed tree crashes rendering) and permissive about panel settings/state,
 * since those are module-defined and each module falls back to its own defaults.
 */
export function parseLayoutDoc(value: unknown): LayoutDoc | null {
  if (!isRecord(value)) return null
  if (typeof value.name !== 'string') return null
  if (!isRecord(value.panels)) return null

  const root = value.root
  const referenced = new Set<string>()
  if (!validateNode(root, referenced)) return null

  const panels: Record<string, PanelData> = {}
  for (const panelId of referenced) {
    const raw = value.panels[panelId]
    if (!isRecord(raw) || typeof raw.moduleId !== 'string') {
      // Referenced but missing/broken — fall back to an empty panel rather than
      // rejecting the whole file.
      panels[panelId] = makePanelData()
      continue
    }
    panels[panelId] = {
      moduleId: raw.moduleId,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      settings: isRecord(raw.settings) ? raw.settings : {},
      state: isRecord(raw.state) ? raw.state : {}
    }
  }

  const now = new Date().toISOString()
  return {
    formatVersion: typeof value.formatVersion === 'number' ? value.formatVersion : 1,
    name: value.name,
    root,
    panels,
    locked: value.locked === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now
  }
}

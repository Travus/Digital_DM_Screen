/**
 * Layout tree model + pure operations, shared by main (validation on load) and
 * renderer (everything else). Every operation returns new nodes; nothing here
 * mutates its input.
 */
import {
  LAYOUT_FORMAT_VERSION,
  MOVE_DIRECTIONS,
  type LayoutDoc,
  type LayoutNode,
  type MoveDirection,
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
  return setSplitSizes(
    root,
    splitId,
    split.children.map(() => 1)
  )
}

/* ------------------------------------------------------- moving and resizing */

/**
 * A node's share of the window, as fractions of it: `{ x: 0.5, width: 0.5 }` is
 * the right-hand half. Splitters are a few pixels the tree knows nothing about,
 * so the boxes abut exactly where the panes on screen very nearly do.
 */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where every panel sits, laid out the way the flex tiling lays it out.
 *
 * The neighbour lookup below is geometric rather than a walk up the tree,
 * because a walk answers a different question. In `column[row[a, b], row[c, d]]`
 * the panel under `b` is `d`, but the nearest ancestor running that way is the
 * outer column, whose next child is the whole second row — and picking one of
 * its panels means asking which of them is *under b*, which is the geometry
 * again. Doing it in fractions keeps that answer pure and testable.
 */
export function panelBoxes(root: LayoutNode): Map<string, Box> {
  const boxes = new Map<string, Box>()

  const walk = (node: LayoutNode, box: Box): void => {
    if (node.type === 'panel') {
      boxes.set(node.id, box)
      return
    }
    const total = node.sizes.reduce((sum, size) => sum + size, 0)
    const horizontal = node.direction === 'row'
    let offset = 0
    node.children.forEach((child, index) => {
      // A hand-edited file can carry sizes that sum to zero; equal shares are
      // what the renderer draws for those, so they are what this measures.
      const share = total > 0 ? (node.sizes[index] ?? 0) / total : 1 / node.children.length
      walk(child, {
        x: horizontal ? box.x + offset * box.width : box.x,
        y: horizontal ? box.y : box.y + offset * box.height,
        width: horizontal ? share * box.width : box.width,
        height: horizontal ? box.height : share * box.height
      })
      offset += share
    })
  }

  walk(root, { x: 0, y: 0, width: 1, height: 1 })
  return boxes
}

/** Fractions of a window compare equal a long way below anything visible. */
const EPSILON = 1e-6

/** Comparable integers, so ties are ties rather than a rounding artefact. */
const quantise = (value: number): number => Math.round(value / EPSILON)

/**
 * One box seen from the direction of travel: `near` and `far` are its edges
 * along that axis, `from` and `to` its extent across it.
 */
function edges(
  box: Box,
  horizontal: boolean
): { near: number; far: number; from: number; to: number } {
  return horizontal
    ? { near: box.x, far: box.x + box.width, from: box.y, to: box.y + box.height }
    : { near: box.y, far: box.y + box.height, from: box.x, to: box.x + box.width }
}

/**
 * The panel on each side of `nodeId`, or null where there is none.
 *
 * A candidate qualifies by lying wholly beyond the edge it would be reached
 * across and overlapping the panel across the other axis — the two together are
 * what "in that direction" means on screen. Of those, the nearest wins; on a tie
 * the one sharing the most edge, and on a tie there the topmost or leftmost, so
 * a panel facing a stack of equal ones always picks the same member of it.
 */
export function neighbourPanels(
  root: LayoutNode,
  nodeId: string | null
): Record<MoveDirection, string | null> {
  const found: Record<MoveDirection, string | null> = {
    left: null,
    right: null,
    up: null,
    down: null
  }
  if (!nodeId) return found

  const boxes = panelBoxes(root)
  const start = boxes.get(nodeId)
  if (!start) return found

  for (const direction of MOVE_DIRECTIONS) {
    const horizontal = direction === 'left' || direction === 'right'
    const forward = direction === 'right' || direction === 'down'
    const mine = edges(start, horizontal)

    const candidates = [...boxes]
      .filter(([id]) => id !== nodeId)
      .map(([id, box]) => {
        const other = edges(box, horizontal)
        return {
          id,
          gap: quantise(forward ? other.near - mine.far : mine.near - other.far),
          overlap: quantise(Math.min(mine.to, other.to) - Math.max(mine.from, other.from)),
          across: quantise(other.from)
        }
      })
      // A gap of zero is the ordinary case — panes abut. Anything behind us, or
      // merely touching a corner, is not in this direction at all.
      .filter((candidate) => candidate.gap >= 0 && candidate.overlap > 0)
      .sort((a, b) => a.gap - b.gap || b.overlap - a.overlap || a.across - b.across)

    found[direction] = candidates[0]?.id ?? null
  }

  return found
}

/** Which sides a panel has a neighbour on — what the action guards ask. */
export function neighbourSides(
  root: LayoutNode,
  nodeId: string | null
): Record<MoveDirection, boolean> {
  const neighbours = neighbourPanels(root, nodeId)
  return {
    left: neighbours.left !== null,
    right: neighbours.right !== null,
    up: neighbours.up !== null,
    down: neighbours.down !== null
  }
}

/**
 * Trade what two panel nodes point at, leaving the tree exactly as it was.
 *
 * Only the `panelId` moves. A node id names a *place* — it is what
 * `activeNodeId` and `maximizedNodeId` hold and what React keys the pane on — so
 * moving the contents rather than the nodes keeps a swap from re-tiling: the
 * sizes stay with the panes, and two panels of different sizes swap modules
 * without either changing shape.
 */
export function swapPanelNodes(root: LayoutNode, aId: string, bId: string): LayoutNode {
  if (aId === bId) return root
  const a = findNode(root, aId)
  const b = findNode(root, bId)
  if (a?.type !== 'panel' || b?.type !== 'panel') return root

  const swap = (node: LayoutNode): LayoutNode => {
    if (node.type === 'panel') {
      if (node.id === aId) return { ...node, panelId: b.panelId }
      if (node.id === bId) return { ...node, panelId: a.panelId }
      return node
    }
    return { ...node, children: node.children.map(swap) }
  }
  return swap(root)
}

/**
 * How much of a split one press of the resize keys moves. Big enough to see and
 * small enough to aim with, held down.
 */
export const RESIZE_STEP = 0.05

/**
 * The smallest share a pane may be keyed down to.
 *
 * The splitter stops at 90 px, which this cannot say: a fraction of a window is
 * all the tree knows, and the pixels are the renderer's. A twentieth of the
 * split it sits in lands near the same place on an ordinary window and, unlike a
 * pixel count, cannot be shrunk to nothing by a smaller one.
 */
const MIN_SHARE = 0.05

/** The splits from the root down to `id`, each with the child it descends into. */
function ancestry(root: LayoutNode, id: string): { split: SplitNode; index: number }[] {
  if (root.type !== 'split') return []
  for (const [index, child] of root.children.entries()) {
    if (child.id === id) return [{ split: root, index }]
    const deeper = ancestry(child, id)
    if (deeper.length) return [{ split: root, index }, ...deeper]
  }
  return []
}

/**
 * Give a panel more or less of the split it sits in — the keyboard's half of the
 * splitter, `delta` being a positive share to grow by.
 *
 * The boundary it moves is the innermost one on that axis: the same handle the
 * DM would have grabbed. Where the panel is last in its split there is nothing
 * on that side, so the boundary before it moves instead, which is what makes
 * "wider" mean wider rather than "wider, unless you are on the right".
 *
 * Returns the root unchanged when there is nothing to trade with or no room
 * left, so a key held at the limit does not go on marking the layout unsaved.
 */
export function resizePanelShare(
  root: LayoutNode,
  nodeId: string,
  axis: SplitDirection,
  delta: number
): LayoutNode {
  const chain = ancestry(root, nodeId)

  for (let step = chain.length - 1; step >= 0; step -= 1) {
    const { split, index } = chain[step]
    if (split.direction !== axis || split.children.length < 2) continue

    const total = split.sizes.reduce((sum, size) => sum + size, 0)
    if (total <= 0) continue
    const other = index < split.children.length - 1 ? index + 1 : index - 1

    const mine = split.sizes[index]
    const theirs = split.sizes[other]
    const floor = MIN_SHARE * total
    // Only the two panes either side of the boundary move, exactly as the drag
    // does it, and neither may be pushed under the floor.
    const move = Math.max(floor - mine, Math.min(theirs - floor, delta * total))
    if (Math.abs(move) < EPSILON) return root

    const sizes = [...split.sizes]
    sizes[index] = mine + move
    sizes[other] = theirs - move
    return setSplitSizes(root, split.id, sizes)
  }

  return root
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
    if (!value.sizes.every((size) => typeof size === 'number' && Number.isFinite(size)))
      return false
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

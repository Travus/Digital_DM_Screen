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
  type SplitNode,
  type WindowDef
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

/** What the first window of a layout is called, and what a v1 file migrates to. */
export const PRIMARY_WINDOW_NAME = 'Main window'

/**
 * The id a version 1 layout's single window takes when it is migrated.
 *
 * Fixed rather than minted, so opening the same old file twice names the same
 * window both times — which is what lets the remembered geometry in
 * `session.json`, keyed by window id, still find it.
 */
export const PRIMARY_WINDOW_ID = 'win_main'

export function createEmptyDoc(name = 'Untitled layout'): LayoutDoc {
  const panelId = uid('panel')
  const now = new Date().toISOString()
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    name,
    windows: [
      { id: PRIMARY_WINDOW_ID, name: PRIMARY_WINDOW_NAME, root: makePanelNode(panelId), open: true }
    ],
    panels: { [panelId]: makePanelData() },
    locked: false,
    createdAt: now,
    updatedAt: now
  }
}

/* ------------------------------------------------------------------ windows */

export function findWindow(doc: LayoutDoc, windowId: string): WindowDef | undefined {
  return doc.windows.find((window) => window.id === windowId)
}

/** The primary, which carries the file commands and cannot be closed on its own. */
export function primaryWindow(doc: LayoutDoc): WindowDef {
  return doc.windows[0]
}

export function isPrimaryWindow(doc: LayoutDoc, windowId: string): boolean {
  return doc.windows[0]?.id === windowId
}

/**
 * Which window shows a panel, or null if none does.
 *
 * The panels are one flat map for the whole document, so a write aimed at a
 * panel has to find out whose it is before it can be routed to the window that
 * owns it — the initiative tracker pushing HP back to a party panel on the other
 * screen is the case this exists for.
 */
export function windowOfPanel(doc: LayoutDoc, panelId: string): string | null {
  for (const window of doc.windows) {
    if (collectPanelNodes(window.root).some((node) => node.panelId === panelId)) return window.id
  }
  return null
}

/** Which window a node id names a place in, or null if none does. */
export function windowOfNode(doc: LayoutDoc, nodeId: string): string | null {
  return doc.windows.find((window) => findNode(window.root, nodeId))?.id ?? null
}

/** Replace one window's tiling, leaving every other window alone. */
export function setWindowRoot(doc: LayoutDoc, windowId: string, root: LayoutNode): LayoutDoc {
  return {
    ...doc,
    windows: doc.windows.map((window) => (window.id === windowId ? { ...window, root } : window))
  }
}

export function setWindowOpen(doc: LayoutDoc, windowId: string, open: boolean): LayoutDoc {
  // The primary is what closing the app goes through, so it is never marked
  // closed — a session restored after a quit must not come back windowless.
  if (isPrimaryWindow(doc, windowId)) return doc
  return {
    ...doc,
    windows: doc.windows.map((window) => (window.id === windowId ? { ...window, open } : window))
  }
}

export function renameWindow(doc: LayoutDoc, windowId: string, name: string): LayoutDoc {
  const trimmed = name.trim()
  if (!trimmed) return doc
  return {
    ...doc,
    windows: doc.windows.map((window) =>
      window.id === windowId ? { ...window, name: trimmed } : window
    )
  }
}

/**
 * The next free "Window N".
 *
 * Counts up past names already taken rather than off the length, so closing
 * window 3 and adding another does not produce a second window 3.
 */
export function defaultWindowName(doc: LayoutDoc): string {
  const taken = new Set(doc.windows.map((window) => window.name))
  for (let n = doc.windows.length + 1; ; n += 1) {
    const candidate = `Window ${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** A new window, open, holding one empty panel. */
export function addWindow(doc: LayoutDoc, name = defaultWindowName(doc)): LayoutDoc {
  const panelId = uid('panel')
  const window: WindowDef = {
    id: uid('win'),
    name,
    root: makePanelNode(panelId),
    open: true
  }
  return {
    ...doc,
    windows: [...doc.windows, window],
    panels: { ...doc.panels, [panelId]: makePanelData() }
  }
}

/**
 * Drop a window and everything on it. The primary is refused — it is the one
 * every layout has to have.
 */
export function removeWindow(doc: LayoutDoc, windowId: string): LayoutDoc {
  if (isPrimaryWindow(doc, windowId)) return doc
  const next = doc.windows.filter((window) => window.id !== windowId)
  if (next.length === doc.windows.length) return doc
  return pruneOrphanPanels({ ...doc, windows: next })
}

/**
 * Fold one window's copy of the document into the shared one, taking only what
 * that window owns.
 *
 * Several renderers hold the same document and each publishes the whole of it
 * after an edit. Adopting an incoming copy wholesale would let the last message
 * to arrive undo a change made in another window a moment earlier. So a message
 * is read for the part its sender is entitled to speak for, and nothing else.
 *
 * A window owns **its own tiling and the contents of the panels on it**. It does
 * not own the window list's shape: `name` and `open` stay as the base has them,
 * because adding, closing and renaming a window are commands that go through
 * main and come back to everyone. That split is what makes this conflict-free
 * rather than merely unlikely to conflict — two windows editing at once are
 * writing to disjoint halves by construction.
 *
 * Panels the window has stopped pointing at are dropped, and ones it has taken
 * up are added, so closing a panel in one window does not leave its payload
 * behind for `pruneOrphanPanels` to find later.
 */
export function mergeWindowSlice(
  base: LayoutDoc,
  incoming: LayoutDoc,
  windowId: string
): LayoutDoc {
  const from = findWindow(incoming, windowId)
  const onto = findWindow(base, windowId)
  if (!from || !onto) return base

  const owned = new Set(collectPanelNodes(from.root).map((node) => node.panelId))
  const wasOwned = new Set(collectPanelNodes(onto.root).map((node) => node.panelId))

  const panels: Record<string, PanelData> = {}
  for (const [panelId, data] of Object.entries(base.panels)) {
    // Another window's panel, or one this window still has: keep what is here.
    if (!wasOwned.has(panelId) || owned.has(panelId)) panels[panelId] = data
  }
  for (const panelId of owned) {
    const data = incoming.panels[panelId]
    if (data) panels[panelId] = data
  }

  return {
    ...base,
    windows: base.windows.map((window) =>
      window.id === windowId ? { ...window, root: from.root } : window
    ),
    panels,
    updatedAt: incoming.updatedAt
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

/**
 * Drop any panel payloads no longer referenced by a tree.
 *
 * Every window counts, including the closed ones. A closed window keeps its
 * panels on purpose — that is the whole of what "closed rather than removed"
 * buys — so pruning to the open ones would empty it the moment anything else
 * changed.
 */
export function pruneOrphanPanels(doc: LayoutDoc): LayoutDoc {
  const live = new Set(
    doc.windows.flatMap((window) => collectPanelNodes(window.root).map((node) => node.panelId))
  )
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
 * The windows of a file, or null if it does not describe any.
 *
 * Two shapes are accepted. Version 2 carries a `windows` list. Version 1 carries
 * one `root` at the top, which becomes the single primary window — files written
 * before the app had more than one screen still open, and open unchanged.
 */
function readWindows(value: Record<string, unknown>, referenced: Set<string>): WindowDef[] | null {
  if (value.windows === undefined) {
    if (!validateNode(value.root, referenced)) return null
    return [{ id: PRIMARY_WINDOW_ID, name: PRIMARY_WINDOW_NAME, root: value.root, open: true }]
  }

  if (!Array.isArray(value.windows) || value.windows.length === 0) return null

  const windows: WindowDef[] = []
  for (const [index, raw] of value.windows.entries()) {
    if (!isRecord(raw)) return null
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
    if (!validateNode(raw.root, referenced)) return null
    windows.push({
      id: raw.id,
      name: raw.name,
      root: raw.root,
      // Absent means open. The primary is forced open whatever the file says —
      // a layout whose only window is closed has nothing to show.
      open: index === 0 || raw.open !== false
    })
  }
  return windows
}

/**
 * Structural check for a layout file. Deliberately strict about the trees (a
 * malformed tree crashes rendering) and permissive about panel settings/state,
 * since those are module-defined and each module falls back to its own defaults.
 */
export function parseLayoutDoc(value: unknown): LayoutDoc | null {
  if (!isRecord(value)) return null
  if (typeof value.name !== 'string') return null
  if (!isRecord(value.panels)) return null

  const referenced = new Set<string>()
  const windows = readWindows(value, referenced)
  if (!windows) return null

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
    // Stamped with what this build writes, not with what was read. A version 1
    // file has been migrated by the time it gets here, and saying otherwise
    // would put the old number back on the next save.
    formatVersion: LAYOUT_FORMAT_VERSION,
    name: value.name,
    windows,
    panels,
    locked: value.locked === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now
  }
}

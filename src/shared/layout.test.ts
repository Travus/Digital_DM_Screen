import { describe, expect, it } from 'vitest'
import {
  addWindow,
  mergeWindowSlice,
  collectPanelNodes,
  createEmptyDoc,
  defaultWindowName,
  equaliseSplit,
  findNode,
  findParent,
  findWindow,
  isPrimaryWindow,
  makePanelData,
  makePanelNode,
  removeWindow,
  renameWindow,
  setWindowOpen,
  setWindowRoot,
  swapPanelsInDoc,
  windowOfNode,
  windowOfPanel,
  neighbourPanels,
  neighbourSides,
  panelNodeOrder,
  parseLayoutDoc,
  pruneOrphanPanels,
  removeNode,
  resizePanelShare,
  setSplitSizes,
  splitNode,
  swapPanelNodes,
  toggleSplitDirection,
  uid
} from './layout'
import type { LayoutDoc, LayoutNode, PanelNode, SplitNode } from './types'

const panel = (id: string, panelId = `p_${id}`): LayoutNode => ({ type: 'panel', id, panelId })

const split = (id: string, direction: 'row' | 'column', children: LayoutNode[]): SplitNode => ({
  type: 'split',
  id,
  direction,
  children,
  sizes: children.map(() => 1 / children.length)
})

/** a | b over c — one of each nesting, so a walk has somewhere to get lost. */
const tree = (): SplitNode =>
  split('root', 'row', [panel('a'), split('inner', 'column', [panel('b'), panel('c')])])

const asSplit = (node: LayoutNode | null): SplitNode => {
  if (!node || node.type !== 'split') throw new Error('expected a split')
  return node
}

describe('walking the tree', () => {
  it('finds a node at any depth, and nothing for an unknown id', () => {
    expect(findNode(tree(), 'c')).toMatchObject({ type: 'panel', panelId: 'p_c' })
    expect(findNode(tree(), 'inner')).toMatchObject({ type: 'split' })
    expect(findNode(tree(), 'nope')).toBeNull()
  })

  it('reports the split holding a node, not the node itself', () => {
    // What Flip and Even Out act on: the split *containing* the target, which is
    // also what `actionContext` reads to decide whether those commands apply.
    expect(findParent(tree(), 'b')?.id).toBe('inner')
    expect(findParent(tree(), 'inner')?.id).toBe('root')
    // The root has no parent, and neither has an id that is not in the tree.
    expect(findParent(tree(), 'root')).toBeNull()
    expect(findParent(tree(), 'nope')).toBeNull()
  })

  it('collects panels depth-first, which is the order tab-cycling walks', () => {
    expect(panelNodeOrder(tree())).toEqual(['a', 'b', 'c'])
    expect(collectPanelNodes(panel('lone'))).toHaveLength(1)
  })
})

describe('splitting a panel', () => {
  it('adds a sibling when the surrounding split already runs that way', () => {
    // Kept flat on purpose: nesting a row inside a row would give two draggable
    // edges where the user sees one boundary.
    const next = asSplit(splitNode(tree(), 'a', 'row', panel('new')))
    expect(next.children.map((child) => child.id)).toEqual(['a', 'new', 'inner'])
  })

  it('wraps the target in a new split when the direction differs', () => {
    const next = asSplit(splitNode(tree(), 'a', 'column', panel('new')))
    const wrapper = asSplit(next.children[0])
    expect(wrapper.direction).toBe('column')
    expect(wrapper.children.map((child) => child.id)).toEqual(['a', 'new'])
    expect(wrapper.sizes).toEqual([0.5, 0.5])
  })

  it('halves the target its own share rather than the whole split', () => {
    const root = split('root', 'row', [panel('a'), panel('b')])
    root.sizes = [0.8, 0.2]
    const next = asSplit(splitNode(root, 'a', 'row', panel('new')))
    expect(next.sizes).toEqual([0.4, 0.4, 0.2])
  })

  it('splits a lone panel into a split, since there is no parent to join', () => {
    const next = asSplit(splitNode(panel('only'), 'only', 'row', panel('new')))
    expect(next.children.map((child) => child.id)).toEqual(['only', 'new'])
  })

  it('leaves the tree alone when the target is not in it', () => {
    const root = tree()
    expect(splitNode(root, 'nope', 'row', panel('new'))).toEqual(root)
  })

  it('does not mutate the tree it was given', () => {
    // Every operation here returns new nodes; the store relies on that to know
    // what changed.
    const root = tree()
    const before = structuredClone(root)
    splitNode(root, 'b', 'row', panel('new'))
    expect(root).toEqual(before)
  })
})

describe('removing a node', () => {
  it('collapses a split left holding one child into that child', () => {
    // Otherwise every close leaves a one-child wrapper behind, and the tree
    // accumulates splits with no boundary to drag.
    const next = removeNode(tree(), 'b')
    expect(asSplit(next).children.map((child) => child.id)).toEqual(['a', 'c'])
  })

  it('keeps a split with two children left, renormalising the sizes', () => {
    const root = split('root', 'row', [panel('a'), panel('b'), panel('c')])
    root.sizes = [0.5, 0.25, 0.25]
    const next = asSplit(removeNode(root, 'b'))
    expect(next.children.map((child) => child.id)).toEqual(['a', 'c'])
    // The gap is shared out in proportion, not left as a hole summing to 0.75.
    expect(next.sizes).toEqual([2 / 3, 1 / 3])
  })

  it('returns null when the removed node was the whole tree', () => {
    expect(removeNode(panel('only'), 'only')).toBeNull()
  })

  it('leaves the tree alone when the id is not in it', () => {
    const root = tree()
    expect(removeNode(root, 'nope')).toEqual(root)
  })

  it('does not mutate the tree it was given', () => {
    const root = tree()
    const before = structuredClone(root)
    removeNode(root, 'c')
    expect(root).toEqual(before)
  })
})

describe('resizing and flipping', () => {
  it('normalises whatever sizes it is handed', () => {
    // The splitter drags in pixels, so what arrives here rarely sums to 1.
    const next = asSplit(setSplitSizes(tree(), 'root', [300, 100]))
    expect(next.sizes).toEqual([0.75, 0.25])
  })

  it('falls back to equal shares rather than dividing by zero', () => {
    const next = asSplit(setSplitSizes(tree(), 'root', [0, 0]))
    expect(next.sizes).toEqual([0.5, 0.5])
  })

  it('evens out a lopsided split', () => {
    const root = split('root', 'row', [panel('a'), panel('b'), panel('c')])
    root.sizes = [0.9, 0.05, 0.05]
    expect(asSplit(equaliseSplit(root, 'root')).sizes).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  it('flips a split between side-by-side and stacked', () => {
    const flipped = asSplit(toggleSplitDirection(tree(), 'inner'))
    expect(asSplit(findNode(flipped, 'inner')).direction).toBe('row')
  })

  it('ignores an id that is a panel rather than a split', () => {
    // The ⋯ menu and the palette both guard this, but the guard lives here too:
    // a panel has no sizes and no direction to change.
    const root = tree()
    expect(setSplitSizes(root, 'a', [1, 2])).toEqual(root)
    expect(toggleSplitDirection(root, 'a')).toEqual(root)
    expect(equaliseSplit(root, 'a')).toEqual(root)
  })
})

describe('finding the panel next door', () => {
  it('reads a neighbour off the screen, not off the nesting', () => {
    // a | b over c. `a` runs the full height, so both right-hand panels are to
    // the right of it; `b` and `c` are above and below one another.
    expect(neighbourPanels(tree(), 'a').right).toBe('b')
    expect(neighbourPanels(tree(), 'b').left).toBe('a')
    expect(neighbourPanels(tree(), 'b').down).toBe('c')
    expect(neighbourPanels(tree(), 'c').up).toBe('b')
  })

  it('has nothing off the edges of the window', () => {
    expect(neighbourPanels(tree(), 'a').left).toBeNull()
    expect(neighbourPanels(tree(), 'a').up).toBeNull()
    expect(neighbourPanels(tree(), 'c').down).toBeNull()
    // A lone panel is on every edge at once.
    expect(neighbourSides(panel('only'), 'only')).toEqual({
      left: false,
      right: false,
      up: false,
      down: false
    })
  })

  it('picks the panel in line rather than the first one across the boundary', () => {
    // Two rows of two. This is the case a walk up the tree gets wrong: the
    // nearest ancestor running downwards is the outer column, whose next child
    // is the whole second row — and `b` is above `d`, not above `c`.
    const root = split('root', 'column', [
      split('top', 'row', [panel('a'), panel('b')]),
      split('bottom', 'row', [panel('c'), panel('d')])
    ])
    expect(neighbourPanels(root, 'b').down).toBe('d')
    expect(neighbourPanels(root, 'a').down).toBe('c')
    expect(neighbourPanels(root, 'd').up).toBe('b')
  })

  it('takes the one sharing the most edge, then the topmost', () => {
    // `a` faces a stack of three. The middle one shares the most of `a`'s edge,
    // and where two share the same it is the higher — so a swap repeated in one
    // direction lands somewhere predictable rather than somewhere arbitrary.
    const stack = split('right', 'column', [panel('b'), panel('c'), panel('d')])
    stack.sizes = [0.25, 0.5, 0.25]
    const root = split('root', 'row', [panel('a'), stack])
    expect(neighbourPanels(root, 'a').right).toBe('c')

    stack.sizes = [0.375, 0.375, 0.25]
    expect(neighbourPanels(root, 'a').right).toBe('b')
  })

  it('ignores a panel that only touches a corner', () => {
    // `a` over `b` on the left, `c` over `d` on the right, boundaries level.
    // `b`'s top corner meets `c`'s bottom one exactly, and touching at a point
    // is not being next to something — `b` reaches `d` and nothing else.
    const left = split('left', 'column', [panel('a'), panel('b')])
    const right = split('right', 'column', [panel('c'), panel('d')])
    const root = split('root', 'row', [left, right])
    expect(neighbourPanels(root, 'b').right).toBe('d')
    expect(neighbourPanels(root, 'a').right).toBe('c')
  })

  it('answers for a node that is not in the tree without throwing', () => {
    expect(neighbourPanels(tree(), 'nope').right).toBeNull()
    expect(neighbourPanels(tree(), null).right).toBeNull()
  })
})

describe('swapping two panels', () => {
  it('trades the contents and leaves the tree alone', () => {
    const next = swapPanelNodes(tree(), 'a', 'c')
    // The node ids stay where they were — they are what the active panel, the
    // fullscreen panel and the pane sizes are all held by.
    expect(panelNodeOrder(next)).toEqual(['a', 'b', 'c'])
    expect((findNode(next, 'a') as PanelNode).panelId).toBe('p_c')
    expect((findNode(next, 'c') as PanelNode).panelId).toBe('p_a')
    expect(asSplit(next).sizes).toEqual(asSplit(tree()).sizes)
  })

  it('does nothing for a panel swapped with itself, or with a split', () => {
    const root = tree()
    expect(swapPanelNodes(root, 'a', 'a')).toEqual(root)
    expect(swapPanelNodes(root, 'a', 'inner')).toEqual(root)
    expect(swapPanelNodes(root, 'a', 'nope')).toEqual(root)
  })

  it('does not mutate the tree it was given', () => {
    const root = tree()
    const before = structuredClone(root)
    swapPanelNodes(root, 'a', 'b')
    expect(root).toEqual(before)
  })
})

describe('resizing a panel from the keyboard', () => {
  /* Rounded: a share is renormalised after every nudge, so the arithmetic is
     exact to about a thousandth and no further. */
  const sizesOf = (root: LayoutNode, splitId: string): number[] =>
    asSplit(findNode(root, splitId)).sizes.map((size) => Math.round(size * 1000) / 1000)

  it('moves the boundary after the panel, which is the handle beside it', () => {
    const next = resizePanelShare(tree(), 'a', 'row', 0.1)
    expect(sizesOf(next, 'root')).toEqual([0.6, 0.4])
  })

  it('moves the boundary before it when the panel is last', () => {
    // Otherwise "wider" would mean "wider, unless you are on the right".
    const next = resizePanelShare(tree(), 'b', 'column', 0.1)
    expect(sizesOf(next, 'inner')).toEqual([0.6, 0.4])
    const shrunk = resizePanelShare(tree(), 'c', 'column', 0.1)
    expect(sizesOf(shrunk, 'inner')).toEqual([0.4, 0.6])
  })

  it('resizes the innermost split running that way, not the outermost', () => {
    // `b` is inside a column inside a row: growing it downwards has to move the
    // boundary it can see, and leave the one further out alone.
    const next = resizePanelShare(tree(), 'b', 'column', 0.1)
    expect(sizesOf(next, 'root')).toEqual([0.5, 0.5])
  })

  it('climbs past a split running the other way', () => {
    // `b` has no vertical boundary of its own; the one that makes it wider is
    // the root's.
    const next = resizePanelShare(tree(), 'b', 'row', 0.1)
    expect(sizesOf(next, 'root')).toEqual([0.4, 0.6])
  })

  it('stops at the floor rather than squeezing a pane to nothing', () => {
    const root = split('root', 'row', [panel('a'), panel('b')])
    root.sizes = [0.9, 0.1]
    // A twentieth of the split is as thin as a pane gets; the rest of the ask is
    // dropped rather than the pane being closed by keyboard.
    expect(sizesOf(resizePanelShare(root, 'a', 'row', 0.2), 'root')).toEqual([0.95, 0.05])
  })

  it('returns the same tree when there is no room left, so nothing is dirtied', () => {
    const root = split('root', 'row', [panel('a'), panel('b')])
    root.sizes = [0.95, 0.05]
    expect(resizePanelShare(root, 'a', 'row', 0.2)).toBe(root)
  })

  it('returns the same tree when nothing shares the panel’s axis', () => {
    // A lone panel, and a panel whose only split runs the other way.
    expect(resizePanelShare(panel('only'), 'only', 'row', 0.1)).toEqual(panel('only'))
    const root = split('root', 'row', [panel('a'), panel('b')])
    expect(resizePanelShare(root, 'a', 'column', 0.1)).toBe(root)
  })

  it('does not mutate the tree it was given', () => {
    const root = tree()
    const before = structuredClone(root)
    resizePanelShare(root, 'a', 'row', 0.1)
    expect(root).toEqual(before)
  })
})

describe('pruning orphaned panel data', () => {
  const docWith = (windows: LayoutDoc['windows']): LayoutDoc => ({
    formatVersion: 2,
    name: 'Test',
    windows,
    panels: {
      p_a: { moduleId: 'notes', settings: {}, state: {} },
      p_b: { moduleId: 'dice', settings: {}, state: {} },
      p_c: { moduleId: 'timers', settings: {}, state: {} },
      p_gone: { moduleId: 'notes', settings: {}, state: {} }
    },
    locked: false,
    createdAt: '',
    updatedAt: ''
  })

  it('drops payloads no tree points at', () => {
    const doc = docWith([{ id: 'w1', name: 'Main window', root: tree(), open: true }])
    expect(Object.keys(pruneOrphanPanels(doc).panels).sort()).toEqual(['p_a', 'p_b', 'p_c'])
  })

  it('keeps payloads a second window points at', () => {
    const doc = docWith([
      { id: 'w1', name: 'Main window', root: tree(), open: true },
      {
        id: 'w2',
        name: 'Window 2',
        root: { type: 'panel', id: 'n_g', panelId: 'p_gone' },
        open: true
      }
    ])
    expect(Object.keys(pruneOrphanPanels(doc).panels).sort()).toEqual([
      'p_a',
      'p_b',
      'p_c',
      'p_gone'
    ])
  })

  // A closed window keeps its panels — that is the whole of what "closed rather
  // than removed" buys. Pruning to the open windows would empty it the moment
  // anything else in the document changed.
  it('keeps payloads a closed window points at', () => {
    const doc = docWith([
      { id: 'w1', name: 'Main window', root: tree(), open: true },
      {
        id: 'w2',
        name: 'Window 2',
        root: { type: 'panel', id: 'n_g', panelId: 'p_gone' },
        open: false
      }
    ])
    expect(Object.keys(pruneOrphanPanels(doc).panels)).toContain('p_gone')
  })
})

describe('ids and fresh documents', () => {
  it('mints a distinct id each call, carrying the prefix it was given', () => {
    // Two calls in the same millisecond still differ — the counter is what makes
    // that true, not the timestamp.
    const [first, second] = [uid('node'), uid('node')]
    expect(first).not.toBe(second)
    expect(first.startsWith('node_')).toBe(true)
  })

  it('starts a document on one open window over one empty panel', () => {
    const doc = createEmptyDoc('Session one')
    expect(doc.windows).toHaveLength(1)
    expect(doc.windows[0]).toMatchObject({ open: true })
    const [node] = collectPanelNodes(doc.windows[0].root)
    expect(doc.name).toBe('Session one')
    expect(doc.locked).toBe(false)
    expect(doc.panels[node.panelId]).toMatchObject({ moduleId: 'empty' })
  })

  it('gives every panel node a fresh id over the panel it was handed', () => {
    const node = makePanelNode('p_x')
    expect(node).toMatchObject({ type: 'panel', panelId: 'p_x' })
    expect(node.id).not.toBe(makePanelNode('p_x').id)
  })
})

describe('parsing a layout file', () => {
  const valid = (): Record<string, unknown> => ({
    formatVersion: 1,
    name: 'Saved',
    root: {
      type: 'split',
      id: 'root',
      direction: 'row',
      children: [
        { type: 'panel', id: 'a', panelId: 'p_a' },
        { type: 'panel', id: 'b', panelId: 'p_b' }
      ],
      sizes: [0.5, 0.5]
    },
    panels: {
      p_a: { moduleId: 'notes', title: 'Scratch', settings: { wrap: true }, state: { text: 'hi' } },
      p_b: { moduleId: 'dice' }
    },
    locked: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  })

  it('accepts a well-formed document and keeps what it carried', () => {
    const doc = parseLayoutDoc(valid())
    expect(doc).toMatchObject({
      name: 'Saved',
      locked: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    expect(doc?.panels.p_a).toEqual({
      moduleId: 'notes',
      title: 'Scratch',
      settings: { wrap: true },
      state: { text: 'hi' }
    })
  })

  it('is permissive about panel contents, which are module-defined', () => {
    // Settings and state are whatever a module wrote; each merges its own
    // defaults over them at render time, so a wrong shape is not the file's
    // problem. Only a missing moduleId costs the panel its identity.
    const raw = valid()
    raw.panels = { p_a: { moduleId: 'notes', settings: 7, state: 'nope', title: 12 }, p_b: {} }
    const doc = parseLayoutDoc(raw)
    expect(doc?.panels.p_a).toEqual({
      moduleId: 'notes',
      title: undefined,
      settings: {},
      state: {}
    })
    // Referenced by the tree but unusable: an empty panel, not a rejected file.
    expect(doc?.panels.p_b).toMatchObject({ moduleId: 'empty' })
  })

  it('keeps only the panels the tree references', () => {
    const raw = valid()
    ;(raw.panels as Record<string, unknown>).p_stale = { moduleId: 'notes' }
    expect(Object.keys(parseLayoutDoc(raw)?.panels ?? {}).sort()).toEqual(['p_a', 'p_b'])
  })

  it('fills in the fields a hand-written file may leave out', () => {
    const raw = valid()
    delete raw.formatVersion
    delete raw.locked
    delete raw.createdAt
    const doc = parseLayoutDoc(raw)
    // Stamped with what this build writes rather than what was read: `valid()`
    // is a version 1 file and has been migrated by the time it gets here, so
    // carrying its old number through would put it back on the next save.
    expect(doc).toMatchObject({ formatVersion: 2, locked: false })
    expect(typeof doc?.createdAt).toBe('string')
  })

  it('rejects anything that is not a document at all', () => {
    for (const value of [null, undefined, 42, 'a layout', [], {}]) {
      expect(parseLayoutDoc(value)).toBeNull()
    }
  })

  it('rejects a document whose tree would not render', () => {
    // Strict where the renderer would crash, which is the whole point of the
    // check: `panels` can degrade to defaults, a broken tree cannot.
    const broken: Record<string, unknown>[] = [
      { ...valid(), root: { type: 'panel', id: 'a' } }, // no panelId
      { ...valid(), root: { type: 'frame', id: 'a' } }, // unknown node type
      { ...valid(), root: { type: 'panel', panelId: 'p_a' } }, // no id
      {
        ...valid(),
        root: { type: 'split', id: 'r', direction: 'diagonal', children: [], sizes: [] }
      },
      {
        ...valid(),
        root: { type: 'split', id: 'r', direction: 'row', children: [], sizes: [] }
      },
      {
        // One size for two children — the renderer would read undefined as flex.
        ...valid(),
        root: {
          type: 'split',
          id: 'r',
          direction: 'row',
          children: [
            { type: 'panel', id: 'a', panelId: 'p_a' },
            { type: 'panel', id: 'b', panelId: 'p_b' }
          ],
          sizes: [1]
        }
      },
      {
        ...valid(),
        root: {
          type: 'split',
          id: 'r',
          direction: 'row',
          children: [
            { type: 'panel', id: 'a', panelId: 'p_a' },
            { type: 'panel', id: 'b', panelId: 'p_b' }
          ],
          sizes: [1, Number.NaN]
        }
      }
    ]
    for (const raw of broken) expect(parseLayoutDoc(raw)).toBeNull()
  })

  it('rejects a document with no name or no panels map', () => {
    const missingName = valid()
    delete missingName.name
    const missingPanels = valid()
    delete missingPanels.panels
    expect(parseLayoutDoc(missingName)).toBeNull()
    expect(parseLayoutDoc(missingPanels)).toBeNull()
  })

  it('validates a nested tree all the way down', () => {
    // The outer split is impeccable; the bad panel is two levels in. A check
    // that only looked at the root would pass this and crash on render.
    const raw = valid()
    raw.root = {
      type: 'split',
      id: 'root',
      direction: 'row',
      children: [
        { type: 'panel', id: 'a', panelId: 'p_a' },
        {
          type: 'split',
          id: 'inner',
          direction: 'column',
          children: [{ type: 'panel', id: 'b' }],
          sizes: [1]
        }
      ],
      sizes: [0.5, 0.5]
    }
    expect(parseLayoutDoc(raw)).toBeNull()
  })
})

describe('windows', () => {
  const twoWindows = (): LayoutDoc => addWindow(createEmptyDoc('Two screens'))

  it('adds a window holding one empty panel of its own', () => {
    const doc = twoWindows()
    expect(doc.windows).toHaveLength(2)
    const [node] = collectPanelNodes(doc.windows[1].root)
    expect(doc.panels[node.panelId]).toMatchObject({ moduleId: 'empty' })
    // The first window keeps its own panel — a second screen is an addition,
    // not a redistribution.
    expect(Object.keys(doc.panels)).toHaveLength(2)
  })

  it('names each new window past the ones already taken', () => {
    const doc = twoWindows()
    expect(doc.windows[1].name).toBe('Window 2')
    expect(defaultWindowName(doc)).toBe('Window 3')
  })

  // Counting off the length would reuse a name here: three windows, one of them
  // already called "Window 3".
  it('skips a name a renamed window has taken', () => {
    const doc = renameWindow(addWindow(twoWindows()), 'win_main', 'Window 4')
    expect(defaultWindowName(doc)).toBe('Window 5')
  })

  it('finds which window shows a panel, and which names a node', () => {
    const doc = twoWindows()
    const [first] = collectPanelNodes(doc.windows[0].root)
    const [second] = collectPanelNodes(doc.windows[1].root)
    expect(windowOfPanel(doc, first.panelId)).toBe(doc.windows[0].id)
    expect(windowOfPanel(doc, second.panelId)).toBe(doc.windows[1].id)
    expect(windowOfNode(doc, second.id)).toBe(doc.windows[1].id)
    expect(windowOfPanel(doc, 'p_nowhere')).toBeNull()
  })

  it('replaces one window tree and leaves the other alone', () => {
    const doc = twoWindows()
    const before = doc.windows[0].root
    const next = setWindowRoot(doc, doc.windows[1].id, makePanelNode('p_new'))
    expect(next.windows[0].root).toBe(before)
    expect(next.windows[1].root).toMatchObject({ panelId: 'p_new' })
  })

  it('closes a window without losing it or its panels', () => {
    const doc = twoWindows()
    const second = doc.windows[1]
    const [panel] = collectPanelNodes(second.root)
    const closed = setWindowOpen(doc, second.id, false)
    expect(closed.windows).toHaveLength(2)
    expect(closed.windows[1].open).toBe(false)
    expect(pruneOrphanPanels(closed).panels[panel.panelId]).toBeDefined()
    expect(setWindowOpen(closed, second.id, true).windows[1].open).toBe(true)
  })

  /*
   * The primary is what closing the app goes through, and every layout has to
   * have one. Refusing both here rather than in the UI is the same argument the
   * lock already makes: a guard written into a component is one every later
   * route in has to remember.
   */
  it('refuses to close or remove the primary window', () => {
    const doc = twoWindows()
    expect(setWindowOpen(doc, doc.windows[0].id, false)).toBe(doc)
    expect(removeWindow(doc, doc.windows[0].id)).toBe(doc)
    expect(isPrimaryWindow(doc, doc.windows[0].id)).toBe(true)
    expect(isPrimaryWindow(doc, doc.windows[1].id)).toBe(false)
  })

  it('removes a secondary window and prunes the panels that went with it', () => {
    const doc = twoWindows()
    const [gone] = collectPanelNodes(doc.windows[1].root)
    const next = removeWindow(doc, doc.windows[1].id)
    expect(next.windows).toHaveLength(1)
    expect(next.panels[gone.panelId]).toBeUndefined()
  })

  it('leaves a document alone when asked about a window it does not have', () => {
    const doc = twoWindows()
    expect(removeWindow(doc, 'win_nope')).toBe(doc)
    expect(findWindow(doc, 'win_nope')).toBeUndefined()
  })
})

describe('reading a version 1 layout', () => {
  const v1 = (): Record<string, unknown> => ({
    formatVersion: 1,
    name: 'Old screen',
    root: {
      type: 'split',
      id: 'split_root',
      direction: 'row',
      children: [
        { type: 'panel', id: 'n_a', panelId: 'p_a' },
        { type: 'panel', id: 'n_b', panelId: 'p_b' }
      ],
      sizes: [0.5, 0.5]
    },
    panels: { p_a: { moduleId: 'notes' }, p_b: { moduleId: 'dice' } },
    locked: false
  })

  it('wraps the single root in one open primary window', () => {
    const doc = parseLayoutDoc(v1())
    expect(doc?.windows).toHaveLength(1)
    expect(doc?.windows[0]).toMatchObject({ name: 'Main window', open: true })
    expect(collectPanelNodes(doc!.windows[0].root)).toHaveLength(2)
  })

  // Fixed rather than minted, so opening the same old file twice names the same
  // window both times — which is what lets the geometry remembered against that
  // id in session.json still find it.
  it('gives that window the same id every time', () => {
    expect(parseLayoutDoc(v1())?.windows[0].id).toBe(parseLayoutDoc(v1())?.windows[0].id)
  })

  it('reads a version 2 file as the windows it declares', () => {
    const raw = {
      ...v1(),
      formatVersion: 2,
      root: undefined,
      windows: [
        { id: 'w1', name: 'Main window', root: { type: 'panel', id: 'n_a', panelId: 'p_a' } },
        {
          id: 'w2',
          name: 'Player screen',
          root: { type: 'panel', id: 'n_b', panelId: 'p_b' },
          open: false
        }
      ]
    }
    delete (raw as Record<string, unknown>).root
    const doc = parseLayoutDoc(raw)
    expect(doc?.windows.map((window) => window.name)).toEqual(['Main window', 'Player screen'])
    // Absent means open; only an explicit false closes one.
    expect(doc?.windows.map((window) => window.open)).toEqual([true, false])
  })

  // A layout whose only window is closed has nothing to show, so the file is
  // read as if it were open rather than rejected.
  it('forces the primary window open whatever the file says', () => {
    const raw = {
      ...v1(),
      root: undefined,
      windows: [
        {
          id: 'w1',
          name: 'Main window',
          root: { type: 'panel', id: 'n_a', panelId: 'p_a' },
          open: false
        }
      ]
    }
    delete (raw as Record<string, unknown>).root
    expect(parseLayoutDoc(raw)?.windows[0].open).toBe(true)
  })

  it('rejects a windows list that is empty or malformed', () => {
    const broken: unknown[] = [
      { ...v1(), root: undefined, windows: [] },
      {
        ...v1(),
        root: undefined,
        windows: [{ name: 'No id', root: { type: 'panel', id: 'n', panelId: 'p' } }]
      },
      {
        ...v1(),
        root: undefined,
        windows: [{ id: 'w', name: 'Bad tree', root: { type: 'panel' } }]
      }
    ]
    for (const raw of broken) {
      delete (raw as Record<string, unknown>).root
      expect(parseLayoutDoc(raw)).toBeNull()
    }
  })
})

describe('merging one window copy of the document', () => {
  /** Two windows, one panel each, so ownership is unambiguous. */
  const shared = (): LayoutDoc => addWindow(createEmptyDoc('Shared'))

  const panelOf = (doc: LayoutDoc, index: number): string =>
    collectPanelNodes(doc.windows[index].root)[0].panelId

  const edit = (doc: LayoutDoc, panelId: string, text: string): LayoutDoc => ({
    ...doc,
    panels: { ...doc.panels, [panelId]: { ...doc.panels[panelId], state: { text } } }
  })

  it('takes the sender window tree and leaves the other alone', () => {
    const base = shared()
    const sender = base.windows[1].id
    const incoming = setWindowRoot(base, sender, makePanelNode(panelOf(base, 1)))
    const merged = mergeWindowSlice(base, incoming, sender)
    expect(merged.windows[0].root).toBe(base.windows[0].root)
    expect(merged.windows[1].root).toBe(incoming.windows[1].root)
  })

  /*
   * The case this exists for. Both windows edit, and the second message to
   * arrive must not undo the first — adopting an incoming copy wholesale is
   * exactly how it would.
   */
  it('does not let a stale copy undo another window edit', () => {
    const base = shared()
    const [first, second] = [base.windows[0].id, base.windows[1].id]
    const firstPanel = panelOf(base, 0)
    const secondPanel = panelOf(base, 1)

    // Window one types, and main folds that in.
    const afterFirst = mergeWindowSlice(base, edit(base, firstPanel, 'from one'), first)
    // Window two was still holding the pre-edit document when it typed.
    const stale = edit(base, secondPanel, 'from two')
    const afterSecond = mergeWindowSlice(afterFirst, stale, second)

    expect(afterSecond.panels[firstPanel].state).toEqual({ text: 'from one' })
    expect(afterSecond.panels[secondPanel].state).toEqual({ text: 'from two' })
  })

  it('ignores an edit aimed at a panel the sender does not own', () => {
    const base = shared()
    const other = panelOf(base, 0)
    const forged = edit(base, other, 'not yours')
    const merged = mergeWindowSlice(base, forged, base.windows[1].id)
    expect(merged.panels[other]).toBe(base.panels[other])
  })

  it('drops a panel the sender has stopped showing', () => {
    const base = addWindow(shared())
    const sender = base.windows[1].id
    const gone = panelOf(base, 1)
    const incoming = setWindowRoot(base, sender, makePanelNode('p_fresh'))
    const merged = mergeWindowSlice(
      base,
      { ...incoming, panels: { ...incoming.panels, p_fresh: makePanelData('notes') } },
      sender
    )
    expect(merged.panels[gone]).toBeUndefined()
    expect(merged.panels.p_fresh).toMatchObject({ moduleId: 'notes' })
  })

  /*
   * Adding, closing and renaming a window are commands that go through main and
   * come back to every window, so a renderer never speaks for them. A message
   * carrying a stale name would otherwise undo a rename made a moment earlier
   * in another window.
   */
  it('keeps the window name and open flag the base has', () => {
    const base = shared()
    const sender = base.windows[1].id
    const named = renameWindow(setWindowOpen(base, sender, false), sender, 'Renamed by main')
    const incoming = { ...base }
    const merged = mergeWindowSlice(named, incoming, sender)
    expect(merged.windows[1].name).toBe('Renamed by main')
    expect(merged.windows[1].open).toBe(false)
  })

  it('leaves the base alone when the window is not in both copies', () => {
    const base = shared()
    expect(mergeWindowSlice(base, base, 'win_nope')).toBe(base)
    expect(mergeWindowSlice(base, removeWindow(base, base.windows[1].id), base.windows[1].id)).toBe(
      base
    )
  })
})

describe('swapping panels across windows', () => {
  const twoScreens = (): LayoutDoc => addWindow(createEmptyDoc('Two screens'))

  const nodeOf = (doc: LayoutDoc, index: number): string =>
    collectPanelNodes(doc.windows[index].root)[0].id

  const panelOf = (doc: LayoutDoc, index: number): string =>
    collectPanelNodes(doc.windows[index].root)[0].panelId

  /** Two screens, the first of them split in two, so a swap has a shape to keep. */
  const splitFirstWindow = (): LayoutDoc => {
    const doc = twoScreens()
    const root = doc.windows[0].root
    return setWindowRoot(doc, 'win_main', splitNode(root, root.id, 'row', makePanelNode('p_extra')))
  }

  it('trades what two panes point at, one on each screen', () => {
    const doc = twoScreens()
    const [aNode, bNode] = [nodeOf(doc, 0), nodeOf(doc, 1)]
    const [aPanel, bPanel] = [panelOf(doc, 0), panelOf(doc, 1)]

    const next = swapPanelsInDoc(doc, aNode, bNode)
    expect(panelOf(next, 0)).toBe(bPanel)
    expect(panelOf(next, 1)).toBe(aPanel)
  })

  /*
   * A node id names a place, and a place belongs to its window. Dragging a map
   * to the television must not carry the laptop pane's shape across with it.
   */
  it('leaves both trees the shape they were', () => {
    const doc = splitFirstWindow()
    const before = structuredClone(doc.windows[0].root)
    const next = swapPanelsInDoc(doc, nodeOf(doc, 0), nodeOf(doc, 1))
    const shape = (node: LayoutNode): unknown =>
      node.type === 'panel'
        ? { type: 'panel', id: node.id }
        : { type: 'split', id: node.id, sizes: node.sizes, children: node.children.map(shape) }
    expect(shape(next.windows[0].root)).toEqual(shape(before))
  })

  it('falls back to the single-tree swap inside one window', () => {
    const doc = splitFirstWindow()
    const [first, second] = collectPanelNodes(doc.windows[0].root)
    const next = swapPanelsInDoc(doc, first.id, second.id)
    const after = collectPanelNodes(next.windows[0].root)
    expect(after[0].panelId).toBe(second.panelId)
    expect(after[1].panelId).toBe(first.panelId)
    // The other screen is untouched, by identity rather than by value.
    expect(next.windows[1]).toBe(doc.windows[1])
  })

  it('leaves the document alone for a node it cannot place', () => {
    const doc = twoScreens()
    expect(swapPanelsInDoc(doc, nodeOf(doc, 0), 'node_nowhere')).toBe(doc)
    expect(swapPanelsInDoc(doc, nodeOf(doc, 0), nodeOf(doc, 0))).toBe(doc)
  })

  it('does not mutate the document it was given', () => {
    const doc = twoScreens()
    const before = structuredClone(doc)
    swapPanelsInDoc(doc, nodeOf(doc, 0), nodeOf(doc, 1))
    expect(doc).toEqual(before)
  })
})

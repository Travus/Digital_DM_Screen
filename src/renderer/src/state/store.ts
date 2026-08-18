import { create } from 'zustand'
import type {
  DocumentSnapshot,
  DocumentStatus,
  LayoutDoc,
  LayoutNode,
  MoveDirection,
  RecentEntry,
  WindowDef,
  SplitDirection
} from '../../../shared/types'
import {
  collectPanelNodes,
  equaliseSplit,
  findNode,
  findWindow,
  makePanelData,
  makePanelNode,
  neighbourPanels,
  pruneOrphanPanels,
  removeNode,
  resizePanelShare,
  setSplitSizes,
  setWindowRoot,
  splitNode,
  swapPanelNodes,
  toggleSplitDirection,
  uid,
  windowOfPanel,
  EMPTY_MODULE_ID
} from '../../../shared/layout'

export type Theme = 'dark' | 'light'

interface AppState {
  doc: LayoutDoc
  /**
   * Which of the document's windows this renderer is showing.
   *
   * Every window runs the same page over the same document, so this is what
   * decides which tree it draws and which panels it may write to directly.
   */
  windowId: string
  /** The window carrying the file buttons, and the one whose close quits. */
  isPrimary: boolean
  filePath: string | null
  dirty: boolean
  recents: RecentEntry[]
  /** Node id of the panel rendered fullscreen, or null for the normal tiling view. */
  maximizedNodeId: string | null
  /** Last panel the user interacted with — the target for menu/keyboard commands. */
  activeNodeId: string | null
  /**
   * Panels currently showing their rename field or their module picker.
   *
   * UI state, not document state — it lives here rather than in `PanelFrame`
   * only because a keyboard command has to be able to open them, and a shortcut
   * has no way into another component's `useState`. Set directly, never through
   * `mutate()`, exactly like `maximizedNodeId` above: renaming a panel is not a
   * change to the layout until the name is actually committed.
   */
  renamingNodeId: string | null
  pickingNodeId: string | null
  theme: Theme
  sidebarOpen: boolean

  /* layout file operations — all of them main's, since main holds the document */
  newLayout: () => Promise<void>
  openLayout: (path?: string) => Promise<void>
  save: () => Promise<boolean>
  saveAs: () => Promise<boolean>
  renameLayout: (name: string) => void
  toggleLock: () => void
  /** A different document arriving from main: New or Open. */
  adoptDocument: (snapshot: DocumentSnapshot) => void
  /**
   * The same document, moved by another window or by a change to the window
   * list. Keeps this window's view state, which a replacement resets.
   */
  adoptPeerDocument: (snapshot: DocumentSnapshot) => void
  /** Just the file path and the unsaved flag, which a save moves on their own. */
  adoptStatus: (status: DocumentStatus) => void

  /* recents */
  refreshRecents: () => Promise<void>
  removeRecent: (path: string) => Promise<void>
  clearRecents: () => Promise<void>

  /* tree operations */
  splitPanel: (nodeId: string, direction: SplitDirection) => void
  closePanel: (nodeId: string) => void
  setSizes: (splitId: string, sizes: number[]) => void
  flipSplit: (splitId: string) => void
  equalise: (splitId: string) => void
  swapWithNode: (nodeId: string, targetNodeId: string) => void
  /** The same trade, where the two panels are on different screens. */
  swapAcrossWindows: (sourceNodeId: string, targetNodeId: string) => Promise<void>
  swapWithNeighbour: (nodeId: string, direction: MoveDirection) => void
  resizePanel: (nodeId: string, axis: SplitDirection, delta: number) => void

  /* panel contents */
  setPanelModule: (panelId: string, moduleId: string) => void
  setPanelTitle: (panelId: string, title: string | undefined) => void
  updatePanelState: (panelId: string, patch: Record<string, unknown>) => void
  updatePanelSettings: (panelId: string, patch: Record<string, unknown>) => void

  /* windows */
  addWindow: () => Promise<void>
  openWindow: (windowId: string) => Promise<void>
  closeWindow: (windowId: string) => Promise<void>
  renameWindow: (windowId: string, name: string) => Promise<void>
  removeWindow: (windowId: string) => Promise<void>
  focusWindow: (windowId: string) => Promise<void>

  /* view */
  maximize: (nodeId: string | null) => void
  toggleMaximize: (nodeId: string) => void
  setActive: (nodeId: string) => void
  setRenamingNode: (nodeId: string | null) => void
  setPickingNode: (nodeId: string | null) => void
  setTheme: (theme: Theme) => void
  /** The same, from another window — applied without being sent back. */
  adoptTheme: (theme: Theme) => void
  toggleSidebar: () => void
}

const THEME_KEY = 'dmscreen.theme'

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export const useAppStore = create<AppState>((set, get) => {
  /**
   * Every doc mutation funnels through here, so `dirty` can never drift and main
   * always has the edit.
   *
   * `dirty` is still set locally rather than waited for. Main sets it too, and
   * says so back over `document:status` — but the dot beside the layout name is
   * the app acknowledging a keystroke, and an acknowledgement that arrives an
   * IPC round trip later is one the eye catches. A local `true` and main's
   * authoritative `false` cannot fight: only a save clears it.
   */
  const mutate = (fn: (doc: LayoutDoc) => LayoutDoc): void => {
    const doc = { ...fn(get().doc), updatedAt: new Date().toISOString() }
    set({ doc, dirty: true })
    void window.dmscreen.publishDocument(doc)
  }

  /**
   * A change to this window's own tiling. Every other window's tree is left
   * exactly as it was, which is the line main's merge reads on the other side.
   */
  const mutateTree = (fn: (root: LayoutNode) => LayoutNode): void => {
    mutate((doc) => {
      const window = findWindow(doc, get().windowId)
      if (!window) return doc
      return pruneOrphanPanels(setWindowRoot(doc, window.id, fn(window.root)))
    })
  }

  /**
   * Send a write on to the window that owns the panel, and report that it has
   * been dealt with. False means the panel is this window's to write.
   */
  const routeIfForeign = (
    panelId: string,
    patch: Record<string, unknown>,
    kind: 'state' | 'settings'
  ): boolean => {
    const { doc, windowId } = get()
    const owner = windowOfPanel(doc, panelId)
    if (!owner || owner === windowId) return false
    void window.dmscreen.patchPanel(owner, panelId, patch, kind)
    return true
  }

  /**
   * What main handed over at preload. Read here rather than in an effect: an
   * async restore means a first frame with an empty layout in it and the real
   * one arriving over the top, which is a flash the smoke harness had to be
   * taught to wait out.
   */
  const initial = window.dmscreen.initialDocument
  const identity = window.dmscreen.identity

  return {
    doc: initial.doc,
    // Falls back to the primary's id: a window main does not recognise is one
    // that should not exist, and drawing the main screen beats drawing nothing.
    windowId: identity.windowId ?? initial.doc.windows[0].id,
    isPrimary: identity.isPrimary,
    filePath: initial.filePath,
    dirty: initial.dirty,
    recents: [],
    maximizedNodeId: null,
    activeNodeId: null,
    renamingNodeId: null,
    pickingNodeId: null,
    theme: readTheme(),
    sidebarOpen: false,

    /* ------------------------------------------------------------ files */

    /*
     * Four thin calls into main, which owns the document and therefore owns the
     * unsaved-changes prompt, the file dialogs and the recents. What comes back
     * is a `document:changed` or a `document:status`, adopted below — so the
     * menu, the top bar and the palette all land on one code path, and none of
     * them can leave the renderer holding a document main has moved past.
     */
    newLayout: () => window.dmscreen.newLayout(),

    openLayout: async (path) => {
      await window.dmscreen.openLayout(path)
      await get().refreshRecents()
    },

    save: async () => {
      const saved = await window.dmscreen.saveLayout()
      if (saved) await get().refreshRecents()
      return saved
    },

    saveAs: async () => {
      const saved = await window.dmscreen.saveLayoutAs()
      if (saved) await get().refreshRecents()
      return saved
    },

    // The lock covers the names as well as the shape, and is enforced here for
    // the same reason the tree operations below are: a guard living in the UI is
    // one every new route in has to remember.
    /*
     * The layout's name and its lock are the document's, not this window's, so
     * they are set through main and come back to every window. Applied locally
     * first all the same: the control that was just clicked has to respond now,
     * and main confirming a moment later cannot disagree with it.
     */
    renameLayout: (name) => {
      if (get().doc.locked) return
      set((state) => ({ doc: { ...state.doc, name }, dirty: true }))
      void window.dmscreen.setDocumentMeta({ name })
    },

    toggleLock: () => {
      const locked = !get().doc.locked
      set((state) => ({ doc: { ...state.doc, locked }, dirty: true }))
      void window.dmscreen.setDocumentMeta({ locked })
    },

    /* Set, never mutated: adopting main's document is not an edit to it, and
       publishing it back would echo. The same argument as `maximizedNodeId`
       being outside `mutate` — this is the app catching up, not a change. */
    adoptDocument: ({ doc, filePath, dirty }) =>
      set({ doc, filePath, dirty, maximizedNodeId: null, activeNodeId: null }),

    /*
     * The view state is deliberately left alone here. A peer's edit arrives on
     * every keystroke in the other window, and resetting on each one would drop
     * this window out of fullscreen while someone typed next door.
     */
    adoptPeerDocument: ({ doc, filePath, dirty }) => set({ doc, filePath, dirty }),

    adoptStatus: ({ filePath, dirty }) => set({ filePath, dirty }),

    /* ---------------------------------------------------------- recents */

    refreshRecents: async () => set({ recents: await window.dmscreen.listRecents() }),
    removeRecent: async (path) => set({ recents: await window.dmscreen.removeRecent(path) }),
    clearRecents: async () => set({ recents: await window.dmscreen.clearRecents() }),

    /* ------------------------------------------------------------- tree */

    splitPanel: (nodeId, direction) => {
      if (get().doc.locked) return
      const panelId = uid('panel')
      const newNode = makePanelNode(panelId)
      mutate((doc) => {
        const window = findWindow(doc, get().windowId)
        if (!window) return doc
        return {
          ...setWindowRoot(doc, window.id, splitNode(window.root, nodeId, direction, newNode)),
          panels: { ...doc.panels, [panelId]: makePanelData() }
        }
      })
      // A fresh panel should be the one that reacts to the next command.
      set({ activeNodeId: newNode.id, maximizedNodeId: null })
    },

    closePanel: (nodeId) => {
      const { doc, maximizedNodeId, activeNodeId, windowId } = get()
      if (doc.locked) return
      const root = findWindow(doc, windowId)?.root
      if (!root) return
      const next = removeNode(root, nodeId)
      if (!next) {
        // Closing the last panel leaves an empty one rather than a blank screen.
        // Only this window's — a second screen emptying itself must not take the
        // panels on the first one with it.
        const panelId = uid('panel')
        mutate((d) => ({
          ...setWindowRoot(d, windowId, makePanelNode(panelId)),
          panels: { ...d.panels, [panelId]: makePanelData() }
        }))
      } else {
        mutateTree(() => next)
      }
      set({
        maximizedNodeId: maximizedNodeId === nodeId ? null : maximizedNodeId,
        activeNodeId: activeNodeId === nodeId ? null : activeNodeId
      })
    },

    // Every structural change funnels through these, so the lock is enforced
    // here rather than relying on the UI to hide the controls.
    setSizes: (splitId, sizes) => {
      if (get().doc.locked) return
      mutateTree((root) => setSplitSizes(root, splitId, sizes))
    },

    flipSplit: (splitId) => {
      if (get().doc.locked) return
      mutateTree((root) => toggleSplitDirection(root, splitId))
    },

    equalise: (splitId) => {
      if (get().doc.locked) return
      mutateTree((root) => equaliseSplit(root, splitId))
    },

    /**
     * Trade two panels' contents, and hand the selection to where the module
     * went.
     *
     * The selection following is what makes the command repeatable: swap right
     * twice and the module the DM is moving carries on across the screen, rather
     * than bouncing between the same two panes. The drop target of a drag gets
     * the same treatment, since the module lands there either way.
     */
    swapWithNode: (nodeId, targetNodeId) => {
      const { doc, maximizedNodeId, windowId } = get()
      // Fullscreen would hide the whole of it — see `ifFullscreen` in the
      // catalogue, which greys the same commands for the same reason.
      if (doc.locked || maximizedNodeId) return
      const root = findWindow(doc, windowId)?.root
      if (!root) return
      const next = swapPanelNodes(root, nodeId, targetNodeId)
      if (next === root) return
      mutateTree(() => next)
      set({ activeNodeId: targetNodeId })
    },

    /**
     * A panel dropped onto one in another window.
     *
     * Routed through main because neither window owns both trees — publishing a
     * document with the other window's tree changed would have exactly that half
     * discarded by the merge. The selection follows the module here as it does
     * within a window, and it lands on this side, since this is where the module
     * arrived.
     */
    swapAcrossWindows: async (sourceNodeId, targetNodeId) => {
      const { doc, maximizedNodeId } = get()
      if (doc.locked || maximizedNodeId) return
      const swapped = await window.dmscreen.swapPanelsAcrossWindows(sourceNodeId, targetNodeId)
      if (swapped) set({ activeNodeId: targetNodeId })
    },

    swapWithNeighbour: (nodeId, direction) => {
      const root = myRoot(get())
      if (!root) return
      const neighbour = neighbourPanels(root, nodeId)[direction]
      if (neighbour) get().swapWithNode(nodeId, neighbour)
    },

    /**
     * `delta` is a share of the split to grow by, negative to shrink. Skipped
     * outright when the tree comes back unchanged: a key held down at the floor
     * would otherwise go on marking the layout unsaved and restarting the
     * session autosave for nothing.
     */
    resizePanel: (nodeId, axis, delta) => {
      const { doc, maximizedNodeId, windowId } = get()
      if (doc.locked || maximizedNodeId) return
      const root = findWindow(doc, windowId)?.root
      if (!root) return
      const next = resizePanelShare(root, nodeId, axis, delta)
      if (next === root) return
      mutateTree(() => next)
    },

    /* ----------------------------------------------------------- panels */

    setPanelModule: (panelId, moduleId) =>
      mutate((doc) => ({
        ...doc,
        // Switching modules starts the new module clean; its state shape has
        // nothing in common with the old one.
        panels: { ...doc.panels, [panelId]: makePanelData(moduleId) }
      })),

    setPanelTitle: (panelId, title) => {
      if (get().doc.locked) return
      mutate((doc) => ({
        ...doc,
        panels: {
          ...doc.panels,
          [panelId]: { ...doc.panels[panelId], title: title?.trim() ? title : undefined }
        }
      }))
    },

    /*
     * A write to a panel, wherever it lives.
     *
     * A window may only speak for its own panels — that is the line main's merge
     * reads — so a write aimed at another window's panel is forwarded to the
     * window that owns it and applied there. The initiative tracker pushing HP
     * back to a party panel is the case: the two are often on different screens,
     * and applying it here would produce a change main discards without a word.
     */
    updatePanelState: (panelId, patch) => {
      if (routeIfForeign(panelId, patch, 'state')) return
      mutate((doc) => {
        const panel = doc.panels[panelId]
        if (!panel) return doc
        return {
          ...doc,
          panels: { ...doc.panels, [panelId]: { ...panel, state: { ...panel.state, ...patch } } }
        }
      })
    },

    updatePanelSettings: (panelId, patch) => {
      if (routeIfForeign(panelId, patch, 'settings')) return
      mutate((doc) => {
        const panel = doc.panels[panelId]
        if (!panel) return doc
        return {
          ...doc,
          panels: {
            ...doc.panels,
            [panelId]: { ...panel, settings: { ...panel.settings, ...patch } }
          }
        }
      })
    },

    /* --------------------------------------------------------- windows */

    /* All of them main's: the window list's shape is the one part of the
       document no single window speaks for. Each comes back as a peer update. */
    addWindow: () => window.dmscreen.addWindow(),
    openWindow: (windowId) => window.dmscreen.setWindowOpen(windowId, true),
    closeWindow: (windowId) => window.dmscreen.setWindowOpen(windowId, false),
    renameWindow: (windowId, name) => window.dmscreen.renameWindow(windowId, name),
    removeWindow: (windowId) => window.dmscreen.removeWindow(windowId),
    focusWindow: (windowId) => window.dmscreen.focusWindow(windowId),

    /* ------------------------------------------------------------- view */

    maximize: (nodeId) => set({ maximizedNodeId: nodeId }),

    toggleMaximize: (nodeId) =>
      set((state) => ({ maximizedNodeId: state.maximizedNodeId === nodeId ? null : nodeId })),

    setActive: (nodeId) => set({ activeNodeId: nodeId }),

    /**
     * Refused while locked — but only in the *opening* direction.
     *
     * `setPanelTitle` already refuses the commit, so guarding the open looks
     * redundant and is not: a field that accepts a name and then drops it on
     * blur is worse than one that never appeared, because the typing looked like
     * it worked. Closing has to keep working whatever the lock says, or locking
     * with a field already open would strand it there with no way to dismiss it.
     */
    setRenamingNode: (nodeId) => {
      if (nodeId !== null && get().doc.locked) return
      set({ renamingNodeId: nodeId })
    },
    setPickingNode: (nodeId) => set({ pickingNodeId: nodeId }),

    setTheme: (theme) => {
      get().adoptTheme(theme)
      // Every window follows. A secondary window has no theme control of its
      // own, so this is the only way the players' screen changes with the rest.
      void window.dmscreen.setTheme(theme)
    },

    adoptTheme: (theme) => {
      localStorage.setItem(THEME_KEY, theme)
      applyTheme(theme)
      set({ theme })
    },

    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen }))
  }
})

/**
 * Resolves the panel a command should act on: the last one touched, falling
 * back to the first panel so the menu always does something sensible.
 */
export function resolveTargetNodeId(): string | null {
  const state = useAppStore.getState()
  const root = myRoot(state)
  if (!root) return null
  if (state.maximizedNodeId) return state.maximizedNodeId
  if (state.activeNodeId && findNode(root, state.activeNodeId)) return state.activeNodeId
  return collectPanelNodes(root)[0]?.id ?? null
}

export { EMPTY_MODULE_ID }

/**
 * The window this renderer is showing, and its tiling.
 *
 * Everything that used to read `doc.root` reads one of these instead. As a
 * selector rather than a stored copy, so a window's tree cannot go stale against
 * the document it came from.
 */
export function myWindow(state: { doc: LayoutDoc; windowId: string }): WindowDef | undefined {
  return findWindow(state.doc, state.windowId)
}

export function myRoot(state: { doc: LayoutDoc; windowId: string }): LayoutNode | undefined {
  return myWindow(state)?.root
}

import { create } from 'zustand'
import type { LayoutDoc, LayoutNode, RecentEntry, SplitDirection } from '../../../shared/types'
import {
  collectPanelNodes,
  createEmptyDoc,
  equaliseSplit,
  findNode,
  makePanelData,
  makePanelNode,
  pruneOrphanPanels,
  removeNode,
  setSplitSizes,
  splitNode,
  toggleSplitDirection,
  uid,
  EMPTY_MODULE_ID
} from '../../../shared/layout'

export type Theme = 'dark' | 'light'

interface AppState {
  doc: LayoutDoc
  filePath: string | null
  dirty: boolean
  recents: RecentEntry[]
  /** Node id of the panel rendered fullscreen, or null for the normal tiling view. */
  maximizedNodeId: string | null
  /** Last panel the user interacted with — the target for menu/keyboard commands. */
  activeNodeId: string | null
  theme: Theme
  sidebarOpen: boolean

  /* layout file operations */
  newLayout: () => void
  openLayout: (path?: string) => Promise<void>
  save: () => Promise<boolean>
  saveAs: () => Promise<boolean>
  renameLayout: (name: string) => void
  toggleLock: () => void
  loadDoc: (doc: LayoutDoc, filePath: string | null, dirty: boolean) => void

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

  /* panel contents */
  setPanelModule: (panelId: string, moduleId: string) => void
  setPanelTitle: (panelId: string, title: string | undefined) => void
  updatePanelState: (panelId: string, patch: Record<string, unknown>) => void
  updatePanelSettings: (panelId: string, patch: Record<string, unknown>) => void

  /* view */
  maximize: (nodeId: string | null) => void
  toggleMaximize: (nodeId: string) => void
  setActive: (nodeId: string) => void
  setTheme: (theme: Theme) => void
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
  /** Every doc mutation funnels through here so `dirty` can never drift. */
  const mutate = (fn: (doc: LayoutDoc) => LayoutDoc): void => {
    set((state) => ({
      doc: { ...fn(state.doc), updatedAt: new Date().toISOString() },
      dirty: true
    }))
  }

  const mutateTree = (fn: (root: LayoutNode) => LayoutNode): void => {
    mutate((doc) => pruneOrphanPanels({ ...doc, root: fn(doc.root) }))
  }

  return {
    doc: createEmptyDoc(),
    filePath: null,
    dirty: false,
    recents: [],
    maximizedNodeId: null,
    activeNodeId: null,
    theme: readTheme(),
    sidebarOpen: false,

    /* ------------------------------------------------------------ files */

    newLayout: () => {
      set({
        doc: createEmptyDoc(),
        filePath: null,
        dirty: false,
        maximizedNodeId: null,
        activeNodeId: null
      })
    },

    openLayout: async (path) => {
      const result = await window.dmscreen.openLayout(path)
      if (!result) return
      set({
        doc: result.doc,
        filePath: result.filePath,
        dirty: false,
        maximizedNodeId: null,
        activeNodeId: null
      })
      await get().refreshRecents()
    },

    save: async () => {
      const { doc, filePath } = get()
      if (!filePath) return get().saveAs()
      const saved = await window.dmscreen.saveLayout(filePath, doc)
      if (!saved) return false
      set({ dirty: false })
      await get().refreshRecents()
      return true
    },

    saveAs: async () => {
      const saved = await window.dmscreen.saveLayoutAs(get().doc)
      if (!saved) return false
      set({ filePath: saved, dirty: false })
      await get().refreshRecents()
      return true
    },

    renameLayout: (name) => mutate((doc) => ({ ...doc, name })),

    toggleLock: () => mutate((doc) => ({ ...doc, locked: !doc.locked })),

    loadDoc: (doc, filePath, dirty) =>
      set({ doc, filePath, dirty, maximizedNodeId: null, activeNodeId: null }),

    /* ---------------------------------------------------------- recents */

    refreshRecents: async () => set({ recents: await window.dmscreen.listRecents() }),
    removeRecent: async (path) => set({ recents: await window.dmscreen.removeRecent(path) }),
    clearRecents: async () => set({ recents: await window.dmscreen.clearRecents() }),

    /* ------------------------------------------------------------- tree */

    splitPanel: (nodeId, direction) => {
      if (get().doc.locked) return
      const panelId = uid('panel')
      const newNode = makePanelNode(panelId)
      mutate((doc) => ({
        ...doc,
        root: splitNode(doc.root, nodeId, direction, newNode),
        panels: { ...doc.panels, [panelId]: makePanelData() }
      }))
      // A fresh panel should be the one that reacts to the next command.
      set({ activeNodeId: newNode.id, maximizedNodeId: null })
    },

    closePanel: (nodeId) => {
      const { doc, maximizedNodeId, activeNodeId } = get()
      if (doc.locked) return
      const next = removeNode(doc.root, nodeId)
      if (!next) {
        // Closing the last panel leaves an empty one rather than a blank screen.
        const panelId = uid('panel')
        mutate((d) => ({
          ...d,
          root: makePanelNode(panelId),
          panels: { [panelId]: makePanelData() }
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

    /* ----------------------------------------------------------- panels */

    setPanelModule: (panelId, moduleId) =>
      mutate((doc) => ({
        ...doc,
        // Switching modules starts the new module clean; its state shape has
        // nothing in common with the old one.
        panels: { ...doc.panels, [panelId]: makePanelData(moduleId) }
      })),

    setPanelTitle: (panelId, title) =>
      mutate((doc) => ({
        ...doc,
        panels: {
          ...doc.panels,
          [panelId]: { ...doc.panels[panelId], title: title?.trim() ? title : undefined }
        }
      })),

    updatePanelState: (panelId, patch) =>
      mutate((doc) => {
        const panel = doc.panels[panelId]
        if (!panel) return doc
        return {
          ...doc,
          panels: { ...doc.panels, [panelId]: { ...panel, state: { ...panel.state, ...patch } } }
        }
      }),

    updatePanelSettings: (panelId, patch) =>
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
      }),

    /* ------------------------------------------------------------- view */

    maximize: (nodeId) => set({ maximizedNodeId: nodeId }),

    toggleMaximize: (nodeId) =>
      set((state) => ({ maximizedNodeId: state.maximizedNodeId === nodeId ? null : nodeId })),

    setActive: (nodeId) => set({ activeNodeId: nodeId }),

    setTheme: (theme) => {
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
  const { doc, activeNodeId, maximizedNodeId } = useAppStore.getState()
  if (maximizedNodeId) return maximizedNodeId
  if (activeNodeId && findNode(doc.root, activeNodeId)) return activeNodeId
  return collectPanelNodes(doc.root)[0]?.id ?? null
}

export { EMPTY_MODULE_ID }

/**
 * The live keymap, kept out of `useAppStore` for the reason `dataStore` is:
 * everything there funnels through `mutate()`, which sets `dirty` and rides into
 * the autosaved session. Rebinding a key is app-level, not document-level, and
 * must never mark a layout unsaved.
 *
 * Seeded synchronously from the preload snapshot, because shortcut labels are
 * painted by the top bar and every panel header on the first frame.
 */

import { create } from 'zustand'
import type { ResolvedKeymap } from '../../../shared/actions'

interface KeymapState {
  keymap: ResolvedKeymap
  /** Replaces the map from one pushed by the main process after a rebinding. */
  apply: (keymap: ResolvedKeymap) => void
}

export const useKeymapStore = create<KeymapState>((set) => ({
  keymap: window.dmscreen.initialKeymap,
  apply: (keymap) => set({ keymap })
}))

/**
 * Reference data, kept deliberately out of `useAppStore`.
 *
 * Everything there funnels through `mutate()`, which stamps `updatedAt` and sets
 * `dirty` — and rides along into the autosaved session. Game data is app-level,
 * not document-level: loading a pack must never mark a layout unsaved.
 *
 * Seeded synchronously from the preload snapshot, the same way the theme is read
 * straight out of localStorage. There is no loading state on purpose: an async
 * gate would leave a window where no conditions exist, which is exactly the case
 * every reference card renders through.
 */

import { create } from 'zustand'
import type { DataPackRef, DataSnapshot, Dataset } from '../../../shared/types'
import { resolve, type GameData } from '../data/resolve'

interface DataState extends GameData {
  packs: DataPackRef[]
  enabled: Record<Dataset, boolean>
  /** Replaces everything from a fresh snapshot pushed by the main process. */
  apply: (snapshot: DataSnapshot) => void
}

function fromSnapshot(snapshot: DataSnapshot): Omit<DataState, 'apply'> {
  return {
    ...resolve(snapshot),
    packs: snapshot.refs,
    enabled: snapshot.enabled
  }
}

/**
 * Tail of the message a reference module shows when its dataset is empty. Names
 * the Data menu, because that is the only place the cause can be fixed — the
 * panel's own settings cannot bring content back.
 */
export const NO_DATA_HINT = 'Switch SRD Content back on in the Data menu, or import a data pack.'

export const useDataStore = create<DataState>((set) => ({
  ...fromSnapshot(window.dmscreen.initialData),
  apply: (snapshot) => set(fromSnapshot(snapshot))
}))

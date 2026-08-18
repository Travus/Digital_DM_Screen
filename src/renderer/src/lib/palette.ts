/**
 * What the action palette shows, worked out away from the component so the
 * decisions are a table of cases rather than something you have to open a window
 * to see.
 *
 * Two of them matter. The palette lists **every** command, bound or not —
 * reaching the ones with no key is the point of having it at all. And a command
 * that cannot run right now is listed **with the reason it cannot**, from the
 * `unavailable` predicates in the catalogue, rather than dropped: a row that
 * disappears takes its own explanation with it, so a locked layout looked like a
 * palette missing half its commands. The reason is why greying out is possible
 * at all — "Close panel" needs to say *which* guard is holding it.
 *
 * Those rows sort to the bottom, alphabetically, so what the user can actually
 * do stays at the top of the list and under the cursor Enter starts on.
 */

import { formatBinding } from '../../../shared/accelerator'
import {
  ACTIONS,
  type ActionCategory,
  type ActionContext,
  type ActionId,
  type ResolvedKeymap
} from '../../../shared/actions'
import { findParent, findWindow, isPrimaryWindow, neighbourSides } from '../../../shared/layout'
import type { LayoutDoc } from '../../../shared/types'
import { searchFilter } from './search'

export interface PaletteEntry {
  id: ActionId
  label: string
  category: ActionCategory
  /** Written for the platform already, or undefined when the action has no key. */
  binding?: string
  /**
   * Why running it now would do nothing, or undefined when it applies. A
   * lowercase fragment, as the catalogue defines it — the component prefixes it.
   */
  unavailable?: string
}

/**
 * The state the `unavailable` predicates ask about, read off the document rather
 * than off the store, so this stays a function of its inputs.
 *
 * `targetNodeId` is whatever `resolveTargetNodeId()` says — the panel a command
 * would act on, which is the same one the menu and the keyboard use.
 *
 * `windowId` is which screen is asking. Every question about the tiling is a
 * question about *this* window's tiling: the panel to the right of this one is
 * not something the other screen has an opinion on.
 */
export function actionContext(
  doc: LayoutDoc,
  windowId: string,
  targetNodeId: string | null,
  maximizedNodeId: string | null
): ActionContext {
  const root = findWindow(doc, windowId)?.root ?? null
  return {
    locked: doc.locked,
    hasPanel: targetNodeId !== null,
    maximized: maximizedNodeId !== null,
    isPrimary: isPrimaryWindow(doc, windowId),
    hasWindows: doc.windows.length > 1,
    // The split a Flip or Even Out acts on is the one *containing* the target,
    // which is also how `App`'s dispatcher and the ⋯ menu pick it.
    hasSplit: root !== null && targetNodeId !== null && findParent(root, targetNodeId) !== null,
    // Measured off the tiling, so the answer is the one the DM would give
    // looking at the screen. `neighbourSides` handles a null target itself.
    neighbours: root ? neighbourSides(root, targetNodeId) : NO_NEIGHBOURS
  }
}

const NO_NEIGHBOURS = { left: false, right: false, up: false, down: false }

/**
 * The rows to show, in catalogue order but with the unavailable ones sorted by
 * name after the rest, filtered by `query`.
 *
 * Matching follows the module picker: an exact substring pass over the label and
 * the category name, and only if that finds nothing does the typo-tolerant pass
 * run — over labels alone, since there are five category names and a fuzzy match
 * against one of them would drag in a whole category for a query that was aimed
 * at a single command.
 *
 * A greyed row is matched by the same query as any other. Filtering it out
 * instead would put "Close panel" back to vanishing on a locked layout, one
 * search box further in.
 */
export function paletteEntries(
  keymap: ResolvedKeymap,
  context: ActionContext,
  query: string,
  platform: string
): PaletteEntry[] {
  const all = ACTIONS
    // The palette does not offer the command that opens the palette. It is the
    // one row that could never do anything from in here — and unlike a locked
    // command, no change of state makes it useful, so there is nothing to grey.
    .filter((action) => action.id !== 'app:palette')
    .map<PaletteEntry>((action) => {
      const binding = keymap[action.id]
      return {
        id: action.id,
        label: action.label,
        category: action.category,
        binding: binding ? formatBinding(binding, platform) : undefined,
        unavailable: action.unavailable?.(context) ?? undefined
      }
    })

  return sink(matching(all, query))
}

/** The rows `query` selects, or all of them for an empty query. */
function matching(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries

  const exact = entries.filter(
    (entry) =>
      entry.label.toLowerCase().includes(needle) || entry.category.toLowerCase().includes(needle)
  )
  return exact.length > 0 ? exact : searchFilter(query, entries, (entry) => entry.label)
}

/**
 * Unavailable rows to the bottom, alphabetically; everything else left as it
 * came.
 *
 * Last rather than first because the cursor starts at the top: the first Enter
 * after typing has to land on something that runs. The top half is untouched, so
 * catalogue order — and the fuzzy pass's ranking — survives there.
 *
 * The tail is sorted by name instead, because it is not read the way the list
 * above it is. Catalogue order is a reading order, grouped by category; once the
 * rows are only the ones that are off, nobody scans them — they come here to
 * check on one command they expected to find, and a name is what they have.
 */
function sink(entries: PaletteEntry[]): PaletteEntry[] {
  return [
    ...entries.filter((entry) => !entry.unavailable),
    ...entries.filter((entry) => entry.unavailable).sort((a, b) => a.label.localeCompare(b.label))
  ]
}

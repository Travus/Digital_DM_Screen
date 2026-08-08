/**
 * What the action palette shows, worked out away from the component so the
 * decisions are a table of cases rather than something you have to open a window
 * to see.
 *
 * Two of them matter. The palette lists **only commands that currently apply**,
 * using the `enabled` predicates in the catalogue: a menu can carry a row that
 * quietly does nothing, but the palette is where a user goes to find out what
 * they *can* do, and "Close panel" on a locked layout is a wrong answer to that
 * question. And it lists **every** applicable command, bound or not — reaching
 * the ones with no key is the point of having it at all.
 */

import { formatBinding } from '../../../shared/accelerator'
import {
  ACTIONS,
  type ActionCategory,
  type ActionContext,
  type ActionId,
  type ResolvedKeymap
} from '../../../shared/actions'
import { findParent } from '../../../shared/layout'
import type { LayoutDoc } from '../../../shared/types'
import { searchFilter } from './search'

export interface PaletteEntry {
  id: ActionId
  label: string
  category: ActionCategory
  /** Written for the platform already, or undefined when the action has no key. */
  binding?: string
}

/**
 * The state the `enabled` predicates ask about, read off the document rather
 * than off the store, so this stays a function of its inputs.
 *
 * `targetNodeId` is whatever `resolveTargetNodeId()` says — the panel a command
 * would act on, which is the same one the menu and the keyboard use.
 */
export function actionContext(
  doc: LayoutDoc,
  targetNodeId: string | null,
  maximizedNodeId: string | null
): ActionContext {
  return {
    locked: doc.locked,
    hasPanel: targetNodeId !== null,
    maximized: maximizedNodeId !== null,
    // The split a Flip or Even Out acts on is the one *containing* the target,
    // which is also how `App`'s dispatcher and the ⋯ menu pick it.
    hasSplit: targetNodeId !== null && findParent(doc.root, targetNodeId) !== null
  }
}

/**
 * The rows to show, in catalogue order, filtered by `query`.
 *
 * Matching follows the module picker: an exact substring pass over the label and
 * the category name, and only if that finds nothing does the typo-tolerant pass
 * run — over labels alone, since there are five category names and a fuzzy match
 * against one of them would drag in a whole category for a query that was aimed
 * at a single command.
 */
export function paletteEntries(
  keymap: ResolvedKeymap,
  context: ActionContext,
  query: string,
  platform: string
): PaletteEntry[] {
  const available = ACTIONS.filter((action) => {
    // The palette does not offer the command that opens the palette. It is the
    // one row that could never do anything from in here.
    if (action.id === 'app:palette') return false
    return action.enabled ? action.enabled(context) : true
  }).map<PaletteEntry>((action) => {
    const binding = keymap[action.id]
    return {
      id: action.id,
      label: action.label,
      category: action.category,
      binding: binding ? formatBinding(binding, platform) : undefined
    }
  })

  const needle = query.trim().toLowerCase()
  if (!needle) return available

  const exact = available.filter(
    (entry) =>
      entry.label.toLowerCase().includes(needle) || entry.category.toLowerCase().includes(needle)
  )
  return exact.length > 0 ? exact : searchFilter(query, available, (entry) => entry.label)
}

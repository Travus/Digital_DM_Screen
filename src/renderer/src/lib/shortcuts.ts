import { useMemo } from 'react'
import { formatAccelerator } from '../../../shared/accelerator'
import type { ActionId, ResolvedKeymap } from '../../../shared/actions'
import { useKeymapStore } from '../state/keymapStore'

/**
 * Shortcut captions for the in-app surfaces: the top bar buttons, their hover
 * hints, the ⋯ menu rows and the About dialog's list.
 *
 * This file used to be a literal table that had to be kept in step with the
 * accelerators in `src/main/menu.ts` by hand — its own comment said so. Now both
 * read the same keymap, so a rebinding shows up on the menu item and on every
 * caption at once, which is the only way the two can be trusted to agree.
 *
 * `undefined` rather than null for an unbound action, so it drops straight into
 * the optional `shortcut` prop on a menu row.
 */
export type ShortcutLabels = Record<ActionId, string | undefined>

function toLabels(keymap: ResolvedKeymap): ShortcutLabels {
  const platform = window.dmscreen.platform
  const labels = {} as ShortcutLabels
  for (const [id, accelerator] of Object.entries(keymap) as [ActionId, string | null][]) {
    labels[id] = accelerator ? formatAccelerator(accelerator, platform) : undefined
  }
  return labels
}

export function useShortcuts(): ShortcutLabels {
  const keymap = useKeymapStore((state) => state.keymap)
  return useMemo(() => toLabels(keymap), [keymap])
}

/**
 * Renders " (Ctrl+L)" for a tooltip, or nothing at all when the action has no
 * binding — a caption reading "Lock the layout ()" is worse than one with no
 * hint, and every one of these strings is built by interpolation.
 */
export function parenthesised(shortcut: string | undefined): string {
  return shortcut ? ` (${shortcut})` : ''
}

import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  resolveKeymap,
  type ActionContext,
  type ActionId,
  type Keymap,
  type ResolvedKeymap
} from '../../../shared/actions'
import type { LayoutDoc, LayoutNode } from '../../../shared/types'
import { actionContext, paletteEntries } from './palette'

const keymap = (overrides: Keymap = {}): ResolvedKeymap => resolveKeymap(overrides)

const context = (overrides: Partial<ActionContext> = {}): ActionContext => ({
  locked: false,
  hasPanel: true,
  maximized: false,
  isPrimary: true,
  hasWindows: false,
  hasSplit: true,
  // Surrounded on all four sides by default, so a test says what it is about by
  // taking a side away rather than by granting one.
  neighbours: { left: true, right: true, up: true, down: true },
  ...overrides
})

const ids = (entries: { id: ActionId }[]): ActionId[] => entries.map((entry) => entry.id)

const list = (over: Partial<ActionContext> = {}, query = ''): ActionId[] =>
  ids(paletteEntries(keymap(), context(over), query, 'win32'))

/** Just the rows that would run, which is what the old `list` used to return. */
const runnable = (over: Partial<ActionContext> = {}, query = ''): ActionId[] =>
  ids(paletteEntries(keymap(), context(over), query, 'win32').filter((entry) => !entry.unavailable))

const reasonFor = (id: ActionId, over: Partial<ActionContext> = {}): string | undefined =>
  paletteEntries(keymap(), context(over), '', 'win32').find((entry) => entry.id === id)?.unavailable

describe('what the palette offers', () => {
  it('lists every command that applies, bound or not', () => {
    const shown = list()
    // The unbound ones are the reason it exists: without a palette there is no
    // way at all to reach a command that ships with no key and no button.
    expect(shown).toContain('view:toggleTheme')
    expect(shown).toContain('app:shortcuts')
    expect(shown).toContain('data:reloadPacks')
  })

  it('does not offer the command that opens it', () => {
    expect(list()).not.toContain('app:palette')
  })

  it('offers the global commands from anywhere', () => {
    // The three the issue asked for by name, none of which depends on a panel.
    const bare = list({ hasPanel: false, hasSplit: false })
    expect(bare).toEqual(expect.arrayContaining(['layout:save', 'app:shortcuts', 'app:quit']))
  })

  it('keeps the structural commands while the layout is locked, greyed', () => {
    // `store.closePanel` already refuses these, so running one does nothing —
    // but a row that disappears takes the explanation with it, which is how a
    // locked layout came to look like a palette missing half its commands.
    const locked = context({ locked: true })
    expect(list({ locked: true })).toContain('panel:close')
    expect(runnable({ locked: true })).not.toContain('panel:close')
    expect(reasonFor('panel:splitRight', locked)).toBe('the layout is locked')
    expect(reasonFor('split:flip', locked)).toBe('the layout is locked')
    // Everything the lock does not reach stays live — saving it, and the command
    // that undoes the lock itself, which greying would strand the user behind.
    expect(runnable({ locked: true })).toEqual(
      expect.arrayContaining(['layout:toggleLock', 'layout:save', 'panel:changeModule'])
    )
  })

  it('greys renaming as well, at both levels', () => {
    // A name is part of the arrangement. Both used to stay live while locked, so
    // a padlocked screen could still be relabelled by a stray double-click — and
    // the palette said nothing about it, because there was nothing to say.
    const locked = context({ locked: true })
    expect(runnable({ locked: true })).not.toContain('panel:rename')
    expect(runnable({ locked: true })).not.toContain('layout:rename')
    expect(reasonFor('panel:rename', locked)).toBe('the layout is locked')
    expect(reasonFor('layout:rename', locked)).toBe('the layout is locked')
    // Unlocked they are ordinary rows, and the layout one applies with no panel
    // in the document at all.
    expect(runnable()).toContain('panel:rename')
    expect(runnable({ hasPanel: false })).toContain('layout:rename')
    expect(reasonFor('panel:rename', context({ hasPanel: false }))).toBe(
      'this layout has no panels'
    )
  })

  it('greys the split commands when the panel is not inside one', () => {
    expect(runnable({ hasSplit: false })).not.toContain('split:equalise')
    expect(reasonFor('split:equalise', context({ hasSplit: false }))).toBe(
      'this panel is not inside a split'
    )
  })

  it('blames the lock first when both the lock and the layout are against it', () => {
    // A boolean predicate could not tell these apart at all, which is the whole
    // reason `unavailable` returns the reason. The lock leads because it is the
    // one of the two the user can undo on the spot.
    expect(reasonFor('split:flip', context({ locked: true, hasSplit: false }))).toBe(
      'the layout is locked'
    )
    expect(reasonFor('panel:close', context({ locked: true, hasPanel: false }))).toBe(
      'the layout is locked'
    )
    expect(reasonFor('panel:close', context({ hasPanel: false }))).toBe('this layout has no panels')
  })

  it('runs leaving fullscreen only from fullscreen', () => {
    expect(reasonFor('panel:restore')).toBe('no panel is fullscreen')
    expect(runnable({ maximized: true })).toContain('panel:restore')
  })

  it('sorts the unavailable rows below the rest', () => {
    // Sunk rather than dropped, and sunk rather than left in place: the cursor
    // starts at the top, so the first Enter after opening has to hit something
    // that runs.
    const shown = list({ locked: true })
    const firstOff = shown.findIndex((id) => id === 'panel:close')
    const lastLive = shown.lastIndexOf('app:quit')
    expect(firstOff).toBeGreaterThan(lastLive)
  })

  it('keeps catalogue order above and sorts the greyed tail by name', () => {
    const shown = list({ locked: true, hasSplit: false })
    expect(shown.filter((id) => id.startsWith('panel:') || id.startsWith('split:'))).toEqual([
      // Above: the catalogue's own order, which groups by category.
      'panel:maximize',
      'panel:changeModule',
      // Below: "Close panel", "Even out surrounding split", "Flip surrounding
      // split", "Leave panel fullscreen", "Make panel narrower/shorter/taller/
      // wider", "Rename panel", "Split panel down", "Split panel right", "Swap
      // with panel above/below/left/right" — a tail nobody scans in order is a
      // tail you look a name up in.
      'panel:close',
      'split:equalise',
      'split:flip',
      'panel:restore',
      'panel:narrower',
      'panel:shorter',
      'panel:taller',
      'panel:wider',
      'panel:rename',
      'panel:splitDown',
      'panel:splitRight',
      'panel:swapUp',
      'panel:swapDown',
      'panel:swapLeft',
      'panel:swapRight'
    ])
  })

  it('leaves an available command with no reason at all', () => {
    expect(reasonFor('panel:close')).toBeUndefined()
    expect(reasonFor('layout:save')).toBeUndefined()
  })

  it('shows the live binding, written for the platform', () => {
    const [save] = paletteEntries(
      keymap({ 'layout:save': 'CmdOrCtrl+Alt+S' }),
      context(),
      'save layout',
      'darwin'
    )
    expect(save).toMatchObject({ id: 'layout:save', binding: 'Cmd+Alt+S' })
  })

  it('leaves an unbound command without one, rather than showing a placeholder', () => {
    const [entry] = paletteEntries(keymap(), context(), 'about', 'win32')
    expect(entry).toMatchObject({ id: 'app:about', binding: undefined })
  })

  it('keeps catalogue order, so the list reads grouped by category', () => {
    const shown = list()
    expect(shown.indexOf('layout:save')).toBeLessThan(shown.indexOf('panel:close'))
    expect(shown.indexOf('panel:close')).toBeLessThan(shown.indexOf('app:quit'))
  })
})

describe('filtering the palette', () => {
  it('matches on the label', () => {
    expect(list({}, 'split')).toEqual([
      'panel:splitRight',
      'panel:splitDown',
      'split:flip',
      'split:equalise'
    ])
  })

  it('matches on the category, so a whole menu can be summoned by name', () => {
    expect(list({}, 'data')).toEqual(['data:importPack', 'data:reloadPacks'])
  })

  it('falls back to typo tolerance only when nothing matches exactly', () => {
    // "fulscreen" is one deletion from "fullscreen" and matches no label exactly.
    expect(list({ maximized: true }, 'fulscreen')).toEqual(['panel:maximize', 'panel:restore'])
  })

  it('does not widen a query that already works', () => {
    // The fallback runs only on an empty exact pass, so a search that finds
    // something today cannot start finding more later.
    expect(list({}, 'lock')).toEqual(['layout:toggleLock'])
  })

  it('returns nothing rather than everything for a query that matches nothing', () => {
    expect(list({}, 'zzzzzz')).toEqual([])
  })
})

describe('reading the context off a document', () => {
  const panel = (id: string): LayoutNode => ({ type: 'panel', id, panelId: `p_${id}` })

  const doc = (root: LayoutNode, locked = false): LayoutDoc => ({
    formatVersion: 2,
    name: 'Test',
    windows: [{ id: 'w1', name: 'Main window', root, open: true }],
    panels: {},
    locked,
    createdAt: '',
    updatedAt: ''
  })

  const split: LayoutNode = {
    type: 'split',
    id: 'split_1',
    direction: 'row',
    children: [panel('node_a'), panel('node_b')],
    sizes: [0.5, 0.5]
  }

  it('reports a lone panel as having no surrounding split', () => {
    expect(actionContext(doc(panel('node_a')), 'w1', 'node_a', null)).toEqual({
      locked: false,
      hasPanel: true,
      maximized: false,
      isPrimary: true,
      hasWindows: false,
      hasSplit: false,
      neighbours: { left: false, right: false, up: false, down: false }
    })
  })

  it('reports the sides the target has a neighbour on', () => {
    // Two panes side by side: the left one can only swap rightwards, and there
    // is nothing above or below either of them.
    expect(actionContext(doc(split), 'w1', 'node_a', null).neighbours).toEqual({
      left: false,
      right: true,
      up: false,
      down: false
    })
    expect(actionContext(doc(split), 'w1', 'node_b', null).neighbours.left).toBe(true)
  })

  it('finds the split containing the target', () => {
    expect(actionContext(doc(split), 'w1', 'node_b', null).hasSplit).toBe(true)
  })

  it('carries the lock and the fullscreen state through', () => {
    const state = actionContext(doc(split, true), 'w1', 'node_a', 'node_a')
    expect(state).toMatchObject({ locked: true, maximized: true })
  })

  it('copes with no panel at all', () => {
    expect(actionContext(doc(split), 'w1', null, null)).toMatchObject({
      hasPanel: false,
      hasSplit: false
    })
  })
})

describe('the catalogue behind it', () => {
  it('gives every action a label the palette can show', () => {
    for (const action of ACTIONS) {
      expect([action.id, action.label.trim().length > 0]).toEqual([action.id, true])
    }
  })

  it('writes every reason as a fragment its callers can prefix', () => {
    // Both surfaces build a sentence around one — "“Close panel” is unavailable
    // — …" and "Unavailable — …" — so a capital or a full stop lands mid-line.
    // Every combination, because a reason only exists under the state that
    // produces it and the rarest of them are the ones nobody looks at.
    for (const action of ACTIONS) {
      if (!action.unavailable) continue
      for (const locked of [true, false]) {
        for (const hasPanel of [true, false]) {
          for (const maximized of [true, false]) {
            for (const hasSplit of [true, false]) {
              // Both extremes of the neighbour map: hemmed in on every side, and
              // alone on the screen, which is where the four directional reasons
              // are the ones that speak.
              for (const side of [true, false]) {
                // The primary flag both ways too: "this is the main window" is a
                // reason only one of them produces.
                for (const isPrimary of [true, false]) {
                  const reason = action.unavailable({
                    locked,
                    hasPanel,
                    maximized,
                    isPrimary,
                    hasWindows: !isPrimary,
                    hasSplit,
                    neighbours: { left: side, right: side, up: side, down: side }
                  })
                  if (reason === null) continue
                  expect([action.id, reason]).toEqual([action.id, reason.trim()])
                  expect([action.id, reason[0]]).toEqual([action.id, reason[0].toLowerCase()])
                  expect([action.id, reason.endsWith('.')]).toEqual([action.id, false])
                }
              }
            }
          }
        }
      }
    }
  })
})

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
  hasSplit: true,
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
    // Everything that still works stays live, including renaming a panel: the
    // lock freezes the arrangement, not the contents.
    expect(runnable({ locked: true })).toEqual(
      expect.arrayContaining(['panel:rename', 'layout:toggleLock', 'layout:save'])
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

  it('keeps catalogue order inside each half', () => {
    const shown = list({ locked: true, hasSplit: false })
    // Both halves read as the catalogue wrote them, not as they failed.
    expect(shown.filter((id) => id.startsWith('panel:') || id.startsWith('split:'))).toEqual([
      'panel:maximize',
      'panel:rename',
      'panel:changeModule',
      'panel:splitRight',
      'panel:splitDown',
      'panel:restore',
      'panel:close',
      'split:flip',
      'split:equalise'
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
    formatVersion: 1,
    name: 'Test',
    root,
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
    expect(actionContext(doc(panel('node_a')), 'node_a', null)).toEqual({
      locked: false,
      hasPanel: true,
      maximized: false,
      hasSplit: false
    })
  })

  it('finds the split containing the target', () => {
    expect(actionContext(doc(split), 'node_b', null).hasSplit).toBe(true)
  })

  it('carries the lock and the fullscreen state through', () => {
    const state = actionContext(doc(split, true), 'node_a', 'node_a')
    expect(state).toMatchObject({ locked: true, maximized: true })
  })

  it('copes with no panel at all', () => {
    expect(actionContext(doc(split), null, null)).toMatchObject({
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
              const reason = action.unavailable({ locked, hasPanel, maximized, hasSplit })
              if (reason === null) continue
              expect([action.id, reason]).toEqual([action.id, reason.trim()])
              expect([action.id, reason[0]]).toEqual([action.id, reason[0].toLowerCase()])
              expect([action.id, reason.endsWith('.')]).toEqual([action.id, false])
            }
          }
        }
      }
    }
  })
})

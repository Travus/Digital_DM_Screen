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

  it('hides the structural commands while the layout is locked', () => {
    // `store.closePanel` already refuses these, so listing them would offer a
    // command that does nothing — which is exactly what a palette must not do.
    const locked = list({ locked: true })
    expect(locked).not.toContain('panel:close')
    expect(locked).not.toContain('panel:splitRight')
    expect(locked).not.toContain('split:flip')
    // Everything that still works stays, including renaming a panel: the lock
    // freezes the arrangement, not the contents.
    expect(locked).toContain('panel:rename')
    expect(locked).toContain('layout:toggleLock')
    expect(locked).toContain('layout:save')
  })

  it('hides the split commands when the panel is not inside one', () => {
    expect(list({ hasSplit: false })).not.toContain('split:equalise')
  })

  it('offers leaving fullscreen only from fullscreen', () => {
    expect(list()).not.toContain('panel:restore')
    expect(list({ maximized: true })).toContain('panel:restore')
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
})

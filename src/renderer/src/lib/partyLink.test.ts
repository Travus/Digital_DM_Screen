/**
 * The initiative ↔ party sync, and mostly one bug: panel state is **sparse**, so
 * a party panel nobody has opened the column settings on has no `state.fields`
 * at all. Reading that key directly found undefined and every lookup below it
 * quietly returned nothing — sync appeared to do nothing for exactly the panels
 * that had been left alone.
 *
 * So the cases here come in pairs: one on a panel that has saved its columns,
 * one on a panel that has not.
 */
import { describe, expect, it } from 'vitest'
import type { PanelData } from '../../../shared/types'
import { defaultPartyFields, type PartyCharacter } from '../modules/PartyModule'
import {
  applyStatToParty,
  findAcField,
  findCharacter,
  findHpField,
  isPartyPanel,
  readLinkedStats
} from './partyLink'

const thora = (over: Partial<PartyCharacter> = {}): PartyCharacter => ({
  id: 'c1',
  name: 'Thora',
  values: { ac: 18, hp: { current: 44, max: 52 } },
  ...over
})

/** A party panel that has never had its columns touched — no `fields` at all. */
const untouched = (characters: PartyCharacter[] = [thora()]): PanelData => ({
  moduleId: 'party',
  settings: {},
  state: { characters }
})

/** The same panel after the settings drawer has written the columns out. */
const saved = (characters: PartyCharacter[] = [thora()]): PanelData => ({
  moduleId: 'party',
  settings: {},
  state: { fields: defaultPartyFields(), characters }
})

const panels = (panel: PanelData): Record<string, PanelData> => ({ party: panel })
const link = { panelId: 'party', characterId: 'c1' }

describe('finding the columns to sync', () => {
  it('falls back to the module defaults when the panel has saved no columns', () => {
    // The bug in one assertion: without the fallback these are undefined, and
    // every read and write below them turns into a no-op.
    expect(findAcField(untouched())?.id).toBe('ac')
    expect(findHpField(untouched())?.id).toBe('hp')
  })

  it('reads the panel’s own columns once it has some', () => {
    expect(findAcField(saved())?.id).toBe('ac')
    expect(findHpField(saved())?.id).toBe('hp')
  })

  it('matches on the label rather than the id, ignoring case and space', () => {
    // A party panel opts into sync by naming a column, so a renamed-then-
    // relabelled column keeps working and a differently named one does not.
    const renamed: PanelData = {
      moduleId: 'party',
      settings: {},
      state: {
        fields: [
          { id: 'armour', label: '  ac  ', type: 'number' },
          { id: 'health', label: 'Hp', type: 'meter' }
        ],
        characters: []
      }
    }
    expect(findAcField(renamed)?.id).toBe('armour')
    expect(findHpField(renamed)?.id).toBe('health')
  })

  it('ignores a column of the right name but the wrong kind', () => {
    // AC has to be a number and HP a meter; a text column called "HP" has no
    // current/max to read or write.
    const wrongTypes: PanelData = {
      moduleId: 'party',
      settings: {},
      state: {
        fields: [
          { id: 'ac', label: 'AC', type: 'text' },
          { id: 'hp', label: 'HP', type: 'number' }
        ],
        characters: []
      }
    }
    expect(findAcField(wrongTypes)).toBeUndefined()
    expect(findHpField(wrongTypes)).toBeUndefined()
  })
})

describe('recognising a party panel', () => {
  it('goes by the module, not by what the state happens to look like', () => {
    expect(isPartyPanel(untouched())).toBe(true)
    expect(isPartyPanel({ moduleId: 'initiative', settings: {}, state: {} })).toBe(false)
  })
})

describe('reading a linked combatant', () => {
  it('reads AC and HP from a panel that has saved no columns', () => {
    expect(readLinkedStats(panels(untouched()), link)).toEqual({
      ac: 18,
      hpCurrent: 44,
      hpMax: 52
    })
  })

  it('reads them the same way once the columns are saved', () => {
    expect(readLinkedStats(panels(saved()), link)).toEqual({ ac: 18, hpCurrent: 44, hpMax: 52 })
  })

  it('returns null when there is nothing to read from', () => {
    // Each of these is a live case: no link at all, a panel since closed, a
    // panel since given a different module, and a character since deleted.
    expect(readLinkedStats(panels(saved()), undefined)).toBeNull()
    expect(readLinkedStats({}, link)).toBeNull()
    expect(readLinkedStats(panels({ moduleId: 'notes', settings: {}, state: {} }), link)).toBeNull()
    expect(readLinkedStats(panels(saved([])), link)).toBeNull()
  })

  it('reports a missing column as null, so initiative keeps its own value', () => {
    // Null is not zero here: a party panel with no AC column must not overwrite
    // the combatant's AC with nothing.
    const noAc: PanelData = {
      moduleId: 'party',
      settings: {},
      state: {
        fields: [{ id: 'hp', label: 'HP', type: 'meter' }],
        characters: [thora()]
      }
    }
    expect(readLinkedStats(panels(noAc), link)).toEqual({ ac: null, hpCurrent: 44, hpMax: 52 })
  })

  it('reads an unfilled cell as zero rather than as an absent column', () => {
    const blank = saved([thora({ values: {} })])
    expect(readLinkedStats(panels(blank), link)).toEqual({ ac: 0, hpCurrent: 0, hpMax: 0 })
  })
})

describe('writing an edit back', () => {
  it('writes to a panel that has saved no columns', () => {
    const next = applyStatToParty(panels(untouched()), link, { ac: 20 })
    expect(next?.[0].values.ac).toBe(20)
    // Everything else on the character survives the write.
    expect(next?.[0].values.hp).toEqual({ current: 44, max: 52 })
    expect(next?.[0].name).toBe('Thora')
  })

  it('changes one end of a meter and leaves the other alone', () => {
    const next = applyStatToParty(panels(saved()), link, { hpCurrent: 30 })
    expect(next?.[0].values.hp).toEqual({ current: 30, max: 52 })
  })

  it('fills in a meter the character has never had', () => {
    const next = applyStatToParty(panels(saved([thora({ values: {} })])), link, { hpMax: 40 })
    expect(next?.[0].values.hp).toEqual({ current: 0, max: 40 })
  })

  it('does not touch the array it was given', () => {
    // The store replaces `characters` wholesale with what comes back, so a
    // mutation here would be an edit nothing re-rendered on.
    const panel = saved()
    const before = structuredClone(panel.state.characters)
    applyStatToParty(panels(panel), link, { ac: 20 })
    expect(panel.state.characters).toEqual(before)
  })

  it('returns null when there is nothing to write', () => {
    // Null means "do not call setState", which is what keeps a sync that has
    // nothing to say from marking the layout dirty.
    expect(applyStatToParty(panels(saved()), link, {})).toBeNull()
    expect(applyStatToParty({}, link, { ac: 20 })).toBeNull()
    expect(applyStatToParty(panels(saved([])), link, { ac: 20 })).toBeNull()
    expect(
      applyStatToParty(panels({ moduleId: 'notes', settings: {}, state: {} }), link, { ac: 20 })
    ).toBeNull()
  })

  it('returns null when the panel has no column for what changed', () => {
    const noAc: PanelData = {
      moduleId: 'party',
      settings: {},
      state: {
        fields: [{ id: 'hp', label: 'HP', type: 'meter' }],
        characters: [thora()]
      }
    }
    expect(applyStatToParty(panels(noAc), link, { ac: 20 })).toBeNull()
    // The HP column is still there, so an HP edit still lands.
    expect(applyStatToParty(panels(noAc), link, { hpCurrent: 10 })).not.toBeNull()
  })
})

describe('finding the linked character', () => {
  it('finds it through a panel with no saved columns', () => {
    expect(findCharacter(panels(untouched()), link)?.name).toBe('Thora')
  })

  it('gives up on a link that no longer points anywhere', () => {
    expect(findCharacter(panels(saved()), undefined)).toBeUndefined()
    expect(
      findCharacter(panels(saved()), { panelId: 'party', characterId: 'gone' })
    ).toBeUndefined()
    expect(findCharacter({}, link)).toBeUndefined()
  })
})

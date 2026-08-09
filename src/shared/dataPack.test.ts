/**
 * `parseDataPack` is the only thing standing between a third-party file and the
 * renderer, so the cases here are mostly about what it must *refuse*. Everything
 * downstream — `resolve()`, the reference lists, the cross-reference popover —
 * assumes the shape this function guarantees.
 */
import { describe, expect, it } from 'vitest'
import { parseDataPack } from './dataPack'
import { DATAPACK_FORMAT_VERSION } from './types'

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'mm-careful',
  name: 'Careful Spell',
  summary: 'Protect some targets.',
  lines: ['Spend 1 sorcery point.'],
  ...over
})

const pack = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  formatVersion: 1,
  id: 'my-pack',
  name: 'My Pack',
  ...over
})

describe('accepting a pack', () => {
  it('takes a minimal pack with no content at all', () => {
    // A pack that only declares itself is legal — that is what an empty starting
    // file looks like, and refusing it would be a poor first experience.
    const parsed = parseDataPack(pack())
    expect(parsed?.pack).toMatchObject({ id: 'my-pack', name: 'My Pack', formatVersion: 1 })
    expect(parsed?.pack.conditions).toBeUndefined()
  })

  it('carries the optional entry fields through and drops the wrong-typed ones', () => {
    const parsed = parseDataPack(pack({ conditions: [entry({ meta: 'PHB · p. 290', note: 42 })] }))
    expect(parsed?.pack.conditions?.[0]).toMatchObject({
      id: 'mm-careful',
      meta: 'PHB · p. 290',
      note: undefined
    })
  })

  it('accepts a rule section with items and tables', () => {
    const parsed = parseDataPack(
      pack({
        rules: [
          {
            id: 'cover',
            title: 'Cover',
            items: [{ term: 'Half cover', text: '+2 AC.' }],
            tables: [{ caption: 'Degrees', head: ['Cover', 'Bonus'], rows: [['Half', '+2']] }]
          }
        ]
      })
    )
    expect(parsed?.pack.rules?.[0]).toMatchObject({ id: 'cover', title: 'Cover' })
    expect(parsed?.pack.rules?.[0].tables?.[0].rows).toEqual([['Half', '+2']])
  })

  it('lets a group or section arrive without a title, because it may be extending one', () => {
    // A pack adding one manoeuvre to a bundled tab has no business restating the
    // tab's title. Whether anything ever supplied one is decided at merge time,
    // where the other sources are visible.
    const parsed = parseDataPack(
      pack({ abilityGroups: [{ id: 'metamagic', entries: [entry()] }], rules: [{ id: 'cover' }] })
    )
    expect(parsed?.pack.abilityGroups?.[0]).toMatchObject({ id: 'metamagic', title: '', blurb: '' })
    expect(parsed?.pack.rules?.[0]).toMatchObject({ id: 'cover', title: '' })
  })

  it('accepts the current format version and every version before it', () => {
    expect(parseDataPack(pack({ formatVersion: DATAPACK_FORMAT_VERSION }))).not.toBeNull()
    expect(parseDataPack(pack({ formatVersion: 1 }))).not.toBeNull()
  })
})

describe('refusing a pack', () => {
  it('rejects anything that is not an object', () => {
    for (const value of [null, undefined, 7, 'pack', []]) {
      expect(parseDataPack(value)).toBeNull()
    }
  })

  it('rejects an id that is not a plain identifier', () => {
    // Ids are half of every namespaced entry key, so they cannot carry the
    // separator, whitespace, or a leading dash.
    for (const id of ['My Pack', 'my:pack', '-pack', 'MyPack', '', 'my_pack']) {
      expect(parseDataPack(pack({ id }))).toBeNull()
    }
    expect(parseDataPack(pack({ id: 'my-pack-2' }))).not.toBeNull()
  })

  it('rejects a pack claiming the bundled id', () => {
    // `bundled:` is what the app's own entries are namespaced with. A pack under
    // that name would collide with them by design rather than by accident.
    expect(parseDataPack(pack({ id: 'bundled' }))).toBeNull()
  })

  it('rejects a missing or blank name', () => {
    expect(parseDataPack(pack({ name: '   ' }))).toBeNull()
    expect(parseDataPack(pack({ name: undefined }))).toBeNull()
    expect(parseDataPack(pack({ name: 12 }))).toBeNull()
  })

  it('rejects a version this build cannot read, in either direction', () => {
    expect(parseDataPack(pack({ formatVersion: 0 }))).toBeNull()
    expect(parseDataPack(pack({ formatVersion: DATAPACK_FORMAT_VERSION + 1 }))).toBeNull()
    // Absent is not "assume the current one" — an unversioned file is a guess.
    expect(parseDataPack(pack({ formatVersion: undefined }))).toBeNull()
  })

  it('rejects a section that is not a list', () => {
    expect(parseDataPack(pack({ conditions: {} }))).toBeNull()
    expect(parseDataPack(pack({ rules: 'none' }))).toBeNull()
  })

  it('rejects the whole pack for one bad entry, rather than dropping it', () => {
    // Silently skipping the bad one would ship a pack that looks fine and is
    // missing content its author cannot see is missing.
    expect(parseDataPack(pack({ conditions: [entry(), entry({ name: '' })] }))).toBeNull()
    expect(parseDataPack(pack({ conditions: [entry({ lines: 'one line' })] }))).toBeNull()
    expect(parseDataPack(pack({ conditions: [entry({ summary: undefined })] }))).toBeNull()
    expect(parseDataPack(pack({ conditions: [entry({ id: 'Bad Id' })] }))).toBeNull()
  })

  it('rejects a malformed rule item or table', () => {
    expect(
      parseDataPack(pack({ rules: [{ id: 'cover', items: [{ term: '', text: 'x' }] }] }))
    ).toBeNull()
    expect(parseDataPack(pack({ rules: [{ id: 'cover', items: 'x' }] }))).toBeNull()
    expect(
      parseDataPack(
        pack({ rules: [{ id: 'cover', tables: [{ head: ['A'], rows: [['a'], 'b'] }] }] })
      )
    ).toBeNull()
    expect(
      parseDataPack(pack({ rules: [{ id: 'cover', tables: [{ head: 'A', rows: [] }] }] }))
    ).toBeNull()
  })

  it('rejects an ability group whose entries are unusable', () => {
    expect(parseDataPack(pack({ abilityGroups: [{ id: 'metamagic', entries: {} }] }))).toBeNull()
    expect(
      parseDataPack(pack({ abilityGroups: [{ id: 'metamagic', entries: [{ id: 'x' }] }] }))
    ).toBeNull()
  })
})

describe('sections this build does not know', () => {
  it('keeps the pack and names what it skipped', () => {
    // The forward-compatibility rule: a pack written for a later version loads,
    // minus the parts this build has no code for. Refusing it outright would
    // make every new section a hard format break.
    const parsed = parseDataPack(pack({ spells: [], monsters: [] }))
    expect(parsed).not.toBeNull()
    expect(parsed?.unknownSections.sort()).toEqual(['monsters', 'spells'])
  })

  it('does not count the pack’s own metadata as unknown', () => {
    const parsed = parseDataPack(
      pack({ description: 'Homebrew.', $schema: './dmpack.schema.json', conditions: [] })
    )
    expect(parsed?.unknownSections).toEqual([])
    expect(parsed?.pack.description).toBe('Homebrew.')
  })
})

/**
 * The merge behind every reference module. Two things it must never do — throw,
 * and let one source quietly overwrite another — and one it must always do:
 * extend a container whose id it already has.
 *
 * Most cases run with the bundled content switched off, so what they assert is
 * the merge rather than the current contents of `data/`. The two that do read
 * the bundled data say so.
 */
import { describe, expect, it } from 'vitest'
import type { AbilityGroup, DataPack, DataSnapshot, ReferenceEntry } from '../../../shared/types'
import { BUNDLED_SOURCE_ID, buildPattern, migrateIds, resolve } from './resolve'

const ALL_OFF = {
  conditions: false,
  rules: false,
  abilities: false,
  diseases: false,
  names: false
}

const ALL_ON = {
  conditions: true,
  rules: true,
  abilities: true,
  diseases: true,
  names: true
}

const snapshot = (over: Partial<DataSnapshot> = {}): DataSnapshot => ({
  packs: [],
  refs: [],
  failed: [],
  enabled: ALL_OFF,
  ...over
})

const entry = (id: string, name = id): ReferenceEntry => ({
  id,
  name,
  summary: `${name} summary`,
  lines: []
})

const pack = (id: string, over: Partial<DataPack> = {}): DataPack => ({
  formatVersion: 1,
  id,
  name: `${id} pack`,
  ...over
})

const group = (id: string, over: Partial<AbilityGroup> = {}): AbilityGroup => ({
  id,
  title: id,
  blurb: '',
  entries: [],
  ...over
})

describe('namespacing entries', () => {
  it('qualifies every entry id with the source that supplied it', () => {
    // Two sources defining `mm-careful` would otherwise share a favourites key
    // and a React key — starring one would star the other.
    const data = resolve(
      snapshot({
        packs: [
          pack('alpha', { conditions: [entry('shaken', 'Shaken')] }),
          pack('beta', { conditions: [entry('shaken', 'Rattled')] })
        ]
      })
    )
    expect(data.conditions.map((condition) => condition.id)).toEqual([
      'alpha:shaken',
      'beta:shaken'
    ])
  })

  it('qualifies the bundled content under its own source id', () => {
    // Reads the real `data/` — the point is the prefix, not any one condition.
    const data = resolve(snapshot({ enabled: ALL_ON }))
    expect(data.conditions.length).toBeGreaterThan(0)
    for (const condition of data.conditions) {
      expect([condition.id, condition.id.startsWith(`${BUNDLED_SOURCE_ID}:`)]).toEqual([
        condition.id,
        true
      ])
    }
  })

  it('warns and skips when one source repeats an id, rather than listing it twice', () => {
    const data = resolve(
      snapshot({ packs: [pack('alpha', { conditions: [entry('shaken'), entry('shaken')] })] })
    )
    expect(data.conditions).toHaveLength(1)
    expect(data.warnings.join('\n')).toContain('duplicate condition id')
  })
})

describe('extending containers', () => {
  it('merges an ability group into one already loaded under the same id', () => {
    // The reason group ids are *not* namespaced: this is how a pack adds one
    // manoeuvre without restating the twenty-two already there.
    const data = resolve(
      snapshot({
        packs: [
          pack('alpha', { abilityGroups: [group('metamagic', { entries: [entry('careful')] })] }),
          pack('beta', { abilityGroups: [group('metamagic', { entries: [entry('subtle')] })] })
        ]
      })
    )
    expect(data.abilityGroups).toHaveLength(1)
    expect(data.abilityGroups[0].entries.map((item) => item.id)).toEqual([
      'alpha:careful',
      'beta:subtle'
    ])
  })

  it('keeps the first title and blurb, so a later pack cannot rename a tab', () => {
    const data = resolve(
      snapshot({
        packs: [
          pack('alpha', { abilityGroups: [group('metamagic', { title: 'Metamagic', blurb: '' })] }),
          pack('beta', {
            abilityGroups: [group('metamagic', { title: 'Renamed', blurb: 'Filled in later' })]
          })
        ]
      })
    )
    // First wins for what was there; a blank is still a gap the later pack fills.
    expect(data.abilityGroups[0]).toMatchObject({ title: 'Metamagic', blurb: 'Filled in later' })
  })

  it('appends a group nobody has claimed as its own tab', () => {
    const data = resolve(
      snapshot({
        packs: [
          pack('alpha', { abilityGroups: [group('metamagic')] }),
          pack('beta', { abilityGroups: [group('manoeuvres')] })
        ]
      })
    )
    expect(data.abilityGroups.map((item) => item.id)).toEqual(['metamagic', 'manoeuvres'])
  })

  it('warns when a group ends up with no title from any source', () => {
    const data = resolve(
      snapshot({ packs: [pack('alpha', { abilityGroups: [group('mystery', { title: '' })] })] })
    )
    expect(data.warnings.join('\n')).toContain('has no title')
  })

  it('concatenates the items and tables of a rule section', () => {
    const data = resolve(
      snapshot({
        packs: [
          pack('alpha', {
            rules: [{ id: 'cover', title: 'Cover', items: [{ term: 'Half', text: '+2 AC' }] }]
          }),
          pack('beta', {
            rules: [
              {
                id: 'cover',
                title: 'Ignored',
                items: [{ term: 'Three-quarters', text: '+5 AC' }],
                tables: [{ head: ['Cover'], rows: [['Half']] }],
                note: 'From beta.'
              }
            ]
          })
        ]
      })
    )
    expect(data.rules).toHaveLength(1)
    expect(data.rules[0].items?.map((item) => item.term)).toEqual(['Half', 'Three-quarters'])
    expect(data.rules[0].tables).toHaveLength(1)
    // A note fills an absent one and never replaces one that was set.
    expect(data.rules[0]).toMatchObject({ title: 'Cover', note: 'From beta.' })
  })

  it('does not mutate the bundled data it merges into', () => {
    // `collectAbilityGroups` pushes into the group it is holding, so a shallow
    // copy of the wrong thing here would grow the module-level array on every
    // reload until the app was restarted.
    const first = resolve(
      snapshot({
        enabled: ALL_ON,
        packs: [pack('alpha', { abilityGroups: [group('metamagic', { entries: [entry('x')] })] })]
      })
    ).abilityGroups.find((item) => item.id === 'metamagic')?.entries.length

    const second = resolve(
      snapshot({
        enabled: ALL_ON,
        packs: [pack('alpha', { abilityGroups: [group('metamagic', { entries: [entry('x')] })] })]
      })
    ).abilityGroups.find((item) => item.id === 'metamagic')?.entries.length

    expect(second).toBe(first)
  })
})

describe('conditions colliding on name', () => {
  it('warns when two sources define the same name under different ids', () => {
    // The name is what the popover scans prose for and what the initiative
    // tracker persists, so a clash matters however the ids differ.
    const data = resolve(
      snapshot({
        packs: [
          pack('alpha', { conditions: [entry('blind-a', 'Blinded')] }),
          pack('beta', { conditions: [entry('blind-b', 'blinded')] })
        ]
      })
    )
    expect(data.warnings.join('\n')).toContain('more than one source defines the condition')
  })

  it('indexes conditions by lowercase name for the popover to look them up', () => {
    const data = resolve(
      snapshot({ packs: [pack('alpha', { conditions: [entry('shaken', 'Shaken')] })] })
    )
    expect(data.conditionIndex.byLower.get('shaken')?.name).toBe('Shaken')
    expect(data.conditionNames).toEqual(['Shaken'])
  })
})

describe('the bundled content switches', () => {
  it('drops the built-in data without touching the packs', () => {
    const packed = pack('alpha', { conditions: [entry('shaken', 'Shaken')] })
    const off = resolve(snapshot({ packs: [packed], enabled: ALL_OFF }))
    const on = resolve(snapshot({ packs: [packed], enabled: ALL_ON }))

    expect(off.conditions.map((condition) => condition.id)).toEqual(['alpha:shaken'])
    expect(on.conditions.length).toBeGreaterThan(1)
    expect(off.nameStyles).toEqual([])
    expect(on.nameStyles.length).toBeGreaterThan(0)
  })
})

describe('staying total', () => {
  it('turns a failed pack into a warning rather than an exception', () => {
    // The only UI for removing a bad pack is the native menu, so a renderer that
    // died here would leave no way out of it.
    const data = resolve(
      snapshot({ failed: [{ path: '/gone/pack.dmpack.json', reason: 'could not be read' }] })
    )
    expect(data.warnings).toEqual(['/gone/pack.dmpack.json could not be read'])
    expect(data.conditions).toEqual([])
  })

  it('copes with a snapshot holding nothing at all', () => {
    const data = resolve(snapshot())
    expect(data).toMatchObject({ conditions: [], rules: [], abilityGroups: [], warnings: [] })
    expect(data.conditionIndex.pattern).toBeNull()
  })
})

describe('the cross-reference pattern', () => {
  it('is null for an empty list, which is what stops the scanner hanging', () => {
    // An empty alternation compiles to /\b()\b/gi, which matches the empty
    // string without advancing lastIndex — every card in the app renders through
    // that loop.
    expect(buildPattern([])).toBeNull()
    expect(buildPattern(['', '   '])).toBeNull()
  })

  it('puts the longest name first so an overlapping shorter one cannot win', () => {
    // A pack adding "Charmed by Fear" beside the bundled "Charmed": shortest
    // first would match the first word and leave the rest as loose prose.
    const pattern = buildPattern(['Charmed', 'Charmed by Fear']) as RegExp
    expect('Charmed by Fear'.replace(pattern, 'X')).toBe('X')
  })

  it('matches whole words, case-insensitively, and repeatedly', () => {
    const pattern = buildPattern(['Prone']) as RegExp
    expect('prone and Prone'.replace(pattern, 'X')).toBe('X and X')
    // Not inside a longer word: "Proneness" is not the condition.
    expect('Proneness'.replace(pattern, 'X')).toBe('Proneness')
  })

  it('escapes a name that would otherwise be a pattern of its own', () => {
    // Names come from packs, so they are not all plain words. Unescaped, the `+`
    // in a homebrew "Stunned+Prone" would quantify the preceding letter.
    const pattern = buildPattern(['Stunned+Prone']) as RegExp
    expect(pattern.test('Stunned+Prone')).toBe(true)
    // `lastIndex` survives a match on a /g/ pattern; the scanner resets it too.
    pattern.lastIndex = 0
    expect(pattern.test('StunneddddProne')).toBe(false)
  })
})

describe('migrating persisted ids', () => {
  it('reads a bare id as one the app itself supplied', () => {
    // Everything persisted before namespacing came from the bundled data, since
    // that was the only source there was.
    expect(migrateIds(['mm-careful'])).toEqual(['bundled:mm-careful'])
  })

  it('leaves an already-qualified id alone', () => {
    expect(migrateIds(['alpha:mm-careful', 'bundled:blinded'])).toEqual([
      'alpha:mm-careful',
      'bundled:blinded'
    ])
  })
})

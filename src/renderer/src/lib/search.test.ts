import { describe, expect, it } from 'vitest'
import { EXACT_RANK, FUZZY_RANK, matchText, searchFilter } from './search'

/** The bundled condition names, as the reference lists actually hold them. */
const CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious'
]

const METAMAGIC = ['Quickened Spell', 'Subtle Spell', 'Twinned Spell', 'Careful Spell']

const find = (query: string, pool: string[] = CONDITIONS): string[] =>
  searchFilter(query, pool, (name) => name)

describe('exact matching stays primary', () => {
  it('matches a substring anywhere in the name, case-insensitively', () => {
    expect(find('FRIGHT')).toEqual(['Frightened'])
    expect(find('ed')).toContain('Blinded')
    expect(matchText('prone', 'Prone', false)?.rank).toBe(EXACT_RANK)
  })

  it('returns everything for an empty or whitespace query', () => {
    expect(find('')).toHaveLength(CONDITIONS.length)
    expect(find('   ')).toHaveLength(CONDITIONS.length)
  })

  it('never adds fuzzy results when an exact match exists', () => {
    // "prone" is exact for Prone. Petrified is one edit from "prone"-ish noise;
    // it must not appear, because the exact pass succeeded.
    expect(find('prone')).toEqual(['Prone'])
  })
})

describe('typo tolerance, as a fallback only', () => {
  it('finds Quickened Spell from "quck" — the case from the issue', () => {
    expect(find('quck', METAMAGIC)).toEqual(['Quickened Spell'])
  })

  it('tolerates an omission', () => {
    expect(find('frigtened')).toEqual(['Frightened'])
  })

  it('tolerates an insertion', () => {
    expect(find('poisonned')).toEqual(['Poisoned'])
  })

  it('tolerates a substitution', () => {
    expect(find('stunmed')).toEqual(['Stunned'])
  })

  it('tolerates an adjacent transposition', () => {
    expect(find('paralzyed')).toEqual(['Paralyzed'])
    expect(find('unconsicous')).toEqual(['Unconscious'])
  })

  it('marks fuzzy hits as ranked below exact ones', () => {
    expect(matchText('frigtened', 'Frightened', true)?.rank).toBe(FUZZY_RANK)
    expect(matchText('frigtened', 'Frightened', false)).toBeNull()
  })
})

describe('conservatism — the noise guards', () => {
  it('gives very short queries no latitude at all', () => {
    // Under three characters almost everything is within one edit of anything,
    // so a typo'd short query must return nothing rather than most of the list.
    expect(find('xyz')).toEqual([])
    expect(find('pro')).toEqual(['Prone'])
    expect(find('prq')).toEqual([])
  })

  it('does not match an unrelated word of similar length', () => {
    expect(find('elephant')).toEqual([])
    expect(find('spaghetti')).toEqual([])
  })

  it('rejects a query too far from anything', () => {
    // Three edits from "Blinded"; the limit at this length is two.
    expect(find('blndd')).toEqual([])
  })

  it('does not let one typo drag in the whole list', () => {
    expect(find('stunmed').length).toBe(1)
    expect(find('frigtened').length).toBe(1)
  })
})

describe('ordering is deterministic', () => {
  it('preserves input order among exact matches', () => {
    expect(find('ed')).toEqual([
      'Blinded',
      'Charmed',
      'Deafened',
      'Frightened',
      'Grappled',
      'Incapacitated',
      'Paralyzed',
      'Petrified',
      'Poisoned',
      'Restrained',
      'Stunned'
    ])
  })

  it('orders fuzzy matches by closeness, then by input order', () => {
    const pool = ['Careful Spell', 'Carefull Spell', 'Careful Spel']
    // Every entry is within reach of "carefu1 spell"; the closest lead.
    const result = searchFilter('carefu1 spell', pool, (name) => name)
    expect(result[0]).toBe('Careful Spell')
    expect(result).toHaveLength(3)
  })

  it('returns a new array rather than the caller’s', () => {
    const pool = ['Prone']
    expect(searchFilter('', pool, (name) => name)).not.toBe(pool)
  })
})

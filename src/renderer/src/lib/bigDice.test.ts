import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  criticalOf,
  dieLabel,
  historyTitle,
  keptIndex,
  modeApplies,
  MODES,
  percentileFaces,
  percentileText,
  rollPercentile,
  slots,
  throwDice,
  throwsAPair,
  twinCriticalOf,
  type Pair
} from './bigDice'
import { PERCENTILE, SOLIDS } from './dieSolid'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Feeds `Math.random` a run of values, so a throw has a known answer. */
function rolls(...values: number[]): void {
  let index = 0
  // `rollDie` is `floor(random * sides) + 1`, so a face of n wants (n - 1) / sides.
  vi.spyOn(Math, 'random').mockImplementation(() => values[index++ % values.length])
}

/** The value that makes `rollDie(sides)` return `face`. */
function face(value: number, sides: number): number {
  return (value - 1) / sides
}

describe('dieLabel', () => {
  it('names percentile after the two dice it is, not its hundred faces', () => {
    expect(dieLabel(100)).toBe('d%')
    expect(dieLabel(20)).toBe('d20')
  })
})

describe('modeApplies', () => {
  it('is the d20 alone', () => {
    expect(modeApplies(20)).toBe(true)
    for (const sides of [4, 6, 8, 10, 12, 100]) expect(modeApplies(sides)).toBe(false)
  })
})

describe('MODES', () => {
  /* The array is the drawing order, so this is the only place the layout of the
     chip row is written down. Normal between the two that modify it reads as a
     scale; normal first reads as a default with two options bolted on. */
  it('puts the plain throw between the two that modify it', () => {
    expect(MODES).toEqual(['advantage', 'normal', 'disadvantage'])
  })
})

describe('throwsAPair', () => {
  it('is the two modes that name a second die, on the d20', () => {
    expect(throwsAPair(20, 'advantage')).toBe(true)
    expect(throwsAPair(20, 'disadvantage')).toBe(true)
    expect(throwsAPair(20, 'normal')).toBe(false)
    expect(throwsAPair(6, 'advantage')).toBe(false)
  })

  /*
    Asked as "is it one of the two that pair" rather than "is it not normal", so
    a mode this version does not know throws one die. A panel saved before the
    mode was renamed holds `flat`, and the wrong test would have quietly given
    it two dice and kept the higher.
  */
  it('throws one die for a mode it does not recognise', () => {
    expect(throwsAPair(20, 'flat' as never)).toBe(false)
    expect(throwDice(20, 'flat' as never, true).pair).toBeNull()
  })
})

describe('keptIndex', () => {
  it('keeps the higher under advantage and the lower under disadvantage', () => {
    expect(keptIndex([7, 19], 'advantage')).toBe(1)
    expect(keptIndex([19, 7], 'advantage')).toBe(0)
    expect(keptIndex([7, 19], 'disadvantage')).toBe(0)
    expect(keptIndex([19, 7], 'disadvantage')).toBe(1)
  })

  it('keeps the first of two equal dice, which hold the same value anyway', () => {
    expect(keptIndex([13, 13], 'advantage')).toBe(0)
    expect(keptIndex([13, 13], 'disadvantage')).toBe(0)
  })
})

describe('criticalOf', () => {
  it('names a natural 20 and a natural 1 on the d20', () => {
    expect(criticalOf(20, 20)).toBe('nat20')
    expect(criticalOf(20, 1)).toBe('nat1')
    expect(criticalOf(20, 14)).toBe('')
  })

  it('is nothing on a die with no criticals, and nothing before a throw', () => {
    expect(criticalOf(12, 12)).toBe('')
    expect(criticalOf(100, 1)).toBe('')
    expect(criticalOf(20, null)).toBe('')
  })
})

describe('twinCriticalOf', () => {
  it('names a pair of natural 20s and a pair of natural 1s', () => {
    expect(twinCriticalOf([20, 20])).toBe('nat20')
    expect(twinCriticalOf([1, 1])).toBe('nat1')
  })

  it('is nothing for a pair that merely contains one', () => {
    expect(twinCriticalOf([20, 3])).toBe('')
    expect(twinCriticalOf([1, 17])).toBe('')
  })

  it('is nothing for an ordinary tie, and nothing without a pair at all', () => {
    expect(twinCriticalOf([13, 13])).toBe('')
    expect(twinCriticalOf(null)).toBe('')
  })
})

describe('percentileFaces', () => {
  it('splits a total into the two dice that threw it', () => {
    expect(percentileFaces(62)).toEqual([60, 2])
    expect(percentileFaces(7)).toEqual([0, 7])
    expect(percentileFaces(90)).toEqual([90, 0])
  })

  /* 100 and 0 are the same throw — both dice showing zero — so both read 00
     and 0, and only the total tells them apart. */
  it('reads 100 and 0 as the same pair of faces', () => {
    expect(percentileFaces(100)).toEqual([0, 0])
    expect(percentileFaces(0)).toEqual([0, 0])
  })

  it('prints the tens die with both its digits', () => {
    expect(percentileText(100)).toEqual(['00', '0'])
    expect(percentileText(62)).toEqual(['60', '2'])
    expect(percentileText(7)).toEqual(['00', '7'])
  })
})

describe('rollPercentile', () => {
  it('reads two zeroes as 100 when asked to', () => {
    rolls(face(1, 10))
    expect(rollPercentile(true)).toBe(100)
  })

  it('reads the same throw as 0 when not', () => {
    rolls(face(1, 10))
    expect(rollPercentile(false)).toBe(0)
  })

  it('builds a total out of the tens die and the units die', () => {
    rolls(face(7, 10), face(3, 10))
    expect(rollPercentile(true)).toBe(62)
  })

  it('never leaves the range whichever convention is in force', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => Math.SQRT1_2)
    for (const zeroIsHundred of [true, false]) {
      const value = rollPercentile(zeroIsHundred)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    }
  })
})

describe('throwDice', () => {
  it('throws one die and no pair when normal', () => {
    rolls(face(14, 20))
    expect(throwDice(20, 'normal', true)).toEqual({ value: 14, pair: null })
  })

  it('throws two and keeps the higher under advantage', () => {
    rolls(face(6, 20), face(18, 20))
    expect(throwDice(20, 'advantage', true)).toEqual({ value: 18, pair: [6, 18] })
  })

  it('throws two and keeps the lower under disadvantage', () => {
    rolls(face(6, 20), face(18, 20))
    expect(throwDice(20, 'disadvantage', true)).toEqual({ value: 6, pair: [6, 18] })
  })

  /* The pair is in the order it was thrown, not sorted: the dice are side by
     side on screen and sorting them would move the kept one between throws. */
  it('reports the pair in the order it was thrown', () => {
    rolls(face(18, 20), face(6, 20))
    expect(throwDice(20, 'advantage', true).pair).toEqual([18, 6])
  })

  it('ignores a mode the die has no rule for', () => {
    rolls(face(5, 6))
    expect(throwDice(6, 'advantage', true)).toEqual({ value: 5, pair: null })
  })

  it('throws percentile as one total and no pair, whatever the mode', () => {
    rolls(face(4, 10), face(2, 10))
    expect(throwDice(100, 'advantage', true)).toEqual({ value: 31, pair: null })
  })
})

describe('slots', () => {
  it('is one die for a plain throw', () => {
    expect(slots(12, 'normal', 9, null)).toEqual([
      { solid: SOLIDS[12], value: 9, discarded: false }
    ])
  })

  it('rests a die on nothing before the first throw', () => {
    expect(slots(8, 'normal', null, null)[0].value).toBeNull()
  })

  it('is the two physical dice for percentile, tens first', () => {
    expect(slots(100, 'normal', 62, null)).toEqual([
      { solid: PERCENTILE[0], value: 60, discarded: false },
      { solid: PERCENTILE[1], value: 2, discarded: false }
    ])
  })

  it('leaves both percentile dice blank before the first throw', () => {
    expect(slots(100, 'normal', null, null).map((slot) => slot.value)).toEqual([null, null])
  })

  it('shows both d20s with the discarded one marked', () => {
    expect(slots(20, 'advantage', 18, [6, 18])).toEqual([
      { solid: SOLIDS[20], value: 6, discarded: true },
      { solid: SOLIDS[20], value: 18, discarded: false }
    ])
  })

  it('marks the other one under disadvantage', () => {
    expect(slots(20, 'disadvantage', 6, [6, 18]).map((slot) => slot.discarded)).toEqual([
      false,
      true
    ])
  })

  /*
    Switching to advantage must not conjure a second die out of a result that
    was thrown normally. The pair is what says there are two, so until one has
    been thrown the stage is still one die.
  */
  it('stays one die in a pair mode that has not thrown yet', () => {
    expect(slots(20, 'advantage', 14, null)).toHaveLength(1)
    expect(slots(20, 'advantage', null, null)).toHaveLength(1)
  })

  it('drops a stale pair when the mode goes back to normal', () => {
    expect(slots(20, 'normal', 18, [6, 18])).toEqual([
      { solid: SOLIDS[20], value: 18, discarded: false }
    ])
  })

  it('ignores a pair on a die with no rule for one', () => {
    expect(slots(6, 'advantage', 4, [4, 2] as Pair)).toHaveLength(1)
  })

  /*
    Which of two 13s was "kept" is a question with no answer, and a strike
    through one of them claims a distinction the throw did not make. The pair
    that matters most — two natural 20s — is exactly where crossing one out
    would be worst.
  */
  it('discards neither of two equal dice', () => {
    for (const mode of ['advantage', 'disadvantage'] as const) {
      expect(slots(20, mode, 13, [13, 13]).map((slot) => slot.discarded)).toEqual([false, false])
      expect(slots(20, mode, 20, [20, 20]).map((slot) => slot.discarded)).toEqual([false, false])
    }
  })

  it('discards exactly one whenever the two differ', () => {
    for (const pair of [
      [1, 20],
      [20, 1],
      [9, 14]
    ] as Pair[]) {
      for (const mode of ['advantage', 'disadvantage'] as const) {
        const marked = slots(20, mode, pair[keptIndex(pair, mode)], pair)
        expect(marked.filter((slot) => slot.discarded)).toHaveLength(1)
        // Never the one whose value the roll came to.
        expect(marked[keptIndex(pair, mode)].discarded).toBe(false)
      }
    }
  })
})

describe('historyTitle', () => {
  it('names the die on its own for a plain throw', () => {
    expect(historyTitle(20, 'normal')).toBe('d20')
    expect(historyTitle(8, undefined)).toBe('d8')
  })

  /* An 18 kept from 18 and 4 prints as an 18, so without the mode in the
     tooltip it is indistinguishable from a plain 18 — which is the one thing
     about the entry worth remembering. */
  it('says which rule a pair was thrown under', () => {
    expect(historyTitle(20, 'advantage')).toBe('d20 · advantage')
    expect(historyTitle(20, 'disadvantage')).toBe('d20 · disadvantage')
  })

  it('does not claim a mode for a die that cannot have one', () => {
    expect(historyTitle(100, 'advantage')).toBe('d%')
  })
})

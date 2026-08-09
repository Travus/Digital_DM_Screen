/**
 * `rollExpression` is a parser with a random number generator attached, so the
 * rolling is stubbed and the parsing is what gets asserted: what it accepts,
 * what it refuses, and what the breakdown says it did.
 *
 * Refusing matters as much as accepting. The dice module shows the input as
 * invalid on null, so anything this parses *partially* would be silently rolling
 * something other than what was typed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomOf, rollDie, rollExpression } from './dice'

/**
 * Faces in the given order, cycling, for dice of `sides`.
 *
 * The draw is aimed at the middle of a face's band — `(value - 0.5) / sides`
 * rather than its lower edge — so no rounding error can land the stub one face
 * below what it was asked for.
 */
const faces = (values: number[], sides: number): void => {
  let index = 0
  vi.spyOn(Math, 'random').mockImplementation(() => {
    const value = values[index % values.length]
    index += 1
    return (value - 0.5) / sides
  })
}

/** Every die shows `value`, so a total is arithmetic rather than a guess. */
const everyFace = (value: number, sides: number): void => faces([value], sides)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rolling a die', () => {
  it('lands between 1 and the number of sides', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(rollDie(20)).toBe(1)
    // Math.random() never returns 1, so the top face needs the value just below.
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(rollDie(20)).toBe(20)
  })

  it('picks an item by the same draw', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(randomOf(['a', 'b', 'c', 'd'])).toBe('c')
  })
})

describe('expressions it accepts', () => {
  it('rolls a bare die, defaulting the count to one', () => {
    everyFace(7, 20)
    expect(rollExpression('d20')).toMatchObject({ total: 7, breakdown: '1d20 [7]' })
  })

  it('rolls several dice and adds a flat modifier', () => {
    everyFace(4, 6)
    expect(rollExpression('2d6+3')).toMatchObject({ total: 11, breakdown: '2d6 [4, 4] + 3' })
  })

  it('subtracts a negative term', () => {
    everyFace(5, 8)
    expect(rollExpression('1d8 - 2')).toMatchObject({ total: 3, breakdown: '1d8 [5] - 2' })
  })

  it('handles a leading minus on the first term', () => {
    everyFace(2, 4)
    expect(rollExpression('-1d4')).toMatchObject({ total: -2, breakdown: '-1d4 [2]' })
  })

  it('adds several dice groups together, keeping the input in the result', () => {
    // One draw, two sizes of die: the same fraction is a 5 on a d8 and a 3 on
    // a d4, which is exactly the arithmetic being checked.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const result = rollExpression('1d8 + 2d4 - 1')
    expect(result).toMatchObject({ total: 10, expression: '1d8 + 2d4 - 1' })
    expect(result?.breakdown).toBe('1d8 [5] + 2d4 [3, 3] - 1')
  })

  it('takes a flat number on its own', () => {
    expect(rollExpression('5')).toMatchObject({ total: 5, breakdown: '5' })
  })

  it('ignores case and surrounding space', () => {
    everyFace(6, 6)
    expect(rollExpression('  2D6  ')).toMatchObject({ total: 12, expression: '2D6' })
  })
})

describe('keeping and dropping dice', () => {
  it('keeps the highest, which is what advantage looks like', () => {
    faces([3, 18], 20)
    expect(rollExpression('2d20kh1')).toMatchObject({
      total: 18,
      breakdown: '2d20kh1 [3, 18]'
    })
  })

  it('keeps the lowest for disadvantage', () => {
    faces([3, 18], 20)
    expect(rollExpression('2d20kl1')).toMatchObject({ total: 3 })
  })

  it('drops the lowest, the standard ability-score roll', () => {
    faces([1, 4, 5, 6], 6)
    expect(rollExpression('4d6dl1')).toMatchObject({ total: 15 })
  })

  it('drops the highest', () => {
    faces([1, 4, 5, 6], 6)
    expect(rollExpression('4d6dh1')).toMatchObject({ total: 10 })
  })

  it('defaults the amount to one when the suffix carries no number', () => {
    faces([2, 19], 20)
    expect(rollExpression('2d20kh')).toMatchObject({ total: 19 })
  })

  it('cannot keep more dice than were rolled', () => {
    faces([2, 19], 20)
    expect(rollExpression('2d20kh5')).toMatchObject({ total: 21 })
  })

  it('shows every face rolled, not only the ones kept', () => {
    // The dropped dice are the interesting part of a 4d6dl1 — a breakdown that
    // hid them would be unauditable at the table.
    faces([1, 4, 5, 6], 6)
    expect(rollExpression('4d6dl1')?.breakdown).toBe('4d6dl1 [1, 4, 5, 6]')
  })
})

describe('expressions it refuses', () => {
  it('returns null rather than rolling part of something it did not understand', () => {
    // "2d6 foo 3" parses as two valid terms with rubbish between them. Rolling
    // 2d6+3 there would be answering a question nobody asked.
    for (const input of ['2d6 foo 3', 'd20 and then some', 'hello', '', '   ', '+']) {
      expect([input, rollExpression(input)]).toEqual([input, null])
    }
  })

  it('refuses trailing rubbish after a valid expression', () => {
    everyFace(1, 6)
    expect(rollExpression('2d6 !!')).toBeNull()
  })

  it('refuses a die with no faces, or more dice than anyone means to roll', () => {
    everyFace(1, 6)
    expect(rollExpression('1d0')).toBeNull()
    expect(rollExpression('0d6')).toBeNull()
    expect(rollExpression('1001d6')).toBeNull()
    expect(rollExpression('1d10001')).toBeNull()
    // The limits themselves are allowed.
    expect(rollExpression('1000d6')).not.toBeNull()
    expect(rollExpression('1d10000')).not.toBeNull()
  })
})

describe('the breakdown of a large handful', () => {
  it('summarises past the point where listing faces stops helping', () => {
    everyFace(1, 6)
    const result = rollExpression('40d6')
    expect(result?.total).toBe(40)
    expect(result?.breakdown).toContain('+10 more]')
    // The first faces are still there — it is a summary, not a count.
    expect(result?.breakdown.startsWith('40d6 [1, 1,')).toBe(true)
  })

  it('lists them all at the limit', () => {
    everyFace(1, 6)
    expect(rollExpression('30d6')?.breakdown).not.toContain('more')
  })
})

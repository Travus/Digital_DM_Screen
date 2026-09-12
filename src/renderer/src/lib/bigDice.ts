/**
 * What the Big Dice module throws, and how many solids that puts on screen.
 *
 * Separate from `dieSolid.ts`, which knows about polyhedra and nothing about
 * dice: this is the module's own rules — percentile as a physical pair,
 * advantage as two d20s with one of them discarded — kept out of the component
 * so they can be asserted rather than screenshotted.
 *
 * Not in `lib/dice.ts`. That file is the expression language, shared with the
 * Dice Roller and the palette; none of this is reachable from an expression.
 */

import { rollDie } from './dice'
import { PERCENTILE, SOLIDS, type DieSolid } from './dieSolid'

export const DICE = [4, 6, 8, 10, 12, 20, 100] as const
export type Sides = (typeof DICE)[number]

/**
 * Keep the higher of two d20s, the lower, or throw one die as usual.
 *
 * In the order the chips are drawn, which puts the plain throw between the two
 * that modify it — a row reading advantage, normal, disadvantage is a scale,
 * where one reading normal, advantage, disadvantage is a list with a default
 * bolted to the front.
 */
export const MODES = ['advantage', 'normal', 'disadvantage'] as const
export type Mode = (typeof MODES)[number]

/** A pair in the order it was thrown, which is the order it is shown in. */
export type Pair = readonly [number, number]

export interface Throw {
  /** The result of the roll: the kept d20, or the percentile total. */
  value: number
  /** Both d20s when the mode threw two of them, else null. */
  pair: Pair | null
}

/** One die on screen, with the value it is resting on. */
export interface Slot {
  solid: DieSolid
  /** Null before the first throw, which rests the die on its default face. */
  value: number | null
  /** Thrown, and then thrown away: shown, dimmed and struck through. */
  discarded: boolean
}

export function dieLabel(sides: number): string {
  return sides === 100 ? 'd%' : `d${sides}`
}

/** Advantage and disadvantage are the d20's alone. Nothing else has the rule. */
export function modeApplies(sides: number): boolean {
  return sides === 20
}

/**
 * Whether this die and mode throw two dice rather than one.
 *
 * Asked as "is it one of the two that pair" rather than "is it not normal", so
 * a mode string this version does not know — a `keybindings`-style leftover in
 * a saved panel — throws one die rather than silently gaining a second.
 */
export function throwsAPair(sides: number, mode: Mode): boolean {
  return modeApplies(sides) && (mode === 'advantage' || mode === 'disadvantage')
}

/** Which of a pair the roll keeps. Ties keep the first; both hold the same value. */
export function keptIndex(pair: Pair, mode: Mode): 0 | 1 {
  if (mode === 'disadvantage') return pair[0] <= pair[1] ? 0 : 1
  return pair[0] >= pair[1] ? 0 : 1
}

/**
 * Whether a d20 result is a natural 20 or a natural 1.
 *
 * Off the kept die, always — a 20 that disadvantage threw away is not a
 * critical, and the die on screen with a line through it is where the table
 * sees what the rule cost them.
 */
export function criticalOf(sides: number, value: number | null): 'nat20' | 'nat1' | '' {
  if (sides !== 20 || value === null) return ''
  return value === 20 ? 'nat20' : value === 1 ? 'nat1' : ''
}

/**
 * A pair that came up two natural 20s or two natural 1s — about one throw in
 * four hundred, and the only result in the module worth its own flourish.
 */
export function twinCriticalOf(pair: Pair | null): 'nat20' | 'nat1' | '' {
  if (pair === null || pair[0] !== pair[1]) return ''
  return criticalOf(20, pair[0])
}

/**
 * Rolled as the two dice it physically is, rather than as `rollDie(100)`.
 *
 * That matters for the 0–99 convention, which has no equivalent single roll, and
 * it makes the one interesting result reachable honestly: `00` and `0` comes up
 * when both dice land on zero, once in a hundred throws either way.
 */
export function rollPercentile(zeroIsHundred: boolean): number {
  const tens = rollDie(10) - 1
  const units = rollDie(10) - 1
  const raw = tens * 10 + units
  return raw === 0 && zeroIsHundred ? 100 : raw
}

/** The two face values behind a percentile total: the tens die and the units. */
export function percentileFaces(value: number): [number, number] {
  // 100 and 0 are the same throw — both dice showing zero — so both read 00 and 0.
  const raw = value === 100 ? 0 : value
  return [Math.floor(raw / 10) * 10, raw % 10]
}

/** The two faces as they are printed, which is what the flat renderer draws. */
export function percentileText(value: number): [string, string] {
  const [tens, units] = percentileFaces(value)
  return [String(tens).padStart(2, '0'), String(units)]
}

export function throwDice(sides: Sides, mode: Mode, zeroIsHundred: boolean): Throw {
  if (sides === 100) return { value: rollPercentile(zeroIsHundred), pair: null }
  if (!throwsAPair(sides, mode)) return { value: rollDie(sides), pair: null }

  const pair: Pair = [rollDie(sides), rollDie(sides)]
  return { value: pair[keptIndex(pair, mode)], pair }
}

/**
 * The dice on screen for a result, left to right.
 *
 * One list covers all three shapes the stage can take — a single die, a
 * percentile pair, an advantage pair — so the module renders whatever it is
 * handed rather than branching three ways over the same markup.
 */
export function slots(sides: Sides, mode: Mode, value: number | null, pair: Pair | null): Slot[] {
  if (sides === 100) {
    const faces = value === null ? [null, null] : percentileFaces(value)
    return [
      { solid: PERCENTILE[0], value: faces[0], discarded: false },
      { solid: PERCENTILE[1], value: faces[1], discarded: false }
    ]
  }

  const solid = SOLIDS[sides]
  // A pair is only drawn when there is one to draw. Before the first throw —
  // and for a layout saved in normal mode — the stage is one die, so switching
  // to advantage does not make a second die appear resting on nothing.
  if (!throwsAPair(sides, mode) || pair === null) {
    return [{ solid, value, discarded: false }]
  }

  // Two dice agreeing discard nothing. Which of two 13s was "kept" is a
  // question with no answer, and striking one of them claims a distinction the
  // throw did not make — the pair that matters most, two natural 20s, is
  // exactly the case where crossing one out would be worst.
  const kept = pair[0] === pair[1] ? -1 : keptIndex(pair, mode)
  return [
    { solid, value: pair[0], discarded: kept === 1 },
    { solid, value: pair[1], discarded: kept === 0 }
  ]
}

/**
 * What a past throw was, for the history strip's tooltip.
 *
 * The mode has to be in there. A pair is one entry showing the kept number, so
 * without it an 18 taken from `18, 4` is indistinguishable from a flat 18 —
 * and which of the two it was is the thing worth remembering.
 */
export function historyTitle(sides: number, mode: Mode | undefined): string {
  const name = dieLabel(sides)
  return mode !== undefined && throwsAPair(sides, mode) ? `${name} · ${mode}` : name
}

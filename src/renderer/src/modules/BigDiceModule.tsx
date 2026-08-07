import { useEffect, useRef, useState } from 'react'
import { uid } from '../../../shared/layout'
import { rollDie } from '../lib/dice'
import { defineModule, type ModuleProps } from './types'

/**
 * One big die, thrown by clicking it.
 *
 * Deliberately not a second Dice Roller: that module is for expressions and a
 * running log, read by the DM. This one is for the table to look at — a single
 * die, large enough to read from across the room, for the rolls everyone wants
 * to see land.
 */

const DICE = [4, 6, 8, 10, 12, 20, 100] as const
type Sides = (typeof DICE)[number]

/** How long the tumble runs, and how often the face changes while it does. */
const TUMBLE_MS = 700
const TICK_MS = 70

interface HistoryEntry {
  id: string
  sides: number
  value: number
}

interface State {
  sides: Sides
  /** Last settled result, or null before the first throw. */
  value: number | null
  history: HistoryEntry[]
}

interface Settings {
  showHistory: boolean
  historyLimit: number
  /** Mark a natural 20 and a natural 1 on the d20. */
  critFlourish: boolean
  animate: boolean
  /**
   * Whether a percentile throw of `00` and `0` is 100 or 0 — which is to say,
   * whether the die reads 1–100 or 0–99. Tables disagree, and the faces are
   * identical either way, so only the total changes.
   */
  zeroIsHundred: boolean
}

function label(sides: number): string {
  return sides === 100 ? 'd%' : `d${sides}`
}

/**
 * Rolled as the two dice it physically is, rather than as `rollDie(100)`.
 *
 * That matters for the 0–99 convention, which has no equivalent single roll, and
 * it makes the one interesting result reachable honestly: `00` and `0` comes up
 * when both dice land on zero, once in a hundred throws either way.
 */
function rollPercentile(zeroIsHundred: boolean): number {
  const tens = rollDie(10) - 1
  const units = rollDie(10) - 1
  const raw = tens * 10 + units
  return raw === 0 && zeroIsHundred ? 100 : raw
}

/**
 * The two faces for a percentile total. 100 and 0 are the same throw — both
 * dice showing zero — so both render as `00` and `0`.
 */
function percentileFaces(value: number): [string, string] {
  const raw = value === 100 ? 0 : value
  return [String(Math.floor(raw / 10) * 10).padStart(2, '0'), String(raw % 10)]
}

function BigDice({
  state,
  setState,
  settings,
  maximized
}: ModuleProps<State, Settings>): JSX.Element {
  /**
   * The tumbling face is local, never persisted. Every `setState` here rides
   * into the document, sets `dirty` and schedules a session write — ten of them
   * a second would thrash the autosave and leave the layout permanently unsaved
   * over an animation nobody wants to keep. Only the settled result is stored.
   */
  const [tumbling, setTumbling] = useState(false)
  const [face, setFace] = useState<number | null>(null)
  const timers = useRef<number[]>([])

  const clearTimers = (): void => {
    for (const timer of timers.current) window.clearInterval(timer)
    timers.current = []
  }

  useEffect(() => clearTimers, [])

  /* A die left mid-tumble by a module switch or a reload would spin forever. */
  useEffect(() => {
    clearTimers()
    setTumbling(false)
    setFace(null)
  }, [state.sides])

  const throwDie = (): number =>
    state.sides === 100 ? rollPercentile(settings.zeroIsHundred) : rollDie(state.sides)

  const roll = (): void => {
    if (tumbling) return
    const result = throwDie()

    const settle = (): void => {
      clearTimers()
      setTumbling(false)
      setFace(null)
      setState((prev) => ({
        value: result,
        history: [{ id: uid('throw'), sides: state.sides, value: result }, ...prev.history].slice(
          0,
          settings.historyLimit
        )
      }))
    }

    // Someone who has asked the OS for less motion gets the result outright.
    const still = !settings.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) {
      settle()
      return
    }

    setTumbling(true)
    timers.current.push(window.setInterval(() => setFace(throwDie()), TICK_MS))
    timers.current.push(window.setInterval(settle, TUMBLE_MS))
  }

  const shown = face ?? state.value
  const critical =
    settings.critFlourish && !tumbling && state.sides === 20 && state.value !== null
      ? state.value === 20
        ? 'nat20'
        : state.value === 1
          ? 'nat1'
          : ''
      : ''

  return (
    <div className={`bigdice ${maximized ? 'roomy' : ''}`}>
      <div className="chip-row">
        {DICE.map((sides) => (
          <button
            key={sides}
            className={`chip action ${state.sides === sides ? 'on' : ''}`}
            /* Switching dice clears the result rather than leaving a 17 sitting
               on a d6, which reads as a bug even though it was a real throw. */
            onClick={() => setState({ sides, value: null })}
          >
            {label(sides)}
          </button>
        ))}
      </div>

      <button
        className={`bigdice-stage ${tumbling ? 'tumbling' : ''} ${critical}`}
        onClick={roll}
        title={`Throw ${label(state.sides)}`}
      >
        {state.sides === 100 ? (
          <span className="bigdice-pair">
            <Die sides={10} face={shown === null ? '' : percentileFaces(shown)[0]} />
            <Die sides={10} face={shown === null ? '' : percentileFaces(shown)[1]} />
          </span>
        ) : (
          <Die sides={state.sides} face={shown === null ? '' : String(shown)} />
        )}
      </button>

      <div className="bigdice-readout">
        {state.value === null ? (
          <span className="bigdice-prompt">Click the die to throw it</span>
        ) : (
          <>
            <span className={`bigdice-total ${critical}`}>{state.value}</span>
            {critical === 'nat20' && <span className="bigdice-flourish">critical!</span>}
            {critical === 'nat1' && <span className="bigdice-flourish grim">fumble</span>}
          </>
        )}
      </div>

      {settings.showHistory && state.history.length > 0 && (
        <div className="bigdice-history">
          {state.history.map((entry) => (
            <span key={entry.id} className="bigdice-past" title={label(entry.sides)}>
              {entry.value}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The die itself, drawn as the face you would be looking down at.
 *
 * Inline SVG rather than a glyph, matching the brand mark: no icon font to go
 * missing, and the shapes have to be distinguishable at a glance from across a
 * table. A d4, d8 and d20 are all triangles in real life, so each carries its
 * true silhouette — the d20's hexagonal outline with the top face picked out in
 * the middle is what tells it apart from the d4's plain triangle.
 */
function Die({ sides, face }: { sides: number; face: string }): JSX.Element {
  const shapes: Record<number, JSX.Element> = {
    4: <polygon points="50,10 93,84 7,84" />,
    6: <rect x="12" y="12" width="76" height="76" rx="11" />,
    8: (
      <>
        <polygon points="50,5 92,50 50,95 8,50" />
        <polyline points="8,50 50,32 92,50" className="facet" />
      </>
    ),
    10: (
      <>
        <polygon points="50,4 89,40 50,96 11,40" />
        <polyline points="11,40 50,26 89,40" className="facet" />
      </>
    ),
    12: (
      <>
        <polygon points="50,5 93,37 77,90 23,90 7,37" />
        {/* Sized to clear "12" at the full face size — a tighter pentagon clipped it. */}
        <polygon points="50,14 81,38 69,74 31,74 19,38" className="facet" />
      </>
    ),
    20: (
      <>
        <polygon points="50,4 89,27 89,73 50,96 11,73 11,27" />
        {/* Wide enough that a two-digit number keeps clear of the sloping sides,
            which is what sets the width: "20" is widest where the face is
            narrowest, near the top of the glyphs. */}
        <polygon points="50,18 84,74 16,74" className="facet" />
      </>
    )
  }

  /*
    A triangle's centroid sits a third of the way up from its base, so a number
    placed at the box's midpoint reads low. These follow the face each number
    actually sits in, not the viewBox.
  */
  const textY = sides === 4 ? 60 : sides === 20 ? 57 : sides === 10 ? 56 : 50

  return (
    <svg className={`die d${sides}`} viewBox="0 0 100 100" aria-hidden="true">
      {shapes[sides]}
      <text x="50" y={textY} className="die-face">
        {face}
      </text>
    </svg>
  )
}

function BigDiceSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  return (
    <div className="stack tight">
      <label className="check">
        <input
          type="checkbox"
          checked={settings.animate}
          onChange={(event) => setSettings({ animate: event.target.checked })}
        />
        Tumble the die before it settles
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.critFlourish}
          onChange={(event) => setSettings({ critFlourish: event.target.checked })}
        />
        Call out a natural 20 or natural 1 on the d20
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.zeroIsHundred}
          onChange={(event) => setSettings({ zeroIsHundred: event.target.checked })}
        />
        On d%, read 00 and 0 as 100 rather than 0
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.showHistory}
          onChange={(event) => setSettings({ showHistory: event.target.checked })}
        />
        Show recent throws
      </label>
      <label className="field">
        <span>Throws remembered — {settings.historyLimit}</span>
        <input
          type="range"
          min={5}
          max={40}
          step={5}
          value={settings.historyLimit}
          disabled={!settings.showHistory}
          onChange={(event) => setSettings({ historyLimit: Number(event.target.value) })}
        />
      </label>
      <p className="note">
        One die, thrown by clicking it — meant to be turned towards the table for the rolls everyone
        wants to watch. The Dice Roller module is the one for expressions like <code>4d6kh3</code>.
      </p>
    </div>
  )
}

export const bigDiceModule = defineModule<State, Settings>({
  id: 'bigdice',
  name: 'Big Dice',
  icon: '🎯',
  blurb: 'One oversized die, thrown by clicking it — for rolls the table watches.',
  category: 'Tools',
  defaultState: () => ({ sides: 20, value: null, history: [] }),
  defaultSettings: () => ({
    showHistory: true,
    historyLimit: 10,
    critFlourish: true,
    animate: true,
    zeroIsHundred: true
  }),
  Component: BigDice,
  Settings: BigDiceSettings
})

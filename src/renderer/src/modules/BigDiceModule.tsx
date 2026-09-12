import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { uid } from '../../../shared/layout'
import {
  criticalOf,
  DICE,
  dieLabel,
  historyTitle,
  keptIndex,
  modeApplies,
  MODES,
  percentileText,
  slots,
  throwDice,
  throwsAPair,
  twinCriticalOf,
  type Mode,
  type Pair,
  type Sides
} from '../lib/bigDice'
import {
  faceLighting,
  randomSpin,
  restRotation,
  THROW_MS,
  throwLift,
  throwRotation,
  toMatrix3d,
  toRotate3d,
  type DieSolid,
  type Mat3
} from '../lib/dieSolid'
import { defineModule, type ModuleProps } from './types'

/**
 * One big die, thrown by clicking it.
 *
 * Deliberately not a second Dice Roller: that module is for expressions and a
 * running log, read by the DM. This one is for the table to look at — a single
 * die, large enough to read from across the room, for the rolls everyone wants
 * to see land.
 *
 * Every die is a real solid, built in `lib/dieSolid.ts`. The flat top-down face
 * further down is what the module started as and what it falls back to when a DM
 * turns the solids off.
 */

/** How long the flat die's tumble runs, and how often the face changes while it does. */
const TUMBLE_MS = 700
const TICK_MS = 70

interface HistoryEntry {
  id: string
  sides: number
  value: number
  /** Both d20s, when the throw was made with advantage or disadvantage. */
  pair?: Pair
  mode?: Mode
}

interface State {
  sides: Sides
  /** A current choice like `sides`, so a restored panel comes back in it. */
  mode: Mode
  /** Last settled result, or null before the first throw. */
  value: number | null
  /** Both d20s of the last throw, when one of them was discarded. */
  pair: Pair | null
  history: HistoryEntry[]
}

interface Settings {
  showHistory: boolean
  historyLimit: number
  /** Mark a natural 20 and a natural 1 on the d20. */
  critFlourish: boolean
  animate: boolean
  /** Throw the dice as solids rather than as flat top-down faces. */
  solid: boolean
  /**
   * Whether a percentile throw of `00` and `0` is 100 or 0 — which is to say,
   * whether the die reads 1–100 or 0–99. Tables disagree, and the faces are
   * identical either way, so only the total changes.
   */
  zeroIsHundred: boolean
}

const MODE_LABEL: Record<Mode, string> = {
  advantage: 'Advantage',
  normal: 'Normal',
  disadvantage: 'Disadvantage'
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
   * over an animation nobody wants to keep. The solids are stricter still: a
   * throw runs a frame at a time and writes straight to the DOM, so nothing
   * reaches the store until the dice have landed.
   */
  const [tumbling, setTumbling] = useState(false)
  /**
   * The flat renderer's tumbling faces. Always a pair, even for the dice that
   * only ever show the first of them: an advantage tumble needs two numbers
   * changing independently, and a second piece of state for the second die is
   * two things that would have to stay in step.
   */
  const [faces, setFaces] = useState<Pair | null>(null)
  /**
   * The pair currently in the air, so the stage carries the right number of
   * dice from the moment of the throw. Without it the first advantage roll
   * tumbles one die and grows a second at the landing, which reads as the
   * second die having appeared out of nothing.
   */
  const [flying, setFlying] = useState<Pair | null>(null)
  /** Whether the result on screen was thrown here, rather than restored with the layout. */
  const [thrown, setThrown] = useState(false)
  const timers = useRef<number[]>([])
  const frame = useRef(0)
  const dice = useRef<(SolidHandle | null)[]>([])

  const showMode = modeApplies(state.sides)
  const pair = flying ?? state.pair
  const resting = slots(state.sides, state.mode, state.value, pair)

  const clearTimers = useCallback((): void => {
    for (const timer of timers.current) window.clearInterval(timer)
    timers.current = []
    if (frame.current) window.cancelAnimationFrame(frame.current)
    frame.current = 0
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  /* A die left mid-tumble by a module switch or a reload would spin forever. */
  useEffect(() => {
    clearTimers()
    setTumbling(false)
    setFaces(null)
  }, [state.sides, clearTimers])

  /*
    Where the dice sit when nothing is moving. Derived from the settled values
    rather than left wherever the last throw put them, so a panel restored with
    a 20 in it comes back showing that 20.
  */
  useLayoutEffect(() => {
    if (!settings.solid || tumbling) return
    for (const [index, slot] of resting.entries()) {
      dice.current[index]?.paint(restRotation(slot.solid, slot.value ?? slot.solid.restingValue), 0)
    }
  })

  const settle = (result: number, landed: Pair | null): void => {
    clearTimers()
    setTumbling(false)
    setFaces(null)
    setFlying(null)
    setThrown(true)
    setState((prev) => ({
      value: result,
      pair: landed,
      history: [
        {
          id: uid('throw'),
          sides: state.sides,
          value: result,
          ...(landed ? { pair: landed, mode: state.mode } : {})
        },
        ...prev.history
      ].slice(0, settings.historyLimit)
    }))
  }

  const roll = (): void => {
    if (tumbling) return
    const result = throwDice(state.sides, state.mode, settings.zeroIsHundred)

    // Someone who has asked the OS for less motion gets the result outright.
    const still = !settings.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) {
      settle(result.value, result.pair)
      return
    }

    setTumbling(true)
    setFlying(result.pair)

    if (settings.solid) {
      /*
        One clock and one frame loop for however many dice are on the stage, so
        a pair lands together. Each die gets its own spin — two solids turning
        in step read as one rigid object rather than two dice.
      */
      const landing = slots(state.sides, state.mode, result.value, result.pair).map((slot) => ({
        rest: restRotation(slot.solid, slot.value ?? slot.solid.restingValue),
        spin: randomSpin()
      }))
      const start = performance.now()
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / THROW_MS)
        const lift = throwLift(t)
        for (const [index, { rest, spin }] of landing.entries()) {
          dice.current[index]?.paint(throwRotation(rest, spin, t), lift)
        }
        if (t < 1) {
          frame.current = window.requestAnimationFrame(step)
          return
        }
        settle(result.value, result.pair)
      }
      frame.current = window.requestAnimationFrame(step)
      return
    }

    // Two independent values every tick, so an advantage pair tumbles as two
    // dice. Single dice read the first and ignore the second.
    const tick = (): number => throwDice(state.sides, 'normal', settings.zeroIsHundred).value
    timers.current.push(window.setInterval(() => setFaces([tick(), tick()]), TICK_MS))
    timers.current.push(window.setInterval(() => settle(result.value, result.pair), TUMBLE_MS))
  }

  /**
   * The flat renderer's dice, left to right — the same three shapes `slots()`
   * gives the solids, in the terms this one draws in. Built here rather than in
   * the JSX because the pair branch has to hold during the tumble as well as
   * after it, and a ternary that says so three times is a ternary nobody reads.
   */
  const flat = ((): { face: string; discarded: boolean }[] => {
    const shown = faces?.[0] ?? state.value
    if (state.sides === 100) {
      const [tens, units] = shown === null ? ['', ''] : percentileText(shown)
      return [
        { face: tens, discarded: false },
        { face: units, discarded: false }
      ]
    }
    const showing = tumbling ? faces : pair
    if (!throwsAPair(state.sides, state.mode) || showing === null) {
      return [{ face: shown === null ? '' : String(shown), discarded: false }]
    }
    // Nothing is discarded until the dice have stopped: a strike through a
    // number still changing claims a result that has not happened. Two equal
    // dice discard nothing either, for the reason `slots()` gives.
    const kept = tumbling || showing[0] === showing[1] ? -1 : keptIndex(showing, state.mode)
    return showing.map((value, index) => ({
      face: String(value),
      discarded: kept >= 0 && kept !== index
    }))
  })()

  /*
    Nothing is decided until the dice stop, so no flourish is drawn while they
    are in the air — including the *previous* throw's, which would otherwise sit
    there through the tumble and read as a verdict on a roll still happening.
  */
  const critical = settings.critFlourish && !tumbling ? criticalOf(state.sides, state.value) : ''
  const twin = critical !== '' ? twinCriticalOf(pair) : ''
  /* One die is out of the roll and the other is a critical: the loser goes
     entirely and the winner takes the middle. Not when both are the critical —
     that is the twin case, and neither of them lost. */
  const solo = critical !== '' && twin === '' && resting.length > 1

  const stageClasses = [
    'bigdice-stage',
    settings.solid && 'solid',
    tumbling && 'tumbling',
    /* Two dice share the room one had, so the stage has to know. Both renderers
       answer it, because both can end up showing a pair. */
    (settings.solid ? resting.length : flat.length) > 1 && 'paired',
    critical,
    solo && 'solo',
    twin !== '' && 'twin'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`bigdice ${maximized ? 'roomy' : ''}`}>
      <div className="chip-row">
        {DICE.map((sides) => (
          <button
            key={sides}
            className={`chip action ${state.sides === sides ? 'on' : ''}`}
            /* Switching dice clears the result rather than leaving a 17 sitting
               on a d6, which reads as a bug even though it was a real throw. */
            onClick={() => setState({ sides, value: null, pair: null })}
          >
            {dieLabel(sides)}
          </button>
        ))}
      </div>

      {/*
        A control on the die rather than a setting in the drawer. Advantage is a
        per-roll decision made several times a fight — a checkbox two clicks
        away behind the ⋯ menu is the wrong place for something changed that
        often, and the chips also say which mode the panel is in without being
        opened. Hidden off the d20 because no other die has the rule.

        `MODES` is in drawing order, so the plain throw sits between the two
        that modify it and the row reads as a scale rather than as a default
        with two options bolted on.
      */}
      {showMode && (
        <div className="chip-row bigdice-modes">
          {MODES.map((mode) => (
            <button
              key={mode}
              className={`chip action ${state.mode === mode ? 'on' : ''}`}
              data-mode={mode}
              /* The pair goes with the mode: a disadvantage pair left on screen
                 after switching to normal is two dice the next throw cannot
                 explain. */
              onClick={() => setState({ mode, pair: null })}
            >
              {MODE_LABEL[mode]}
            </button>
          ))}
        </div>
      )}

      <button className={stageClasses} onClick={roll} title={`Throw ${dieLabel(state.sides)}`}>
        {/*
          The flourish leaves the DOM rather than fading, for the same reason
          the fullscreen hint does: the stage is the button that throws the die,
          and an invisible layer over it still takes the click.
        */}
        {critical !== '' && (
          <>
            <span className={`bigdice-wash ${thrown ? 'sweep' : ''}`} aria-hidden="true" />
            <span className={`bigdice-beams ${thrown ? 'sweep' : ''}`} aria-hidden="true" />
            {/* Two rings out of the middle, on a throw that happened here. The
                twin is rare enough to be worth an effect nothing else uses. */}
            {twin !== '' && thrown && <span className="bigdice-shock" aria-hidden="true" />}
          </>
        )}

        {settings.solid ? (
          resting.map((slot, index) => (
            <SolidDie
              key={`${slot.solid.kind}-${index}`}
              solid={slot.solid}
              discarded={slot.discarded && !tumbling}
              /* Which way in is which way out. The stylesheet moves a die
                 towards the middle and cannot tell from the DOM which side it
                 started on — the wash and the beams are siblings, so
                 `:first-child` counts them. */
              side={resting.length > 1 ? (index === 0 ? 'left' : 'right') : 'only'}
              ref={(handle) => {
                dice.current[index] = handle
              }}
            />
          ))
        ) : flat.length > 1 ? (
          <span className="bigdice-pair">
            {flat.map((die, index) => (
              <Die
                key={index}
                sides={state.sides === 100 ? 10 : state.sides}
                face={die.face}
                discarded={die.discarded}
              />
            ))}
          </span>
        ) : (
          <Die sides={state.sides} face={flat[0].face} discarded={flat[0].discarded} />
        )}
      </button>

      {/*
        A critical says what it is and drops the number. The die is showing the
        20, so printing it again beside the word only makes the readout longer
        and the call-out quieter — and "Critical Success" is the thing the table
        needs to read from across the room.

        It reads the *kept* die, because that is the roll. A 20 on a die
        disadvantage threw away is not a critical, and the strike through it on
        the stage is where the table sees what the rule cost them.
      */}
      <div className="bigdice-readout">
        {tumbling ? (
          /* Not the previous throw's number, which is what used to sit here
             through a tumble — a stale answer under dice still deciding is the
             one thing on this panel that could be misread as the result. */
          <span className="bigdice-rolling" aria-label="Rolling">
            <i />
            <i />
            <i />
          </span>
        ) : state.value === null ? (
          <span className="bigdice-prompt">Click the die to throw it</span>
        ) : twin === 'nat20' ? (
          <span className="bigdice-flourish twin">Double Critical</span>
        ) : twin === 'nat1' ? (
          <span className="bigdice-flourish twin grim">Double Disaster</span>
        ) : critical === 'nat20' ? (
          <span className="bigdice-flourish">Critical Success</span>
        ) : critical === 'nat1' ? (
          <span className="bigdice-flourish grim">Critical Failure</span>
        ) : (
          <span className="bigdice-total">{state.value}</span>
        )}
      </div>

      {settings.showHistory && state.history.length > 0 && (
        <div className="bigdice-history">
          {state.history.map((entry) => (
            <span
              key={entry.id}
              className="bigdice-past"
              title={historyTitle(entry.sides, entry.mode)}
            >
              {entry.value}
              {/* The discarded number, so a pair stays one entry that can still
                  be read as a pair. A tie discarded nothing, so it prints the
                  one number the throw actually came to. */}
              {entry.pair && entry.mode && entry.pair[0] !== entry.pair[1] && (
                <span className="bigdice-dropped">
                  {entry.pair[keptIndex(entry.pair, entry.mode) === 0 ? 1 : 0]}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** What the throw loop drives a die with: one frame, written straight to the DOM. */
interface SolidHandle {
  paint: (rotation: Mat3, lift: number) => void
}

/**
 * One solid, as the faces it is made of.
 *
 * Imperative on purpose. A throw writes a transform and twenty filters per
 * frame; doing that through state would re-render the module sixty times a
 * second and put every one of those frames through the store. The parent owns
 * the clock so a pair lands together, and reaches each die through this.
 */
const SolidDie = forwardRef<
  SolidHandle,
  { solid: DieSolid; discarded: boolean; side: 'left' | 'right' | 'only' }
>(function SolidDie({ solid, discarded, side }, ref): JSX.Element {
  const hopRef = useRef<HTMLSpanElement>(null)
  const solidRef = useRef<HTMLSpanElement>(null)
  const faceRefs = useRef<(SVGSVGElement | null)[]>([])

  useImperativeHandle(ref, () => ({
    paint: (rotation, lift) => {
      if (!solidRef.current) return
      solidRef.current.style.transform = toMatrix3d(rotation)
      hopRef.current?.style.setProperty('--lift', lift.toFixed(4))
      faceLighting(solid, rotation).forEach((shade, index) => {
        const element = faceRefs.current[index]
        if (!element) return
        element.style.visibility = shade.visible ? 'visible' : 'hidden'
        element.style.filter = `brightness(${shade.brightness.toFixed(3)})`
        // A property on the face rather than a style on the text: one write per
        // face per frame either way, and the stylesheet keeps the rule.
        element.style.setProperty('--legible', shade.legible.toFixed(3))
      })
    }
  }))

  return (
    <span
      className={`bigdice-scene ${solid.kind} ${discarded ? 'discarded' : ''}`}
      data-side={side}
      style={
        {
          '--span': solid.span,
          '--swing': solid.swing,
          '--face-box': solid.faceBox,
          '--inradius': solid.inradius
        } as CSSProperties
      }
    >
      <span className="bigdice-hop" ref={hopRef}>
        <span className="bigdice-solid" ref={solidRef}>
          {solid.faces.map((face, index) => (
            <svg
              key={face.value}
              className="bigdice-face"
              viewBox="0 0 100 100"
              aria-hidden="true"
              ref={(element) => {
                faceRefs.current[index] = element
              }}
              style={{
                transform: `${toRotate3d(face)} translateZ(calc(var(--unit) * var(--inradius)))`
              }}
            >
              <polygon points={face.points} />
              {face.labels.map((printed, at) => (
                <text
                  key={at}
                  x={printed.x.toFixed(2)}
                  y={printed.y.toFixed(2)}
                  transform={
                    printed.angle === 0
                      ? undefined
                      : `rotate(${printed.angle} ${printed.x.toFixed(2)} ${printed.y.toFixed(2)})`
                  }
                >
                  {printed.text}
                </text>
              ))}
            </svg>
          ))}
        </span>
      </span>
    </span>
  )
})

/**
 * The die itself, drawn as the face you would be looking down at.
 *
 * Inline SVG rather than a glyph, matching the brand mark: no icon font to go
 * missing, and the shapes have to be distinguishable at a glance from across a
 * table. A d4, d8 and d20 are all triangles in real life, so each carries its
 * true silhouette — the d20's hexagonal outline with the top face picked out in
 * the middle is what tells it apart from the d4's plain triangle.
 */
function Die({
  sides,
  face,
  discarded = false
}: {
  sides: number
  face: string
  discarded?: boolean
}): JSX.Element {
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
    <svg
      className={`die d${sides} ${discarded ? 'discarded' : ''}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
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
          checked={settings.solid}
          onChange={(event) => setSettings({ solid: event.target.checked })}
        />
        Throw solid dice rather than flat faces
      </label>
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
        wants to watch. Advantage and disadvantage are on the die itself, under the d20. The Dice
        Roller module is the one for expressions like <code>4d6kh3</code>.
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
  defaultState: () => ({ sides: 20, mode: 'normal', value: null, pair: null, history: [] }),
  defaultSettings: () => ({
    showHistory: true,
    historyLimit: 10,
    critFlourish: true,
    animate: true,
    solid: true,
    zeroIsHundred: true
  }),
  Component: BigDice,
  Settings: BigDiceSettings
})

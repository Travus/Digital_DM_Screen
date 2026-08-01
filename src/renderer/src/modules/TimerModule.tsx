import { useEffect, useState } from 'react'
import { uid } from '../../../shared/layout'
import { defineModule, type ModuleProps } from './types'

type TimerMode = 'up' | 'down'

interface Timer {
  id: string
  label: string
  mode: TimerMode
  /** Target for a countdown, in milliseconds. Ignored when counting up. */
  durationMs: number
  /** Time banked from previous runs. */
  accumulatedMs: number
  /** Epoch ms the current run started, or null when paused. */
  startedAt: number | null
}

interface State {
  timers: Timer[]
}

interface Settings {
  columns: number
  showHours: boolean
}

/**
 * Elapsed time is derived from `startedAt` rather than counted into state, so a
 * running timer writes to the layout only when you start, pause or reset it —
 * not sixty times a minute.
 */
function elapsedOf(timer: Timer, now: number): number {
  return timer.accumulatedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt))
}

function remainingOf(timer: Timer, now: number): number {
  return Math.max(0, timer.durationMs - elapsedOf(timer, now))
}

function formatClock(ms: number, showHours: boolean): string {
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return showHours || hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}

/**
 * Reads back what `formatClock` writes, and is forgiving about it: "90" is
 * ninety seconds, "1:30" is a minute and a half, "1:00:00" is an hour.
 * Returns null for anything it can't make sense of, so a bad edit is discarded
 * rather than silently zeroing the clock.
 */
function parseClock(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const parts = trimmed.split(':')
  if (parts.length > 3 || parts.some((part) => part !== '' && !/^\d+$/.test(part))) return null

  const numbers = parts.map((part) => (part === '' ? 0 : Number(part)))
  const [hours, minutes, seconds] =
    numbers.length === 3
      ? numbers
      : numbers.length === 2
        ? [0, numbers[0], numbers[1]]
        : [0, 0, numbers[0]]

  const total = hours * 3600 + minutes * 60 + seconds
  if (!Number.isFinite(total) || total < 0 || total > 99 * 3600) return null
  return total * 1000
}

/**
 * The readout itself, editable in place while the timer is stopped. Keeps a
 * draft string so half-typed values like "1:" don't get reformatted mid-edit.
 */
function ClockInput({
  valueMs,
  showHours,
  onCommit,
  tone
}: {
  valueMs: number
  showHours: boolean
  onCommit: (ms: number) => void
  tone: string
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? formatClock(valueMs, showHours)

  const commit = (): void => {
    if (draft !== null) {
      const parsed = parseClock(draft)
      if (parsed !== null) onCommit(parsed)
    }
    setDraft(null)
  }

  return (
    <input
      className={`timer-readout editable ${tone}`}
      title="Click to set the clock"
      // Sized to the digits so the focus ring hugs them rather than the card.
      size={Math.max(5, text.length)}
      value={text}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value.replace(/[^\d:]/g, ''))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function Timers({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const anyRunning = state.timers.some((timer) => timer.startedAt !== null)

  // Local ticking only — this re-renders the panel without touching the document.
  useEffect(() => {
    if (!anyRunning) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [anyRunning])

  const setTimers = (updater: (timers: Timer[]) => Timer[]): void =>
    setState((prev) => ({ timers: updater(prev.timers) }))

  const patch = (id: string, changes: Partial<Timer>): void =>
    setTimers((timers) => timers.map((timer) => (timer.id === id ? { ...timer, ...changes } : timer)))

  const toggle = (timer: Timer): void => {
    if (timer.startedAt === null) {
      patch(timer.id, { startedAt: Date.now() })
    } else {
      // Bank the elapsed run so the next start picks up where this left off.
      patch(timer.id, { accumulatedMs: elapsedOf(timer, Date.now()), startedAt: null })
    }
  }

  const reset = (timer: Timer): void => patch(timer.id, { accumulatedMs: 0, startedAt: null })

  const add = (mode: TimerMode): void =>
    setTimers((timers) => [
      ...timers,
      {
        id: uid('tm'),
        label: mode === 'down' ? 'Countdown' : 'Elapsed',
        mode,
        durationMs: mode === 'down' ? 5 * 60_000 : 0,
        accumulatedMs: 0,
        startedAt: null
      }
    ])

  return (
    <div className="stack">
      <div className="toolbar">
        <button className="btn" onClick={() => add('up')}>
          + Count up
        </button>
        <button className="btn" onClick={() => add('down')}>
          + Count down
        </button>
      </div>

      <div
        className="tracker-grid"
        style={{ gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))` }}
      >
        {state.timers.map((timer) => {
          const running = timer.startedAt !== null
          const value = timer.mode === 'down' ? remainingOf(timer, now) : elapsedOf(timer, now)
          const finished = timer.mode === 'down' && value === 0 && timer.durationMs > 0

          return (
            <div key={timer.id} className={`timer ${finished ? 'finished' : ''}`}>
              {/* The name is always editable — renaming a timer mid-session
                  shouldn't mean stopping it. */}
              <div className="tracker-head">
                <input
                  className="cell-input strong grow"
                  value={timer.label}
                  placeholder="Name"
                  onChange={(event) => patch(timer.id, { label: event.target.value })}
                />
                <button className="icon-btn" title="Reset to zero" onClick={() => reset(timer)}>
                  ↺
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete timer"
                  onClick={() => setTimers((timers) => timers.filter((entry) => entry.id !== timer.id))}
                >
                  ✕
                </button>
              </div>

              {running ? (
                <div className="timer-readout running">{formatClock(value, settings.showHours)}</div>
              ) : (
                <ClockInput
                  valueMs={value}
                  showHours={settings.showHours}
                  tone={finished ? 'done' : ''}
                  onCommit={(ms) =>
                    // Whichever way it counts, the clock now reads what you typed:
                    // a countdown gets a fresh target, a count-up a head start.
                    patch(
                      timer.id,
                      timer.mode === 'down'
                        ? { durationMs: ms, accumulatedMs: 0, startedAt: null }
                        : { accumulatedMs: ms, startedAt: null }
                    )
                  }
                />
              )}

              {timer.mode === 'down' && timer.durationMs > 0 && (
                <div className="meter-bar">
                  <div
                    className={`meter-fill ${finished ? 'low' : 'ok'}`}
                    style={{ width: `${(value / timer.durationMs) * 100}%` }}
                  />
                </div>
              )}

              <div className="toolbar">
                <button
                  className={`btn ${running ? '' : 'primary'}`}
                  onClick={() => toggle(timer)}
                  disabled={finished && !running}
                >
                  {running ? 'Pause' : 'Start'}
                </button>

                {running ? (
                  <span className="note">Pause to set the clock.</span>
                ) : (
                  <span className="note">{timer.mode === 'down' ? 'Counts down' : 'Counts up'}</span>
                )}

                {finished && <span className="note warn">Time.</span>}
              </div>
            </div>
          )
        })}
      </div>

      {state.timers.length === 0 && (
        <p className="empty">
          Count up to time the session or a player’s turn, or count down for a held breath, a burning
          fuse, or a five-minute break.
        </p>
      )}
    </div>
  )
}

function TimerSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  return (
    <div className="stack tight">
      <label className="field">
        <span>Columns — {settings.columns}</span>
        <input
          type="range"
          min={1}
          max={4}
          value={settings.columns}
          onChange={(event) => setSettings({ columns: Number(event.target.value) })}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.showHours}
          onChange={(event) => setSettings({ showHours: event.target.checked })}
        />
        Always show hours
      </label>
      <p className="note">
        Running timers keep counting in real time, so one left running across a save and reload will
        have advanced by however long the app was closed.
      </p>
    </div>
  )
}

export const timerModule = defineModule<State, Settings>({
  id: 'timers',
  name: 'Timers',
  icon: '⏱️',
  blurb: 'Count-up and count-down timers for turns, breaks and burning fuses.',
  category: 'Tools',
  defaultState: () => ({
    timers: [
      {
        id: 'tm_session',
        label: 'Session',
        mode: 'up',
        durationMs: 0,
        accumulatedMs: 0,
        startedAt: null
      }
    ]
  }),
  defaultSettings: () => ({ columns: 2, showHours: false }),
  Component: Timers,
  Settings: TimerSettings
})

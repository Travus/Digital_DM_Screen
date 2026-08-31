import { describe, expect, it } from 'vitest'
import { pauseRunningTimers } from './timers'
import type { LayoutDoc, PanelData } from '../shared/types'

const START = 1_000_000
const ALIVE_UNTIL = START + 30_000

function docWith(panels: Record<string, PanelData>): LayoutDoc {
  return {
    formatVersion: 2,
    name: 'Test layout',
    locked: false,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    windows: [
      {
        id: 'win_main',
        name: 'Main window',
        open: true,
        root: { type: 'panel', id: 'n1', panelId: 'p1' }
      }
    ],
    panels
  }
}

function timerPanel(timers: unknown[]): PanelData {
  return { moduleId: 'timers', settings: {}, state: { timers } }
}

/** What the module stores for a clock that is mid-run. */
function running(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tm_a',
    label: 'Session',
    mode: 'up',
    durationMs: 0,
    accumulatedMs: 0,
    startedAt: START,
    ...overrides
  }
}

function timersIn(doc: LayoutDoc, panelId = 'p1'): Record<string, unknown>[] {
  return doc.panels[panelId].state['timers'] as Record<string, unknown>[]
}

describe('pauseRunningTimers', () => {
  it('banks a running timer up to the stamp and stops it', () => {
    const next = pauseRunningTimers(docWith({ p1: timerPanel([running()]) }), ALIVE_UNTIL)
    expect(timersIn(next)[0]).toMatchObject({ accumulatedMs: 30_000, startedAt: null })
  })

  it('adds to time already banked rather than replacing it', () => {
    const doc = docWith({ p1: timerPanel([running({ accumulatedMs: 5_000 })]) })
    expect(timersIn(pauseRunningTimers(doc, ALIVE_UNTIL))[0]).toMatchObject({
      accumulatedMs: 35_000
    })
  })

  it('leaves a stopped timer exactly as it was', () => {
    const stopped = running({ startedAt: null, accumulatedMs: 12_000 })
    const doc = docWith({ p1: timerPanel([stopped]) })
    expect(pauseRunningTimers(doc, ALIVE_UNTIL)).toBe(doc)
  })

  // The whole point of the exercise: a countdown must come back with time left
  // on it, not expired because the app was shut over the weekend.
  it('leaves a countdown short of its duration', () => {
    const doc = docWith({
      p1: timerPanel([running({ mode: 'down', durationMs: 60_000 })])
    })
    const timer = timersIn(pauseRunningTimers(doc, ALIVE_UNTIL))[0]
    expect(timer['accumulatedMs']).toBe(30_000)
    expect(Number(timer['durationMs']) - Number(timer['accumulatedMs'])).toBe(30_000)
  })

  it('keeps every other field on the timer', () => {
    const doc = docWith({ p1: timerPanel([running({ label: 'Burning fuse', mode: 'down' })]) })
    expect(timersIn(pauseRunningTimers(doc, ALIVE_UNTIL))[0]).toMatchObject({
      id: 'tm_a',
      label: 'Burning fuse',
      mode: 'down'
    })
  })

  it('pauses every running timer in a panel and every timer panel in a document', () => {
    const doc = docWith({
      p1: timerPanel([running(), running({ id: 'tm_b', startedAt: START + 10_000 })]),
      p2: timerPanel([running({ id: 'tm_c' })]),
      p3: { moduleId: 'notes', settings: {}, state: { text: 'untouched' } }
    })
    const next = pauseRunningTimers(doc, ALIVE_UNTIL)
    expect(timersIn(next).map((timer) => timer['accumulatedMs'])).toEqual([30_000, 20_000])
    expect(timersIn(next, 'p2')[0]).toMatchObject({ accumulatedMs: 30_000, startedAt: null })
    expect(next.panels['p3']).toBe(doc.panels['p3'])
  })

  // Returning the same object is what lets a caller skip the work, and it keeps a
  // restore with no timers in it from allocating a second copy of the document.
  it('returns the same document when nothing was running', () => {
    const doc = docWith({ p1: { moduleId: 'notes', settings: {}, state: { text: 'hi' } } })
    expect(pauseRunningTimers(doc, ALIVE_UNTIL)).toBe(doc)
  })

  // No stamp means no idea when the app was last alive. Banking to "now" would
  // fold the whole shutdown back in, which is the bug this exists to fix, so the
  // timers are left running instead.
  it('leaves the document alone without a usable stamp', () => {
    const doc = docWith({ p1: timerPanel([running()]) })
    expect(pauseRunningTimers(doc, undefined)).toBe(doc)
    expect(pauseRunningTimers(doc, Number.NaN)).toBe(doc)
    expect(pauseRunningTimers(doc, Number.POSITIVE_INFINITY)).toBe(doc)
  })

  // A stamp older than the run itself describes a clock the file cannot explain.
  // Banking the negative would hand back time the timer never counted.
  it('never banks a negative run', () => {
    const doc = docWith({ p1: timerPanel([running({ accumulatedMs: 4_000 })]) })
    expect(timersIn(pauseRunningTimers(doc, START - 60_000))[0]).toMatchObject({
      accumulatedMs: 4_000,
      startedAt: null
    })
  })

  // Panel state is hand-editable JSON, so every one of these is reachable from a
  // file someone typed into. None of them may throw on the way to the first frame.
  it('survives junk in place of timers', () => {
    const doc = docWith({
      p1: timerPanel([null, 'nonsense', 42, {}, { startedAt: 'soon' }, running()]),
      p2: { moduleId: 'timers', settings: {}, state: { timers: 'not an array' } },
      p3: { moduleId: 'timers', settings: {}, state: {} }
    })
    const next = pauseRunningTimers(doc, ALIVE_UNTIL)
    expect(timersIn(next).at(-1)).toMatchObject({ accumulatedMs: 30_000, startedAt: null })
    expect(next.panels['p2']).toBe(doc.panels['p2'])
    expect(next.panels['p3']).toBe(doc.panels['p3'])
  })

  it('treats an unreadable accumulatedMs as nothing banked', () => {
    const doc = docWith({ p1: timerPanel([running({ accumulatedMs: 'lots' })]) })
    expect(timersIn(pauseRunningTimers(doc, ALIVE_UNTIL))[0]).toMatchObject({
      accumulatedMs: 30_000
    })
  })

  it('does not mutate the document it was given', () => {
    const doc = docWith({ p1: timerPanel([running()]) })
    pauseRunningTimers(doc, ALIVE_UNTIL)
    expect(timersIn(doc)[0]).toMatchObject({ accumulatedMs: 0, startedAt: START })
  })
})

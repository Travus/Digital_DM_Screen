/**
 * Stopping running timers at the last moment the app was alive.
 *
 * A timer counts by storing the wall-clock instant it started and deriving the
 * rest, which is what keeps a running clock from writing to the layout sixty
 * times a minute. The cost is that the arithmetic cannot tell time the app was
 * running from time it was shut: quit with a timer going, come back tomorrow,
 * and a session timer reads nineteen hours while a five-minute break countdown
 * has long since expired.
 *
 * So a document is corrected on the way in. Every running timer is banked up to
 * the last instant the app is known to have been alive and then stopped, which
 * leaves the clock reading what it read when you closed it, ready for the next
 * Start. Stopped rather than resumed on purpose: nothing should start counting
 * again without being asked, least of all a clock that has been sitting dormant
 * for a week.
 *
 * **This runs in main, not in the module.** A renderer correcting its own copy
 * would leave main's uncorrected, and main's copy is the one a save reads — so
 * Ctrl+S straight after launch would write back the very state we just fixed.
 * Doing it here also means it happens once, before the first window exists,
 * rather than once per window that happens to show the panel.
 *
 * That makes this the one piece of module-specific knowledge outside
 * `modules/`. It earns the exception by being about wall-clock time crossing a
 * process lifetime, which is main's concern and nothing a module can see. The
 * shape below is a structural read of hand-editable JSON rather than an import:
 * panel state is whatever is in the file, so every field is checked.
 */
import type { LayoutDoc, PanelData } from '../shared/types'

/** The module whose panel state holds clocks. */
const TIMER_MODULE_ID = 'timers'

interface StoredTimer {
  accumulatedMs: number
  startedAt: number | null
}

/**
 * A timer mid-run, or null for anything else.
 *
 * Deliberately incurious about the rest of the entry — mode, label and duration
 * are none of this file's business, and refusing an entry for a field it does
 * not read would drop a timer over a detail that cannot affect the answer.
 */
function runningTimer(entry: unknown): StoredTimer | null {
  if (typeof entry !== 'object' || entry === null) return null
  const timer = entry as Record<string, unknown>
  if (typeof timer['startedAt'] !== 'number' || !Number.isFinite(timer['startedAt'])) return null
  const banked = timer['accumulatedMs']
  return {
    accumulatedMs: typeof banked === 'number' && Number.isFinite(banked) ? banked : 0,
    startedAt: timer['startedAt']
  }
}

function pausePanel(panel: PanelData, aliveUntil: number): PanelData | null {
  if (panel.moduleId !== TIMER_MODULE_ID) return null
  const stored = panel.state['timers']
  if (!Array.isArray(stored)) return null
  // `Array.isArray` narrows an unknown to `any[]`, and every element read out of
  // one is an `any` that spreads. Named as `unknown[]` so the entries stay opaque
  // and have to be checked before they are believed.
  const timers: unknown[] = stored

  let changed = false
  const next = timers.map((entry) => {
    const timer = runningTimer(entry)
    if (!timer || timer.startedAt === null) return entry
    changed = true
    return {
      ...(entry as object),
      // Clamped at both ends. A stamp behind the timer's own start means a
      // clock the file cannot explain, and banking a negative would hand back
      // time the timer never counted.
      accumulatedMs: timer.accumulatedMs + Math.max(0, aliveUntil - timer.startedAt),
      startedAt: null
    }
  })

  return changed ? { ...panel, state: { ...panel.state, timers: next } } : null
}

/**
 * Bank and stop every running timer in `doc`, as of `aliveUntil`.
 *
 * Returns the same document when nothing was running, so a restore with no
 * timers in it costs a walk and no allocation — and so a caller can compare by
 * identity to find out whether anything happened.
 *
 * `aliveUntil` that is not a usable instant leaves the document alone. The
 * alternative is guessing, and every guess available here discards time the
 * timer really did count: an old `session.json` carries no stamp at all, and
 * banking to "now" there would fold the whole shutdown back in, which is the
 * bug this exists to fix.
 */
export function pauseRunningTimers(doc: LayoutDoc, aliveUntil: number | undefined): LayoutDoc {
  if (typeof aliveUntil !== 'number' || !Number.isFinite(aliveUntil)) return doc

  let panels: Record<string, PanelData> | null = null
  for (const [id, panel] of Object.entries(doc.panels)) {
    const paused = pausePanel(panel, aliveUntil)
    if (!paused) continue
    panels ??= { ...doc.panels }
    panels[id] = paused
  }

  return panels ? { ...doc, panels } : doc
}

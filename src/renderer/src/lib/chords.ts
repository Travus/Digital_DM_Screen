import { bindingStrokes } from '../../../shared/accelerator'
import { chordBindings, type ActionId, type ResolvedKeymap } from '../../../shared/actions'

/**
 * The two-stroke sequence dispatcher.
 *
 * Single-stroke bindings are menu accelerators and never reach here — Electron
 * fires those before the renderer sees the key, which is exactly why they cannot
 * be expressed as chords in the first place. This handles only the sequences.
 *
 * Kept as a pure step function so the state machine can be tested as a table of
 * cases rather than by driving a real keyboard.
 */

export type ChordOutcome =
  /** Not the start of any sequence. Let the key through untouched. */
  | { type: 'ignore' }
  /** A prefix landed. Swallow the key and wait for the second stroke. */
  | { type: 'pending'; prefix: string }
  /** The sequence completed. Swallow the key and run the action. */
  | { type: 'fire'; action: ActionId }
  /** A prefix was pending and the next stroke finished nothing. */
  | { type: 'miss'; attempted: string }

export function advanceChord(
  pending: string | null,
  stroke: string,
  keymap: ResolvedKeymap
): ChordOutcome {
  const chords = chordBindings(keymap)

  if (pending) {
    const attempted = `${pending} ${stroke}`
    const hit = chords.find(([, binding]) => binding === attempted)
    // Swallowed either way. A stroke that completes nothing is not passed on to
    // the app: half of `C-x 3` arriving as a literal "3" in whatever field had
    // focus is worse than the sequence quietly failing.
    return hit ? { type: 'fire', action: hit[0] } : { type: 'miss', attempted }
  }

  const opensOne = chords.some(([, binding]) => bindingStrokes(binding)[0] === stroke)
  return opensOne ? { type: 'pending', prefix: stroke } : { type: 'ignore' }
}

/**
 * How long a half-finished sequence waits.
 *
 * Emacs and VS Code wait indefinitely. This does not, because the cost of being
 * wrong is different: a DM mid-session who fumbles a prefix would otherwise have
 * the app silently eat the next key they press, whenever that happens to be. Two
 * seconds is long enough to be deliberate and short enough that an accident
 * clears itself before it can surprise anyone.
 */
export const CHORD_TIMEOUT_MS = 2000

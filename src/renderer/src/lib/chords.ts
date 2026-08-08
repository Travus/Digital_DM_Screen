import { bindingStrokes } from '../../../shared/accelerator'
import {
  chordBindings,
  rendererSingles,
  type ActionId,
  type ResolvedKeymap
} from '../../../shared/actions'

/**
 * The keyboard dispatcher for everything the native menu cannot carry.
 *
 * That is two things: sequences, which an Electron accelerator cannot express at
 * all, and the single-stroke bindings that had to give up their accelerator
 * because a sequence uses the same stroke. The second group is why this exists
 * rather than being purely about chords — telling `CmdOrCtrl+S` apart from the
 * finish of `CmdOrCtrl+K CmdOrCtrl+S` needs to know whether a prefix is pending,
 * and only the renderer knows that.
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

  // Opening a sequence wins over firing something. There is no ambiguity to
  // resolve — `findConflict` refuses to let a stroke be both a prefix and a
  // binding of its own, precisely because that case has no honest answer.
  const opensOne = chords.some(([, binding]) => bindingStrokes(binding)[0] === stroke)
  if (opensOne) return { type: 'pending', prefix: stroke }

  // Nothing pending, so a stroke that some sequence also uses means itself. This
  // is the half the menu handed over; anything still on the menu never gets here.
  const single = rendererSingles(keymap).find(([, binding]) => binding === stroke)
  return single ? { type: 'fire', action: single[0] } : { type: 'ignore' }
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

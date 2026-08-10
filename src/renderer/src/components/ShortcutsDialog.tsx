import { useCallback, useEffect, useState } from 'react'
import {
  acceleratorFromChord,
  BINDING_PROBLEM_MESSAGES,
  checkBinding,
  formatBinding
} from '../../../shared/accelerator'
import {
  ACTION_CATEGORIES,
  ACTIONS,
  findAction,
  findConflict,
  resolveKeymap,
  type ActionId,
  type Conflict,
  type Keymap
} from '../../../shared/actions'
import { PRESETS } from '../../../shared/presets'
import { useKeymapStore } from '../state/keymapStore'

/**
 * How long a recorded first stroke waits to see whether a second one follows.
 *
 * This is what tells `Ctrl+S` apart from the opening half of `Ctrl+K Ctrl+S`,
 * and there is no way to know without waiting — the two are identical up to that
 * point. An explicit "record a sequence" toggle was the alternative and it makes
 * every ordinary rebinding cost an extra click to avoid a pause that only lands
 * once.
 */
const SECOND_STROKE_WINDOW_MS = 900

/**
 * The stroke goes through `formatBinding` like every other one shown: internally
 * it is stored as `CmdOrCtrl`, which is a detail of how one keymap serves both
 * platforms and not something to put in front of anyone.
 */
function describe(conflict: Conflict, platform: string): string {
  const name = findAction(conflict.action)?.label ?? conflict.action
  // Narrowed before reading `stroke`: a duplicate has no single stroke to blame,
  // the whole binding is the clash.
  if (conflict.kind === 'duplicate') return `Already used by "${name}".`

  const stroke = formatBinding(conflict.stroke, platform)
  switch (conflict.kind) {
    // Both sides of the same fact, worded from where the user is standing. Only
    // the opening stroke is contested: pressing it would have to mean both "do
    // that action" and "wait, a sequence is starting", and nothing that happens
    // afterwards can tell those apart.
    case 'prefix-taken':
      return `${stroke} already runs "${name}" on its own, so a sequence cannot start with it. Move that one first.`
    case 'prefix-blocks':
      return `${stroke} is how "${name}" starts, so it cannot also be a shortcut by itself.`
  }
}

/**
 * The keybinding editor.
 *
 * Recording is a `keydown` listener on the window during the capture phase
 * rather than on an input, because the combinations worth binding — Ctrl+W,
 * Ctrl+N — are ones the menu would otherwise act on first. `preventDefault`
 * while capturing is what stops recording "close panel" from closing the panel.
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const keymap = useKeymapStore((state) => state.keymap)
  const [overrides, setOverrides] = useState<Keymap | null>(null)
  const [recording, setRecording] = useState<ActionId | null>(null)
  /** First stroke captured, still waiting to learn whether a second follows. */
  const [captured, setCaptured] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const platform = window.dmscreen.platform
  /** What the primary modifier is called here — Cmd on a Mac, Ctrl everywhere else. */
  const primary = platform === 'darwin' ? 'Cmd' : 'Ctrl'

  useEffect(() => {
    void window.dmscreen.keymapOverrides().then(setOverrides)
  }, [])

  /* Saving pushes the whole sparse map; main persists it, rebuilds the menu and
     echoes the resolved result back through the subscription in App. */
  const commit = useCallback((next: Keymap): void => {
    setOverrides(next)
    void window.dmscreen.setKeymap(next)
  }, [])

  const stopRecording = useCallback((): void => {
    setRecording(null)
    setCaptured(null)
  }, [])

  /** Validates a finished binding and either stores it or says why not. */
  const finish = useCallback(
    (action: ActionId, binding: string): void => {
      const failure = checkBinding(binding)
      if (failure) {
        setProblem(BINDING_PROBLEM_MESSAGES[failure])
        setCaptured(null)
        return
      }

      const clash = findConflict(keymap, binding, action)
      if (clash) {
        setProblem(describe(clash, platform))
        setCaptured(null)
        return
      }

      commit({ ...(overrides ?? {}), [action]: binding })
      setProblem(null)
      stopRecording()
    },
    [keymap, overrides, platform, commit, stopRecording]
  )

  useEffect(() => {
    if (!recording) return

    const onKeyDown = (event: KeyboardEvent): void => {
      // Escape abandons the capture rather than being recorded — it is the one
      // combination nobody can bind, so that is all it can mean here.
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        stopRecording()
        setProblem(null)
        return
      }

      const stroke = acceleratorFromChord(event, platform)
      // Still only modifiers down: keep waiting rather than rejecting.
      if (!stroke) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (captured) {
        finish(recording, `${captured} ${stroke}`)
        return
      }

      // Reject an unusable opening stroke now, rather than after the wait below.
      const failure = checkBinding(stroke)
      if (failure) {
        setProblem(BINDING_PROBLEM_MESSAGES[failure])
        return
      }
      setCaptured(stroke)
      setProblem(null)
    }

    // Capture phase, so this runs before anything else listening on the window —
    // App's Escape handler and its sequence dispatcher among them, either of
    // which would otherwise act on the keys being recorded.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, captured, platform, finish, stopRecording])

  /* No second stroke arrived, so the first one was the whole binding. */
  useEffect(() => {
    if (!recording || !captured) return
    const timer = window.setTimeout(() => finish(recording, captured), SECOND_STROKE_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [recording, captured, finish])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal shortcuts-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <h2>Keyboard shortcuts</h2>
        <p className="note">
          Click a shortcut to record a new one. The first key needs {primary}, Alt or Super — a bare
          key would fire while you were typing in a panel. For a two-key sequence like{' '}
          <kbd>{primary}+K</kbd> <kbd>3</kbd>, press the second key straight after the first; the
          second may be any key at all.
        </p>

        {problem && <p className="note warn">{problem}</p>}

        {/* Applying replaces every override rather than merging into them. A
            half-applied keymap is how you end up with a prefix that still fires
            something on its own, which is the one arrangement nothing can
            resolve. "Default" is the way back. */}
        <div className="settings-section">
          <h4 className="section-title">Start from</h4>
          <div className="preset-row">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="preset"
                // Same reason the picker cards carry `data-module-id`: the label
                // is user-facing prose, and a smoke shot that selected on it —
                // or on position — would be asserting the wrong thing.
                data-preset-id={preset.id}
                title={preset.blurb}
                onClick={() => {
                  stopRecording()
                  setProblem(null)
                  commit({ ...preset.bindings })
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <p className="note">Replaces every shortcut, including ones you have changed yourself.</p>
        </div>

        {ACTION_CATEGORIES.map((category) => {
          const rows = ACTIONS.filter((action) => action.category === category)
          if (!rows.length) return null

          return (
            <div className="settings-section" key={category}>
              <h4 className="section-title">{category}</h4>
              <div className="shortcut-rows">
                {rows.map((action) => {
                  const binding = keymap[action.id]
                  const isRecording = recording === action.id
                  const changed =
                    overrides !== null && Object.prototype.hasOwnProperty.call(overrides, action.id)

                  return (
                    <div className="shortcut-row" key={action.id}>
                      <span className="shortcut-label">
                        {action.label}
                        {changed && <span className="shortcut-changed">changed</span>}
                      </span>

                      {action.fixed ? (
                        // Listed, not hidden: a binding that simply vanished
                        // from the editor reads as a bug. The reason travels
                        // with the entry rather than being written here — Escape
                        // and Quit are fixed for different reasons.
                        <span className="shortcut-key fixed" title={`Fixed — ${action.fixed}`}>
                          {binding ? formatBinding(binding, platform) : '—'}
                        </span>
                      ) : (
                        <button
                          className={`shortcut-key ${isRecording ? 'recording' : ''}`}
                          onClick={() => {
                            setProblem(null)
                            if (isRecording) stopRecording()
                            else {
                              setRecording(action.id)
                              setCaptured(null)
                            }
                          }}
                        >
                          {isRecording
                            ? // Showing the captured half is what makes the wait
                              // legible: the user sees the first key landed and
                              // that a second one is still welcome.
                              captured
                              ? `${formatBinding(captured, platform)} …`
                              : 'Press keys…'
                            : binding
                              ? formatBinding(binding, platform)
                              : 'Unbound'}
                        </button>
                      )}

                      {!action.fixed && (
                        <span className="shortcut-row-actions">
                          <button
                            className="icon-btn"
                            title="Clear this shortcut"
                            disabled={!binding}
                            onClick={() => commit({ ...(overrides ?? {}), [action.id]: null })}
                          >
                            ⌫
                          </button>
                          <button
                            className="icon-btn"
                            title="Back to the default"
                            disabled={!changed}
                            onClick={() => {
                              const next = { ...(overrides ?? {}) }
                              delete next[action.id]
                              commit(next)
                            }}
                          >
                            ↺
                          </button>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* No separate "reset" button: the Default preset above is that, and two
            controls doing one thing is just a question about which to trust. */}
        <div className="toolbar">
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The shortcut list the About dialog shows. Generated rather than written out,
 * so it cannot drift from what the keys actually do — it used to be a hand-kept
 * `<dl>` of literals.
 */
export function ShortcutSummary(): JSX.Element {
  const keymap = useKeymapStore((state) => state.keymap)
  const platform = window.dmscreen.platform
  const resolved = resolveKeymap({})

  return (
    <dl className="deflist">
      {ACTIONS.filter((action) => keymap[action.id]).map((action) => (
        <div className="defrow" key={action.id}>
          <dt>{formatBinding(keymap[action.id] as string, platform)}</dt>
          <dd>
            {action.label}
            {keymap[action.id] !== resolved[action.id] && (
              <span className="shortcut-changed">changed</span>
            )}
          </dd>
        </div>
      ))}
      <div className="defrow">
        <dt>Double-click a splitter</dt>
        <dd>Even out that row or column</dd>
      </div>
    </dl>
  )
}

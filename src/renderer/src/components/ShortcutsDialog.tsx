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

function describe(conflict: Conflict): string {
  const name = findAction(conflict.action)?.label ?? conflict.action
  switch (conflict.kind) {
    case 'duplicate':
      return `Already used by "${name}".`
    // Both sides of the same fact, worded from where the user is standing. A
    // single-stroke binding is a menu accelerator and fires before the renderer
    // sees the key, so it and any sequence containing it cannot both work.
    case 'shadowed':
      return `"${name}" already uses ${conflict.stroke} on its own, which would fire first. Rebind that one before using it here.`
    case 'shadows':
      return `This would fire before "${name}", which uses ${conflict.stroke} as part of a sequence.`
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
        setProblem(describe(clash))
        setCaptured(null)
        return
      }

      commit({ ...(overrides ?? {}), [action]: binding })
      setProblem(null)
      stopRecording()
    },
    [keymap, overrides, commit, stopRecording]
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

  const changedCount = overrides ? Object.keys(overrides).length : 0

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
          Click a shortcut to record a new one. The first key needs Ctrl, Cmd, Alt or Super — a bare
          key would fire while you were typing in a panel. For a two-key sequence like{' '}
          <kbd>Ctrl+K</kbd> <kbd>3</kbd>, press the second key straight after the first; the second
          may be any key at all.
        </p>

        {problem && <p className="note warn">{problem}</p>}

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
                        // from the editor reads as a bug. Escape is owned by the
                        // renderer because a menu accelerator for it swallows
                        // the key inside text fields too.
                        <span
                          className="shortcut-key fixed"
                          title="Fixed — Escape is handled by the app itself"
                        >
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

        <div className="toolbar">
          <button
            className="btn"
            disabled={changedCount === 0}
            onClick={() => {
              stopRecording()
              setProblem(null)
              setOverrides({})
              void window.dmscreen.resetKeymap()
            }}
          >
            Reset all to defaults
          </button>
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

import { useEffect, useState } from 'react'
import {
  acceleratorFromChord,
  checkAccelerator,
  formatAccelerator,
  PROBLEM_MESSAGES
} from '../../../shared/accelerator'
import {
  ACTION_CATEGORIES,
  ACTIONS,
  findAction,
  findConflict,
  resolveKeymap,
  type ActionId,
  type Keymap
} from '../../../shared/actions'
import { useKeymapStore } from '../state/keymapStore'

/**
 * The keybinding editor.
 *
 * Recording is a `keydown` listener on the window during capture rather than on
 * an input, because the chords worth binding — Ctrl+W, Ctrl+N — are ones the
 * browser and the menu would otherwise act on first. `preventDefault` while
 * capturing is what stops recording "close panel" from closing the panel.
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const keymap = useKeymapStore((state) => state.keymap)
  const [overrides, setOverrides] = useState<Keymap | null>(null)
  const [recording, setRecording] = useState<ActionId | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const platform = window.dmscreen.platform

  useEffect(() => {
    void window.dmscreen.keymapOverrides().then(setOverrides)
  }, [])

  /* Saving pushes the whole sparse map; main persists it, rebuilds the menu and
     echoes the resolved result back through the subscription in App. */
  const commit = (next: Keymap): void => {
    setOverrides(next)
    void window.dmscreen.setKeymap(next)
  }

  useEffect(() => {
    if (!recording) return

    const onKeyDown = (event: KeyboardEvent): void => {
      // Escape leaves recording rather than being recorded — it is the one chord
      // nobody can bind, and abandoning a capture is what a user pressing it
      // there actually means.
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setRecording(null)
        setProblem(null)
        return
      }

      const accelerator = acceleratorFromChord(event, platform)
      // Still only modifiers down: keep waiting rather than rejecting.
      if (!accelerator) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const failure = checkAccelerator(accelerator)
      if (failure) {
        setProblem(PROBLEM_MESSAGES[failure])
        return
      }

      const clash = findConflict(keymap, accelerator, recording)
      if (clash) {
        setProblem(`Already used by "${findAction(clash)?.label ?? clash}".`)
        return
      }

      commit({ ...(overrides ?? {}), [recording]: accelerator })
      setRecording(null)
      setProblem(null)
    }

    // Capture phase, so this runs before anything else listening on the window —
    // App's own Escape handler among them, which would otherwise drop the panel
    // out of fullscreen while the user was only cancelling a capture.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, keymap, overrides, platform])

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
          Click a shortcut to record a new one. Combinations need Ctrl, Cmd, Alt or Super — a bare
          key would fire while you were typing in a panel.
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
                  const accelerator = keymap[action.id]
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
                          {accelerator ? formatAccelerator(accelerator, platform) : '—'}
                        </span>
                      ) : (
                        <button
                          className={`shortcut-key ${isRecording ? 'recording' : ''}`}
                          onClick={() => {
                            setProblem(null)
                            setRecording(isRecording ? null : action.id)
                          }}
                        >
                          {isRecording
                            ? 'Press keys…'
                            : accelerator
                              ? formatAccelerator(accelerator, platform)
                              : 'Unbound'}
                        </button>
                      )}

                      {!action.fixed && (
                        <span className="shortcut-row-actions">
                          <button
                            className="icon-btn"
                            title="Clear this shortcut"
                            disabled={!accelerator}
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
              setRecording(null)
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
          <dt>{formatAccelerator(keymap[action.id] as string, platform)}</dt>
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

import { uid } from '../../../shared/layout'
import { NumberInput } from '../components/NumberInput'
import { defineModule, type ModuleProps } from './types'

/**
 * A 'track' is the segmented row of boxes you fill in as something advances —
 * the ritual, the pursuit, the patience of the duke.
 */
type TrackerKind = 'counter' | 'track'

interface Tracker {
  id: string
  label: string
  kind: TrackerKind
  value: number
  max: number
  step: number
}

interface State {
  trackers: Tracker[]
  editing: boolean
}

interface Settings {
  columns: number
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

function Trackers({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const setTrackers = (updater: (trackers: Tracker[]) => Tracker[]): void =>
    setState((prev) => ({ trackers: updater(prev.trackers) }))

  const patch = (id: string, changes: Partial<Tracker>): void =>
    setTrackers((trackers) =>
      trackers.map((tracker) => (tracker.id === id ? { ...tracker, ...changes } : tracker))
    )

  const add = (kind: TrackerKind): void =>
    setTrackers((trackers) => [
      ...trackers,
      {
        id: uid('t'),
        label: kind === 'track' ? 'New track' : 'New counter',
        kind,
        value: 0,
        max: kind === 'track' ? 6 : 10,
        step: 1
      }
    ])

  return (
    <div className="stack">
      <div className="toolbar">
        <button className="btn" onClick={() => add('counter')}>
          + Counter
        </button>
        <button className="btn" onClick={() => add('track')}>
          + Track
        </button>
        <span className="spacer" />
        <button
          className={`btn ${state.editing ? 'primary' : ''}`}
          onClick={() => setState({ editing: !state.editing })}
        >
          {state.editing ? 'Done' : 'Edit'}
        </button>
      </div>

      <div
        className="tracker-grid"
        style={{ gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))` }}
      >
        {state.trackers.map((tracker) => (
          <div key={tracker.id} className="tracker">
            {state.editing ? (
              <div className="stack tight">
                <input
                  className="input"
                  value={tracker.label}
                  onChange={(event) => patch(tracker.id, { label: event.target.value })}
                />
                <div className="toolbar">
                  <label className="mini-field">
                    <span>{tracker.kind === 'track' ? 'Segments' : 'Max'}</span>
                    <NumberInput
                      className="cell-input num"
                      min={1}
                      value={tracker.max}
                      onChange={(max) => patch(tracker.id, { max })}
                    />
                  </label>
                  {tracker.kind === 'counter' && (
                    <label className="mini-field">
                      <span>Step</span>
                      <NumberInput
                        className="cell-input num"
                        min={1}
                        value={tracker.step}
                        onChange={(step) => patch(tracker.id, { step })}
                      />
                    </label>
                  )}
                  <span className="spacer" />
                  <button
                    className="icon-btn danger"
                    title="Delete tracker"
                    onClick={() =>
                      setTrackers((trackers) => trackers.filter((entry) => entry.id !== tracker.id))
                    }
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="tracker-head">
                  <span className="tracker-label">{tracker.label}</span>
                  <button
                    className="icon-btn"
                    title="Reset to zero"
                    onClick={() => patch(tracker.id, { value: 0 })}
                  >
                    ↺
                  </button>
                </div>

                {tracker.kind === 'track' ? (
                  <div className="track">
                    {Array.from({ length: tracker.max }, (_, index) => (
                      <button
                        key={index}
                        className={`track-seg ${index < tracker.value ? 'filled' : ''}`}
                        title={`Set to ${index + 1}`}
                        onClick={() =>
                          patch(tracker.id, {
                            // Clicking the last filled segment un-fills it, so a
                            // mis-click is one click to undo.
                            value: tracker.value === index + 1 ? index : index + 1
                          })
                        }
                      />
                    ))}
                    <span className="track-count">
                      {tracker.value}/{tracker.max}
                    </span>
                  </div>
                ) : (
                  <div className="counter">
                    <button
                      className="counter-btn"
                      onClick={() =>
                        patch(tracker.id, {
                          value: clamp(tracker.value - tracker.step, tracker.max)
                        })
                      }
                    >
                      −
                    </button>
                    <span className="counter-value">{tracker.value}</span>
                    <button
                      className="counter-btn"
                      onClick={() =>
                        patch(tracker.id, {
                          value: clamp(tracker.value + tracker.step, tracker.max)
                        })
                      }
                    >
                      +
                    </button>
                    <span className="counter-max">/ {tracker.max}</span>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {state.trackers.length === 0 && (
        <p className="empty">
          Counters for things that tick down — rations, torches, spell slots — and tracks for things
          closing in.
        </p>
      )}
    </div>
  )
}

function TrackersSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
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
    </div>
  )
}

export const trackersModule = defineModule<State, Settings>({
  id: 'trackers',
  name: 'Counters & Tracks',
  icon: '📊',
  blurb: 'Resource counters, and segmented progress tracks for threats closing in.',
  category: 'Tracking',
  // Literal ids — see the note in TablesModule: generated ids in a module's
  // defaults go stale the moment anything persists a reference to them.
  defaultState: () => ({
    trackers: [
      { id: 't_torches', label: 'Torches', kind: 'counter', value: 4, max: 10, step: 1 },
      { id: 't_ritual', label: 'The ritual completes', kind: 'track', value: 0, max: 6, step: 1 }
    ],
    editing: false
  }),
  defaultSettings: () => ({ columns: 2 }),
  Component: Trackers,
  Settings: TrackersSettings
})

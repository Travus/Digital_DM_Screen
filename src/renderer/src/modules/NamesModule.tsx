import { uid } from '../../../shared/layout'
import { randomOf } from '../lib/dice'
import { PLACE_DETAILS, PLACE_HOOKS, TRAITS, WANTS, type NameStyle } from '../data/names'
import { useDataStore } from '../state/dataStore'
import { defineModule, type ModuleProps } from './types'

/** A kept entry: a bare name has no lines, a fleshed-out one has two. */
interface KeptEntry {
  id: string
  name: string
  style: string
  lines: string[]
}

interface State {
  styleId: string
  names: string[]
  detailed: KeptEntry | null
  kept: KeptEntry[]
}

interface Settings {
  count: number
}

/**
 * Read imperatively rather than through the hook: the callers below run from
 * event handlers, and the component takes its own reactive copy for rendering.
 *
 * Undefined only when there are no styles at all — see the guard in `Names`.
 */
function styleFor(styleId: string): NameStyle | undefined {
  const styles = useDataStore.getState().nameStyles
  return styles.find((entry) => entry.id === styleId) ?? styles[0]
}

function generate(styleId: string, count: number): string[] {
  const style = styleFor(styleId)
  if (!style) return []

  const names = new Set<string>()

  // Bounded so a small syllable pool can't spin forever chasing unique names.
  for (let attempt = 0; attempt < count * 12 && names.size < count; attempt += 1) {
    const middle = Math.random() < style.middleChance ? randomOf(style.middle) : ''
    const joiner = style.kind === 'place' ? ' ' : ''
    names.add([randomOf(style.prefix), middle, randomOf(style.suffix)].filter(Boolean).join(joiner))
  }

  return [...names]
}

/** People get a quirk and a motive; places get a detail and a hook. */
function detailsFor(styleId: string): string[] {
  const style = styleFor(styleId)
  if (!style) return []

  return style.kind === 'place'
    ? [randomOf(PLACE_DETAILS), randomOf(PLACE_HOOKS)]
    : [randomOf(TRAITS), randomOf(WANTS)]
}

function Names({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const nameStyles = useDataStore((store) => store.nameStyles)
  const style = nameStyles.find((entry) => entry.id === state.styleId) ?? nameStyles[0]

  if (!style) {
    return <p className="empty">No name pools are loaded. Switch them back on in the Data menu.</p>
  }

  const isPlace = style.kind === 'place'

  const roll = (styleId = state.styleId): void =>
    setState({ styleId, names: generate(styleId, settings.count) })

  const fleshOut = (name?: string): void => {
    const chosen = name ?? generate(state.styleId, 1)[0]
    if (!chosen) return
    setState({
      detailed: { id: uid('npc'), name: chosen, style: style.label, lines: detailsFor(state.styleId) }
    })
  }

  const keep = (entry: KeptEntry): void =>
    setState((prev) =>
      prev.kept.some((existing) => existing.name === entry.name && existing.lines.join() === entry.lines.join())
        ? prev
        : { kept: [entry, ...prev.kept] }
    )

  const drop = (id: string): void =>
    setState((prev) => ({ kept: prev.kept.filter((entry) => entry.id !== id) }))

  return (
    <div className="stack">
      <div className="toolbar wrap">
        <select className="input" value={state.styleId} onChange={(event) => roll(event.target.value)}>
          {nameStyles.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => roll()}>
          Generate
        </button>
        <button
          className="btn"
          onClick={() => fleshOut()}
          title={isPlace ? 'A name plus a telling detail and a hook' : 'A name plus a quirk and a motivation'}
        >
          {isPlace ? 'Whole place' : 'Whole NPC'}
        </button>
      </div>

      {state.detailed && (
        <div className="npc-card">
          <div className="npc-head">
            <span className="npc-name">{state.detailed.name}</span>
            <div className="toolbar">
              <button className="btn" onClick={() => fleshOut(state.detailed?.name)} title="Same name, new details">
                Reroll
              </button>
              <button className="btn primary" onClick={() => keep(state.detailed as KeptEntry)}>
                Keep
              </button>
            </div>
          </div>
          {state.detailed.lines.map((line) => (
            <div key={line} className="npc-line">
              {line}
            </div>
          ))}
        </div>
      )}

      {state.names.length > 0 ? (
        <div className="stack tight">
          <h4 className="section-title">Generated — click to keep, or ✦ to flesh out</h4>
          <div className="chip-row">
            {state.names.map((name) => (
              <span key={name} className="chip-pair">
                <button
                  className="chip action"
                  title="Keep this name"
                  onClick={() => keep({ id: uid('kept'), name, style: style.label, lines: [] })}
                >
                  {name}
                </button>
                <button
                  className="chip flesh"
                  title={isPlace ? 'Flesh out this place' : 'Flesh out this NPC'}
                  onClick={() => fleshOut(name)}
                >
                  ✦
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="empty">Hit Generate for a fistful of names you can hand out on the spot.</p>
      )}

      {state.kept.length > 0 && (
        <div className="stack tight">
          <div className="toolbar">
            <h4 className="section-title">Kept</h4>
            <span className="spacer" />
            <button className="btn" onClick={() => setState({ kept: [] })}>
              Clear kept
            </button>
          </div>
          {state.kept.map((entry) => (
            <div key={entry.id} className="result">
              <div className="result-head">
                <span className="result-table">{entry.style}</span>
                <button className="icon-btn danger" title="Remove" onClick={() => drop(entry.id)}>
                  ✕
                </button>
              </div>
              <span className="result-text strong">{entry.name}</span>
              {entry.lines.map((line) => (
                <span key={line} className="result-sub">
                  {line}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NamesSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  return (
    <div className="stack tight">
      <label className="field">
        <span>Names per batch — {settings.count}</span>
        <input
          type="range"
          min={4}
          max={30}
          value={settings.count}
          onChange={(event) => setSettings({ count: Number(event.target.value) })}
        />
      </label>
    </div>
  )
}

export const namesModule = defineModule<State, Settings>({
  id: 'names',
  name: 'Name Generator',
  icon: '🎭',
  blurb: 'Names for people, taverns and shops, with a quirk and a motive when you need the whole character.',
  category: 'Tools',
  defaultState: () => ({ styleId: 'human', names: [], detailed: null, kept: [] }),
  defaultSettings: () => ({ count: 12 }),
  Component: Names,
  Settings: NamesSettings
})

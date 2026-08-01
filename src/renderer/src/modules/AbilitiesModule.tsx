import { ReferenceList } from '../components/ReferenceList'
import { migrateIds } from '../data/resolve'
import { NO_DATA_HINT, useDataStore } from '../state/dataStore'
import { defineModule, type ModuleProps } from './types'

interface State {
  activeGroup: string
  query: string
  expanded: string[]
  /** Shared across tabs — favouriting is per option, not per tab. */
  favourites: string[]
}

interface Settings {
  showSummaries: boolean
  startExpanded: boolean
  hidden: string[]
}

function Abilities({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const allGroups = useDataStore((store) => store.abilityGroups)
  const groups = allGroups.filter((group) => !settings.hidden.includes(group.id))
  const active = groups.find((group) => group.id === state.activeGroup) ?? groups[0]

  // Two different problems with the same symptom, and pointing at the wrong one
  // sends you hunting through panel settings that have nothing to fix.
  if (!allGroups.length) {
    return <p className="empty">No ability data is loaded. {NO_DATA_HINT}</p>
  }

  if (!active) {
    return <p className="empty">Every tab is hidden. Re-enable one in this panel’s settings.</p>
  }

  const toggle = (key: 'expanded' | 'favourites', id: string): void =>
    setState((prev) => {
      const current = migrateIds(prev[key])
      return {
        [key]: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
      }
    })

  // Stars are user investment, so ids saved before sources were namespaced are
  // read as the bundled ones rather than dropped.
  const expanded = migrateIds(state.expanded)
  const favourites = migrateIds(state.favourites)

  const entries = active.entries
  const favouriteCount = entries.filter((entry) => favourites.includes(entry.id)).length

  return (
    <div className="stack">
      <div className="tabs">
        {groups.map((group) => (
          <button
            key={group.id}
            className={`tab ${group.id === active.id ? 'active' : ''}`}
            onClick={() => setState({ activeGroup: group.id })}
          >
            {group.title}
          </button>
        ))}
      </div>

      <p className="note">{active.blurb}</p>

      <ReferenceList
        entries={entries}
        query={state.query}
        onQueryChange={(query) => setState({ query })}
        expanded={expanded}
        onToggleExpanded={(id) => toggle('expanded', id)}
        onResetExpanded={() => setState({ expanded: [] })}
        startExpanded={settings.startExpanded}
        showSummaries={settings.showSummaries}
        favourites={favourites}
        onToggleFavourite={(id) => toggle('favourites', id)}
        searchPlaceholder={`Filter ${active.title.toLowerCase()}…`}
        emptyLabel="Nothing matches"
      />

      {favouriteCount === 0 && (
        <p className="note">
          Star the options your players actually took — they pin to the top of this tab.
        </p>
      )}
    </div>
  )
}

function AbilitiesSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  const allGroups = useDataStore((store) => store.abilityGroups)

  const toggleHidden = (id: string): void =>
    setSettings((prev) => ({
      hidden: prev.hidden.includes(id)
        ? prev.hidden.filter((entry) => entry !== id)
        : [...prev.hidden, id]
    }))

  return (
    <div className="stack tight">
      <label className="check">
        <input
          type="checkbox"
          checked={settings.showSummaries}
          onChange={(event) => setSettings({ showSummaries: event.target.checked })}
        />
        Show one-line summaries when collapsed
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.startExpanded}
          onChange={(event) => setSettings({ startExpanded: event.target.checked })}
        />
        Expand everything by default
      </label>

      <div className="settings-section">
        <h4>Tabs</h4>
        {allGroups.map((group) => (
          <label key={group.id} className="check">
            <input
              type="checkbox"
              checked={!settings.hidden.includes(group.id)}
              onChange={() => toggleHidden(group.id)}
            />
            {group.title}
          </label>
        ))}
      </div>
    </div>
  )
}

export const abilitiesModule = defineModule<State, Settings>({
  id: 'abilities',
  name: 'Player Abilities',
  icon: '✨',
  blurb: 'Metamagic and channel divinity. Star the ones your table uses.',
  category: 'Reference',
  defaultState: () => ({ activeGroup: 'metamagic', query: '', expanded: [], favourites: [] }),
  defaultSettings: () => ({ showSummaries: true, startExpanded: false, hidden: [] }),
  Component: Abilities,
  Settings: AbilitiesSettings
})

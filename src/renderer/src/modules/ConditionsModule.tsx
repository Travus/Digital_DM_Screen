import { ReferenceList } from '../components/ReferenceList'
import { migrateIds } from '../data/resolve'
import { NO_DATA_HINT, useDataStore } from '../state/dataStore'
import { defineModule, type ModuleProps } from './types'

interface State {
  query: string
  expanded: string[]
}

interface Settings {
  showSummaries: boolean
  startExpanded: boolean
}

function Conditions({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const entries = useDataStore((store) => store.conditions)

  // "No condition matches" beside an empty search box reads as a broken filter.
  if (!entries.length) {
    return <p className="empty">No condition data is loaded. {NO_DATA_HINT}</p>
  }

  return (
    <ReferenceList
      entries={entries}
      query={state.query}
      onQueryChange={(query) => setState({ query })}
      // Expansion used to be keyed by name and is now keyed by a qualified id,
      // so state saved before that simply stops matching. It is only which cards
      // are open, so it is left to fall away rather than special-cased.
      expanded={migrateIds(state.expanded)}
      onToggleExpanded={(id) =>
        setState((prev) => {
          const current = migrateIds(prev.expanded)
          return {
            expanded: current.includes(id)
              ? current.filter((entry) => entry !== id)
              : [...current, id]
          }
        })
      }
      onResetExpanded={() => setState({ expanded: [] })}
      startExpanded={settings.startExpanded}
      showSummaries={settings.showSummaries}
      searchPlaceholder="Filter conditions…"
      emptyLabel="No condition matches"
    />
  )
}

function ConditionsSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
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
        Expand all conditions by default
      </label>
      <p className="note">
        Conditions mentioned inside another condition’s text are underlined — hover one to read it
        without leaving the panel.
      </p>
    </div>
  )
}

export const conditionsModule = defineModule<State, Settings>({
  id: 'conditions',
  name: 'Conditions',
  icon: '🩸',
  blurb: 'Every status condition with its full effects, searchable and cross-linked.',
  category: 'Reference',
  defaultState: () => ({ query: '', expanded: [] }),
  defaultSettings: () => ({ showSummaries: true, startExpanded: false }),
  Component: Conditions,
  Settings: ConditionsSettings
})

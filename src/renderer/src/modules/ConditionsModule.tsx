import { ReferenceList } from '../components/ReferenceList'
import { useDataStore } from '../state/dataStore'
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

  return (
    <ReferenceList
      entries={entries}
      query={state.query}
      onQueryChange={(query) => setState({ query })}
      expanded={state.expanded}
      onToggleExpanded={(id) =>
        setState((prev) => ({
          expanded: prev.expanded.includes(id)
            ? prev.expanded.filter((entry) => entry !== id)
            : [...prev.expanded, id]
        }))
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

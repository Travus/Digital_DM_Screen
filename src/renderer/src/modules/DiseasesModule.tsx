import { ReferenceList } from '../components/ReferenceList'
import { migrateIds } from '../data/resolve'
import { useDataStore } from '../state/dataStore'
import { defineModule, type ModuleProps } from './types'

interface State {
  query: string
  expanded: string[]
  favourites: string[]
}

interface Settings {
  showSummaries: boolean
  startExpanded: boolean
}

function Diseases({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const entries = useDataStore((store) => store.diseases)

  const toggle = (key: 'expanded' | 'favourites', id: string): void =>
    setState((prev) => {
      const current = migrateIds(prev[key])
      return {
        [key]: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
      }
    })

  return (
    <ReferenceList
      entries={entries}
      query={state.query}
      onQueryChange={(query) => setState({ query })}
      expanded={migrateIds(state.expanded)}
      onToggleExpanded={(id) => toggle('expanded', id)}
      onResetExpanded={() => setState({ expanded: [] })}
      startExpanded={settings.startExpanded}
      showSummaries={settings.showSummaries}
      favourites={migrateIds(state.favourites)}
      onToggleFavourite={(id) => toggle('favourites', id)}
      searchPlaceholder="Filter diseases…"
      emptyLabel="No disease matches"
    />
  )
}

function DiseasesSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
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
      <p className="note">
        The six a <em>contagion</em> can inflict, and the three with their own write-ups.
      </p>
    </div>
  )
}

export const diseasesModule = defineModule<State, Settings>({
  id: 'diseases',
  name: 'Diseases',
  icon: '🧫',
  blurb: 'Cackle fever, sewer plague, sight rot and the rest, with saves and cures.',
  category: 'Reference',
  defaultState: () => ({ query: '', expanded: [], favourites: [] }),
  defaultSettings: () => ({ showSummaries: true, startExpanded: false }),
  Component: Diseases,
  Settings: DiseasesSettings
})

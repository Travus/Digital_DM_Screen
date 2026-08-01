import { ReferenceList, type ReferenceEntry } from '../components/ReferenceList'
import { DISEASES } from '../data/diseases'
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

const ENTRIES: ReferenceEntry[] = DISEASES.map((disease) => ({
  id: disease.id,
  name: disease.name,
  summary: disease.summary,
  lines: disease.lines,
  meta: disease.meta,
  note: disease.note
}))

function Diseases({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const toggle = (key: 'expanded' | 'favourites', id: string): void =>
    setState((prev) => ({
      [key]: prev[key].includes(id) ? prev[key].filter((entry) => entry !== id) : [...prev[key], id]
    }))

  return (
    <ReferenceList
      entries={ENTRIES}
      query={state.query}
      onQueryChange={(query) => setState({ query })}
      expanded={state.expanded}
      onToggleExpanded={(id) => toggle('expanded', id)}
      onResetExpanded={() => setState({ expanded: [] })}
      startExpanded={settings.startExpanded}
      showSummaries={settings.showSummaries}
      favourites={state.favourites}
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

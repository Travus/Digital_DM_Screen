import { uid } from '../../../shared/layout'
import { randomOf } from '../lib/dice'
import { defineModule, type ModuleProps } from './types'

interface RandomTable {
  id: string
  name: string
  entries: string[]
}

interface State {
  tables: RandomTable[]
  activeId: string | null
  /** Ids of tables currently in edit mode — editing is per table, not per panel. */
  editingIds: string[]
  results: { id: string; table: string; text: string }[]
}

interface Settings {
  resultLimit: number
}

/**
 * Ids are literal, not generated: defaults must be identical every time they
 * are built, or persisted state referring to them goes stale. Panels don't
 * share state, so two Random Table panels reusing an id is harmless.
 */
const starterTables = (): RandomTable[] => [
  {
    id: 'tbl_complications',
    name: 'Complications',
    entries: [
      'The city watch arrives, and someone recognises a party member.',
      'A rival group is already here, and they got here first.',
      'The floor gives way — everyone makes a DC 12 Dexterity save.',
      'A witness starts screaming.',
      'The thing they came for is already gone.',
      'It starts raining, hard. Visibility drops to 30 feet.',
      'An NPC ally does something reckless and helpful.',
      'The doors lock behind them.'
    ]
  },
  {
    id: 'tbl_room',
    name: 'What’s in the room',
    entries: [
      'Furniture overturned, dust disturbed in a wide arc.',
      'A cold draught with no obvious source.',
      'Old bloodstain, scrubbed but not well.',
      'Something valuable in plain sight — obviously a trap, obviously worth it.',
      'A body, days old, still holding a letter.',
      'Nothing. Genuinely nothing. That’s the unnerving part.'
    ]
  }
]

function Tables({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const active =
    state.tables.find((table) => table.id === state.activeId) ?? state.tables[0] ?? null

  const setTables = (updater: (tables: RandomTable[]) => RandomTable[]): void =>
    setState((prev) => ({ tables: updater(prev.tables) }))

  const roll = (table: RandomTable): void => {
    const usable = table.entries.filter((entry) => entry.trim())
    if (usable.length === 0) return
    setState((prev) => ({
      results: [{ id: uid('r'), table: table.name, text: randomOf(usable) }, ...prev.results].slice(
        0,
        settings.resultLimit
      )
    }))
  }

  const editing = active ? state.editingIds.includes(active.id) : false

  const toggleEditing = (tableId: string): void =>
    setState((prev) => ({
      editingIds: prev.editingIds.includes(tableId)
        ? prev.editingIds.filter((id) => id !== tableId)
        : [...prev.editingIds, tableId]
    }))

  const addTable = (): void => {
    const table: RandomTable = { id: uid('tbl'), name: 'New table', entries: [] }
    setState((prev) => ({
      tables: [...prev.tables, table],
      activeId: table.id,
      editingIds: [...prev.editingIds, table.id]
    }))
  }

  return (
    <div className="stack">
      <div className="tabs">
        {state.tables.map((table) => (
          <button
            key={table.id}
            className={`tab ${table.id === active?.id ? 'active' : ''}`}
            onClick={() => setState({ activeId: table.id })}
          >
            {table.name || 'Untitled'}
          </button>
        ))}
        <button className="tab add" onClick={addTable} title="New table">
          +
        </button>
      </div>

      {active ? (
        <>
          <div className="toolbar">
            <button className="btn primary" onClick={() => roll(active)}>
              Roll on “{active.name || 'Untitled'}”
            </button>
            <span className="spacer" />
            <button
              className={`btn ${editing ? 'primary' : ''}`}
              onClick={() => toggleEditing(active.id)}
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>

          {editing && (
            <div className="stack tight">
              <label className="field">
                <span>Table name</span>
                <input
                  className="input"
                  value={active.name}
                  onChange={(event) =>
                    setTables((tables) =>
                      tables.map((table) =>
                        table.id === active.id ? { ...table, name: event.target.value } : table
                      )
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Entries — one per line</span>
                <textarea
                  className="notes-area short"
                  value={active.entries.join('\n')}
                  onChange={(event) =>
                    setTables((tables) =>
                      tables.map((table) =>
                        table.id === active.id
                          ? { ...table, entries: event.target.value.split('\n') }
                          : table
                      )
                    )
                  }
                />
              </label>
              <button
                className="btn danger"
                onClick={() =>
                  setState((prev) => {
                    const tables = prev.tables.filter((table) => table.id !== active.id)
                    return {
                      tables,
                      activeId: tables[0]?.id ?? null,
                      editingIds: prev.editingIds.filter((id) => id !== active.id)
                    }
                  })
                }
              >
                Delete this table
              </button>
            </div>
          )}

          {!editing && (
            <ol className="numbered">
              {active.entries
                .filter((entry) => entry.trim())
                .map((entry, index) => (
                  <li key={`${index}-${entry}`}>{entry}</li>
                ))}
            </ol>
          )}
        </>
      ) : (
        <p className="empty">No tables yet — add one with the + tab.</p>
      )}

      {state.results.length > 0 && (
        <div className="stack tight">
          <div className="toolbar">
            <h4 className="section-title">Rolled</h4>
            <span className="spacer" />
            <button className="btn" onClick={() => setState({ results: [] })}>
              Clear
            </button>
          </div>
          {state.results.map((result, index) => (
            <div key={result.id} className={`result ${index === 0 ? 'latest' : ''}`}>
              <span className="result-table">{result.table}</span>
              <span className="result-text">{result.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TablesSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  return (
    <div className="stack tight">
      <label className="field">
        <span>Keep the last {settings.resultLimit} results</span>
        <input
          type="range"
          min={1}
          max={30}
          value={settings.resultLimit}
          onChange={(event) => setSettings({ resultLimit: Number(event.target.value) })}
        />
      </label>
    </div>
  )
}

export const tablesModule = defineModule<State, Settings>({
  id: 'tables',
  name: 'Random Tables',
  icon: '🗒️',
  blurb: 'Your own roll tables — complications, rumours, loot, whatever you need on tap.',
  category: 'Tools',
  defaultState: () => {
    const tables = starterTables()
    return { tables, activeId: tables[0].id, editingIds: [], results: [] }
  },
  defaultSettings: () => ({ resultLimit: 8 }),
  Component: Tables,
  Settings: TablesSettings
})

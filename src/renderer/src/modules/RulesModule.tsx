import { useDataStore } from '../state/dataStore'
import { defineModule, type ModuleProps } from './types'

interface State {
  activeSection: string
}

interface Settings {
  /** Section ids to show as tabs. Empty means "all of them". */
  hidden: string[]
}

function Rules({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const allSections = useDataStore((store) => store.rules)
  const sections = allSections.filter((section) => !settings.hidden.includes(section.id))
  const active = sections.find((section) => section.id === state.activeSection) ?? sections[0]

  if (!active) {
    return <p className="empty">Every section is hidden. Re-enable one in this panel’s settings.</p>
  }

  return (
    <div className="stack">
      <div className="tabs">
        {sections.map((section) => (
          <button
            key={section.id}
            className={`tab ${section.id === active.id ? 'active' : ''}`}
            onClick={() => setState({ activeSection: section.id })}
          >
            {section.title}
          </button>
        ))}
      </div>

      {active.items && (
        <dl className="deflist">
          {active.items.map((item, index) => (
            <div key={index} className="defrow">
              <dt>{item.term}</dt>
              <dd>{item.text}</dd>
            </div>
          ))}
        </dl>
      )}

      {active.tables?.map((table) => (
        <div key={table.caption ?? table.head.join('|')} className="stack tight">
          {table.caption && <h4 className="section-title">{table.caption}</h4>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {table.head.map((heading) => (
                    <th key={heading}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, index) => (
                      <td key={index}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {active.note && <p className="note">{active.note}</p>}
    </div>
  )
}

function RulesSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  const allSections = useDataStore((store) => store.rules)

  const toggle = (id: string): void =>
    setSettings((prev) => ({
      hidden: prev.hidden.includes(id)
        ? prev.hidden.filter((entry) => entry !== id)
        : [...prev.hidden, id]
    }))

  return (
    <div className="stack tight">
      <p className="note">Choose which reference tabs this panel shows.</p>
      {allSections.map((section) => (
        <label key={section.id} className="check">
          <input
            type="checkbox"
            checked={!settings.hidden.includes(section.id)}
            onChange={() => toggle(section.id)}
          />
          {section.title}
        </label>
      ))}
    </div>
  )
}

export const rulesModule = defineModule<State, Settings>({
  id: 'rules',
  name: 'Rules Reference',
  icon: '📖',
  blurb: 'Actions, cover, vision, DCs, travel, resting and improvised damage.',
  category: 'Reference',
  defaultState: () => ({ activeSection: 'actions' }),
  defaultSettings: () => ({ hidden: [] }),
  Component: Rules,
  Settings: RulesSettings
})

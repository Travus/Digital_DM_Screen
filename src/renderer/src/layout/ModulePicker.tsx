import { useState } from 'react'
import { searchFilter } from '../lib/search'
import { MODULES, MODULE_CATEGORIES } from '../modules/registry'

export function ModulePicker({
  currentModuleId,
  onPick,
  onCancel
}: {
  currentModuleId: string
  onPick: (moduleId: string) => void
  onCancel?: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  // Exact matching keeps both fields — the blurb is how you find "initiative"
  // without knowing the panel is called Initiative Tracker. Typo tolerance is
  // deliberately name-only: blurbs are long enough that a fuzzy pass over them
  // would match almost any query of a useful length.
  const exact = MODULES.filter(
    (module) =>
      !needle ||
      module.name.toLowerCase().includes(needle) ||
      module.blurb.toLowerCase().includes(needle)
  )
  const matches = exact.length > 0 ? exact : searchFilter(query, MODULES, (module) => module.name)

  return (
    <div className="picker">
      <div className="toolbar">
        <input
          className="input grow"
          type="search"
          autoFocus
          placeholder="Search modules…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {MODULE_CATEGORIES.map((category) => {
        const inCategory = matches.filter((module) => module.category === category)
        if (inCategory.length === 0) return null
        return (
          <div key={category} className="picker-group">
            <h4 className="section-title">{category}</h4>
            <div className="picker-grid">
              {inCategory.map((module) => (
                <button
                  key={module.id}
                  data-module-id={module.id}
                  className={`picker-card ${module.id === currentModuleId ? 'current' : ''}`}
                  onClick={() => onPick(module.id)}
                >
                  <span className="picker-icon">{module.icon}</span>
                  <span className="picker-name">{module.name}</span>
                  <span className="picker-blurb">{module.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {matches.length === 0 && <p className="empty">Nothing matches “{query}”.</p>}

      {currentModuleId !== 'empty' && (
        <p className="note warn">
          Switching modules clears this panel’s current contents — its state belongs to the module
          it came from.
        </p>
      )}
    </div>
  )
}

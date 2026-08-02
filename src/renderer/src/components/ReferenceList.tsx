import type { ReferenceEntry } from '../../../shared/types'
import { ConditionText } from './ConditionText'

export type { ReferenceEntry }

interface Props {
  entries: ReferenceEntry[]
  query: string
  onQueryChange: (query: string) => void
  /** Ids exempted from the default expansion state — see `startExpanded`. */
  expanded: string[]
  onToggleExpanded: (id: string) => void
  onResetExpanded: () => void
  startExpanded?: boolean
  showSummaries?: boolean
  favourites?: string[]
  onToggleFavourite?: (id: string) => void
  emptyLabel?: string
  searchPlaceholder?: string
}

/**
 * The searchable, expandable card list shared by the reference panels.
 *
 * Searching expands every match — you searched in order to read them — and
 * leaves the stored expansion state untouched, so clearing the box puts things
 * back exactly as they were.
 */
export function ReferenceList({
  entries,
  query,
  onQueryChange,
  expanded,
  onToggleExpanded,
  onResetExpanded,
  startExpanded = false,
  showSummaries = true,
  favourites,
  onToggleFavourite,
  emptyLabel = 'Nothing matches',
  searchPlaceholder = 'Filter…'
}: Props): JSX.Element {
  const needle = query.trim().toLowerCase()

  // Names only. Searching the body text meant "incapacitated" returned half the
  // list — every condition that merely mentions it — which is noise, not results.
  const matches = needle
    ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : entries

  // Favourites float to the top, otherwise the source order is kept.
  const pinned = favourites?.length ? matches.filter((entry) => favourites.includes(entry.id)) : []
  const rest = pinned.length ? matches.filter((entry) => !favourites?.includes(entry.id)) : matches

  const isOpen = (id: string): boolean => {
    if (needle) return true
    return startExpanded ? !expanded.includes(id) : expanded.includes(id)
  }

  const renderCard = (entry: ReferenceEntry): JSX.Element => {
    const open = isOpen(entry.id)
    const starred = favourites?.includes(entry.id) ?? false

    return (
      <div key={entry.id} className={`card ${open ? 'open' : ''} ${starred ? 'starred' : ''}`}>
        <div className="card-row">
          {onToggleFavourite && (
            <button
              className={`star ${starred ? 'on' : ''}`}
              title={starred ? 'Remove from the top' : 'Pin to the top'}
              onClick={() => onToggleFavourite(entry.id)}
            >
              {starred ? '★' : '☆'}
            </button>
          )}
          <button
            className="card-head"
            disabled={Boolean(needle)}
            onClick={() => onToggleExpanded(entry.id)}
          >
            <span className="card-title">{entry.name}</span>
            {entry.meta && <span className="card-meta">{entry.meta}</span>}
            {showSummaries && !open && <span className="card-sub">{entry.summary}</span>}
            {!needle && <span className="chevron">{open ? '−' : '+'}</span>}
          </button>
        </div>

        {open && (
          <>
            <ul className="bullets">
              {/* Index keys: the list is static per entry, and pack content
                  can legitimately repeat a line. */}
              {entry.lines.map((line, index) => (
                <li key={index}>
                  <ConditionText text={line} exclude={entry.name} />
                </li>
              ))}
            </ul>
            {entry.note && (
              <p className="card-note">
                <ConditionText text={entry.note} exclude={entry.name} />
              </p>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <input
          className="input grow"
          type="search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {needle ? (
          <button className="btn" onClick={() => onQueryChange('')}>
            Clear
          </button>
        ) : (
          <button className="btn" onClick={onResetExpanded} title="Collapse everything">
            Reset
          </button>
        )}
      </div>

      <div className="stack tight">
        {pinned.map(renderCard)}

        {/* Only worth a rule when there is something on both sides of it. */}
        {pinned.length > 0 && rest.length > 0 && <div className="pinned-divider" />}

        {rest.map(renderCard)}

        {pinned.length + rest.length === 0 && (
          <p className="empty">
            {emptyLabel}
            {query ? ` “${query}”.` : '.'}
          </p>
        )}
      </div>
    </div>
  )
}

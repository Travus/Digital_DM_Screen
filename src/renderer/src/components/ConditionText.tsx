import { Fragment, useState, type ReactNode } from 'react'
import type { ReferenceEntry } from '../../../shared/types'
import { useDataStore } from '../state/dataStore'

/**
 * Renders text with any condition it mentions turned into a hover target, so
 * "Paralyzed makes you incapacitated" doesn't send you hunting for what
 * incapacitated means.
 *
 * The pattern and lookup come pre-built from the data store — this renders once
 * per bullet line, so rebuilding a regex here would do it hundreds of times a
 * paint.
 */
export function ConditionText({ text, exclude }: { text: string; exclude?: string }): JSX.Element {
  const { pattern, byLower } = useDataStore((state) => state.conditionIndex)

  if (!pattern) return <>{text}</>

  const parts: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  pattern.lastIndex = 0
  while ((match = pattern.exec(text)) !== null) {
    // `exec` only advances lastIndex past a match with length. Skipping a
    // zero-length one without nudging it would re-match the same position
    // forever, so hold the invariant here rather than trusting the pattern.
    if (match[0].length === 0) {
      pattern.lastIndex += 1
      continue
    }

    const condition = byLower.get(match[0].toLowerCase())
    // Don't link a condition to itself — you're already reading it.
    if (!condition || condition.name.toLowerCase() === exclude?.toLowerCase()) continue

    if (match.index > cursor) parts.push(text.slice(cursor, match.index))
    parts.push(
      <ConditionRef
        key={`${match.index}-${condition.name}`}
        name={condition.name}
        label={match[0]}
      />
    )
    cursor = match.index + match[0].length
  }

  if (cursor < text.length) parts.push(text.slice(cursor))

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  )
}

function ConditionRef({ name, label }: { name: string; label: string }): JSX.Element {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const condition = useDataStore((state) => state.conditionIndex.byLower.get(name.toLowerCase()))
  if (!condition) return <>{label}</>

  const show = (element: HTMLElement): void => setAnchor(element.getBoundingClientRect())

  return (
    <>
      <span
        className="condition-ref"
        tabIndex={0}
        role="button"
        aria-label={`${name} condition`}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setAnchor(null)}
      >
        {label}
      </span>
      {anchor && <ConditionPopover condition={condition} anchor={anchor} />}
    </>
  )
}

const POPOVER_WIDTH = 330

function ConditionPopover({
  condition,
  anchor
}: {
  condition: ReferenceEntry
  anchor: DOMRect
}): JSX.Element {
  // Fixed positioning so the card escapes the panel's own scroll container;
  // flipped above the anchor when there isn't room below.
  const left = Math.max(8, Math.min(window.innerWidth - POPOVER_WIDTH - 8, anchor.left - 8))
  const roomBelow = window.innerHeight - anchor.bottom
  const vertical =
    roomBelow > 220
      ? { top: anchor.bottom + 6 }
      : { bottom: Math.max(8, window.innerHeight - anchor.top + 6) }

  return (
    <span className="condition-pop" style={{ left, width: POPOVER_WIDTH, ...vertical }}>
      <span className="condition-pop-title">{condition.name}</span>
      {/* For a one-effect condition the summary just restates the bullet. */}
      {condition.lines.length > 1 && (
        <span className="condition-pop-summary">{condition.summary}</span>
      )}
      <span className="condition-pop-list">
        {condition.lines.map((line, index) => (
          <span key={index} className="condition-pop-item">
            {line}
          </span>
        ))}
      </span>
    </span>
  )
}

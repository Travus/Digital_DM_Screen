import { Fragment, useState, type ReactNode } from 'react'
import { CONDITIONS, CONDITION_NAMES } from '../data/conditions'

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Longest first so "Incapacitated" wins over any shorter overlapping name. */
const PATTERN = new RegExp(
  `\\b(${[...CONDITION_NAMES].sort((a, b) => b.length - a.length).map(escape).join('|')})\\b`,
  'gi'
)

const BY_LOWER = new Map(CONDITIONS.map((condition) => [condition.name.toLowerCase(), condition]))

/**
 * Renders text with any condition it mentions turned into a hover target, so
 * "Paralyzed makes you incapacitated" doesn't send you hunting for what
 * incapacitated means.
 */
export function ConditionText({ text, exclude }: { text: string; exclude?: string }): JSX.Element {
  const parts: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  PATTERN.lastIndex = 0
  while ((match = PATTERN.exec(text)) !== null) {
    const condition = BY_LOWER.get(match[0].toLowerCase())
    // Don't link a condition to itself — you're already reading it.
    if (!condition || condition.name.toLowerCase() === exclude?.toLowerCase()) continue

    if (match.index > cursor) parts.push(text.slice(cursor, match.index))
    parts.push(
      <ConditionRef key={`${match.index}-${condition.name}`} name={condition.name} label={match[0]} />
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
  const condition = BY_LOWER.get(name.toLowerCase())
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
  condition: (typeof CONDITIONS)[number]
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
      {condition.effects.length > 1 && (
        <span className="condition-pop-summary">{condition.summary}</span>
      )}
      <span className="condition-pop-list">
        {condition.effects.map((effect) => (
          <span key={effect} className="condition-pop-item">
            {effect}
          </span>
        ))}
      </span>
    </span>
  )
}

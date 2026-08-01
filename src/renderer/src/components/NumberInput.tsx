import { useState } from 'react'

interface Props {
  value: number
  onChange: (value: number) => void
  className?: string
  title?: string
  min?: number
  placeholder?: string
}

/** "018" -> "18", "-007" -> "-7". Leaves "0", "" and a lone "-" alone. */
function normalise(raw: string): string {
  const cleaned = raw.replace(/[^\d-]/g, '')
  const negative = cleaned.startsWith('-')
  const digits = cleaned.replace(/-/g, '').replace(/^0+(?=\d)/, '')
  return `${negative ? '-' : ''}${digits}`
}

/**
 * Numeric field for the dense tracker tables.
 *
 * Uses a text input rather than `type="number"` so we control the text
 * exactly: leading zeros are stripped as you type, the field can be emptied
 * and retyped instead of snapping back to "0", and there are no spinner
 * arrows eating horizontal space. Focus selects the contents so typing
 * replaces rather than appends.
 */
export function NumberInput({
  value,
  onChange,
  className = '',
  title,
  min,
  placeholder
}: Props): JSX.Element {
  // While focused the raw text wins, so a half-typed "-" or "" is allowed.
  // Outside of that the stored number is the source of truth.
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      className={className}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      title={title}
      placeholder={placeholder}
      value={draft ?? String(value)}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const next = normalise(event.target.value)
        setDraft(next)
        const parsed = next === '' || next === '-' ? 0 : Number(next)
        if (!Number.isFinite(parsed)) return
        onChange(min !== undefined ? Math.max(min, parsed) : parsed)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

import { useRef, useState, type CSSProperties } from 'react'
import { MarkupText } from './MarkupText'
import { useMarkupKeys } from './markupKeys'

/**
 * A textarea that renders its own bold and italic as you type.
 *
 * The technique is a mirror: a `<div>` holding the same text, styled, sitting
 * exactly under a textarea whose own text is transparent. You see the mirror and
 * you edit the textarea, so undo, spellcheck, selection, IME and the caret are
 * all still the browser's — none of which survives a contentEditable rewrite.
 *
 * What that costs is strict agreement on metrics. Every property affecting where
 * a glyph lands must match between the two boxes: font, size, line height,
 * padding, border width, letter spacing, tab size and how lines wrap. Declare
 * them on `.markup-box`, which both halves carry, and not on the caller's class:
 * a textarea inherits no font, so anything the caller leaves unsaid comes to the
 * mirror from the page and to the textarea from the UA sheet. That is how the
 * two came to stack their lines at different pitches — a small error per line,
 * and a caret a whole line off the glyph by the bottom of a long note.
 *
 * Neither may have a scrollbar the other lacks, for the same reason one rung
 * out: the bar takes width from the content box, and the two then wrap in
 * different places. The mirror is scrolled by hand, so the gutter is reserved on
 * both rather than given to either.
 *
 * **The markers are shown only while the field is focused.** That constraint
 * binds exactly when there is a caret to keep in step, and no longer: unfocused,
 * nothing is being aimed at a character, so the markers can go and the note reads
 * as finished prose — the same bargain a table cell makes. Focused, they come
 * back dimmed, because dropping them there would slide every later character on
 * the line out from under the caret.
 */
export function MarkupTextarea({
  value,
  onChange,
  className = '',
  style,
  placeholder,
  spellCheck
}: {
  value: string
  onChange: (next: string) => void
  className?: string
  style?: CSSProperties
  placeholder?: string
  spellCheck?: boolean
}): JSX.Element {
  const mirrorRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const handleMarkupKeys = useMarkupKeys()

  return (
    <div className="markup-editor">
      <div
        ref={mirrorRef}
        className={`markup-box markup-mirror ${className}`}
        style={style}
        aria-hidden="true"
      >
        <MarkupText text={value} showMarkers={focused} />
        {/* A trailing newline leaves no line box of its own, so the mirror would
            come up one line short and stop scrolling in step near the bottom. */}
        {value.endsWith('\n') && ' '}
      </div>
      <textarea
        className={`markup-box markup-input ${className}`}
        style={style}
        placeholder={placeholder}
        spellCheck={spellCheck}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => handleMarkupKeys(event, value, onChange)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // The mirror has no scrollbar of its own; it is dragged along by hand so
        // the two never disagree about which line is at the top.
        onScroll={(event) => {
          const mirror = mirrorRef.current
          if (!mirror) return
          mirror.scrollTop = event.currentTarget.scrollTop
          mirror.scrollLeft = event.currentTarget.scrollLeft
        }}
      />
    </div>
  )
}

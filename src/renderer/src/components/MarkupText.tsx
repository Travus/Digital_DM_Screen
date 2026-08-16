import { parseMarkup } from '../lib/markup'

/**
 * Draws `**bold**` and `*italic*` as formatting.
 *
 * `showMarkers` is the whole difference between the two places this is used.
 * A table cell hides the markers, because nothing sits under it and the text
 * should read as a finished table. The Notes mirror keeps them, dimmed: it lies
 * exactly beneath a live caret, so every character the textarea holds must
 * occupy the same width here or the caret drifts further out of place with each
 * one that is missing.
 */
export function MarkupText({
  text,
  showMarkers = false
}: {
  text: string
  showMarkers?: boolean
}): JSX.Element {
  return (
    <>
      {parseMarkup(text).map((span, index) => {
        if (span.marker && !showMarkers) return null

        const classes = [
          span.bold ? 'mk-b' : '',
          span.italic ? 'mk-i' : '',
          span.marker ? 'mk-mark' : ''
        ]
          .filter(Boolean)
          .join(' ')

        // Plain runs still need an element — a bare string would lose the class
        // that keeps the mirror's whitespace handling identical to the textarea.
        return (
          <span key={index} className={classes || undefined}>
            {span.text}
          </span>
        )
      })}
    </>
  )
}

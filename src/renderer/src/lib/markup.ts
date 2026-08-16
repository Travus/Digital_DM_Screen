/**
 * Inline bold and italic for the Table and Notes modules.
 *
 * Markdown's markers are the whole format: `**bold**`, `*italic*`, nested
 * freely. Nothing else is supported — no headings, links or code — because the
 * point is emphasis inside a table cell, not a document.
 *
 * Markers stay in the stored string rather than the state becoming HTML. A
 * `.dmscreen` file is meant to be readable, a cell is meant to survive being
 * copied into any other program as text, and keeping the source plain is what
 * lets the Notes editor be a real `<textarea>` with native undo and spellcheck.
 *
 * So the rendering surfaces differ in one detail only: the Notes mirror draws
 * the markers dimmed because it sits under a live caret and must match the
 * textarea character for character, while a table cell drops them entirely.
 * `parseMarkup` therefore returns spans covering *every* character, each
 * flagged as marker or content, and the caller decides which to draw.
 */

export interface MarkupSpan {
  text: string
  bold: boolean
  italic: boolean
  /** True for the `*` runs themselves, which a cell hides and the mirror dims. */
  marker: boolean
}

/**
 * Cheap pre-test so callers can skip the overlay entirely for ordinary text.
 * Only ever a hint — text containing a lone `*` parses to a single plain span,
 * which renders identically to no overlay at all.
 */
export function hasMarkup(text: string): boolean {
  return text.includes('*')
}

/** How many stars start at `index`. */
function runLength(text: string, index: number): number {
  let length = 0
  while (text[index + length] === '*') length++
  return length
}

/**
 * Finds the closing run for one of `length` stars.
 *
 * Matching whole *runs* rather than individual characters is what keeps the
 * three widths apart. Scanning character by character, a single `*` would close
 * against the first half of a `**`, and `***both***` would open bold, close on
 * the leading two stars of the trailing run and orphan the third.
 */
function findCloseRun(text: string, from: number, length: number): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] !== '*') continue
    const run = runLength(text, index)
    if (run === length) return index
    // Step over the whole run, so a wider one is never entered half way.
    index += run - 1
  }
  return -1
}

function walk(text: string, bold: boolean, italic: boolean, out: MarkupSpan[]): void {
  let plainFrom = 0
  let cursor = 0

  const flush = (until: number): void => {
    if (until > plainFrom) {
      out.push({ text: text.slice(plainFrom, until), bold, italic, marker: false })
    }
  }

  while (cursor < text.length) {
    if (text[cursor] !== '*') {
      cursor++
      continue
    }

    const length = runLength(text, cursor)
    const openEnd = cursor + length
    const close = findCloseRun(text, openEnd, length)

    // An unpaired run is literal text — a DM writing "2 * 3" gets "2 * 3".
    if (close === -1) {
      cursor = openEnd
      continue
    }

    const marker = text.slice(cursor, openEnd)
    flush(cursor)
    out.push({ text: marker, bold, italic, marker: true })
    // One star is italic, two are bold, three or more are both.
    walk(text.slice(openEnd, close), length === 1 ? bold : true, length === 2 ? italic : true, out)
    out.push({ text: marker, bold, italic, marker: true })
    cursor = close + length
    plainFrom = cursor
  }

  flush(text.length)
}

/**
 * Splits `text` into styled spans. The spans always concatenate back to the
 * input exactly — the mirror overlay depends on that, because a single dropped
 * character would put every line after it out of step with the caret.
 */
export function parseMarkup(text: string): MarkupSpan[] {
  const spans: MarkupSpan[] = []
  walk(text, false, false, spans)
  return spans
}

/** The text with every marker removed, for anywhere that needs it plain. */
export function stripMarkup(text: string): string {
  return parseMarkup(text)
    .filter((span) => !span.marker)
    .map((span) => span.text)
    .join('')
}

export type Mark = 'bold' | 'italic'

const MARKER: Record<Mark, string> = { bold: '**', italic: '*' }

export interface MarkResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

/**
 * What Ctrl+B and Ctrl+I do to a selection.
 *
 * Toggling off is checked in two places because both read as "this is already
 * bold" to whoever pressed the key: markers sitting just outside the selection
 * (you dragged over the word) and markers inside it (you dragged over the
 * markers too). Returning the new caret range rather than just the string is
 * what lets the caller put the selection back after React re-renders.
 */
export function toggleMark(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  mark: Mark
): MarkResult {
  const marker = MARKER[mark]
  const width = marker.length
  const start = Math.min(selectionStart, selectionEnd)
  const end = Math.max(selectionStart, selectionEnd)
  const selected = text.slice(start, end)

  // Wrapped from outside: **|word|**
  if (
    start >= width &&
    text.slice(start - width, start) === marker &&
    text.slice(end, end + width) === marker
  ) {
    return {
      text: text.slice(0, start - width) + selected + text.slice(end + width),
      selectionStart: start - width,
      selectionEnd: end - width
    }
  }

  // Wrapped from inside: |**word**|
  if (selected.length >= width * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(width, -width)
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length
    }
  }

  // Nothing selected: leave the caret between the markers, ready to type.
  if (start === end) {
    return {
      text: text.slice(0, start) + marker + marker + text.slice(start),
      selectionStart: start + width,
      selectionEnd: start + width
    }
  }

  return {
    text: text.slice(0, start) + marker + selected + marker + text.slice(end),
    selectionStart: start + width,
    selectionEnd: end + width
  }
}

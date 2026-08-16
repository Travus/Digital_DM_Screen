/**
 * Rectangular cell selection and the clipboard format behind it.
 *
 * Tab-separated values, because that is what a spreadsheet puts on the
 * clipboard and what it expects to find there. Copying a block of cells out to
 * Excel, Sheets or another Table panel is the whole point, so the format is not
 * ours to choose.
 *
 * All of it is pure so the module above it stays a view: a range is two corners
 * and some arithmetic, and TSV is a parser.
 */

export interface CellRef {
  row: number
  column: number
}

export interface CellRange {
  top: number
  left: number
  bottom: number
  right: number
}

/**
 * The rectangle two corners describe. Selections are dragged in any direction,
 * so the anchor is not reliably the top-left one.
 */
export function rangeOf(anchor: CellRef, focus: CellRef): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.column, focus.column)
  }
}

export function rangeContains(range: CellRange, row: number, column: number): boolean {
  return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right
}

/** A range covering one cell is not a selection worth intercepting the clipboard for. */
export function rangeSize(range: CellRange): number {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1)
}

/**
 * A cell needs quoting only for a tab or a quote. It can never hold a newline:
 * cells are single-line inputs, and `parseGrid` folds any pasted break into a
 * space rather than letting one row silently become two.
 */
function quoteCell(value: string): string {
  return /[\t"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.map(quoteCell).join('\t')).join('\n')
}

/**
 * Reads TSV into a rectangle, padding short rows so callers never index into a
 * hole. Quoted fields are understood because a spreadsheet emits them for any
 * cell holding a tab or a line break, and treating those quotes as literal text
 * would split one cell across several.
 */
export function parseGrid(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let index = 0

  const endCell = (): void => {
    // Cells are single-line, so a break carried in by a quoted field becomes a
    // space. Growing the grid downwards instead would misalign every later row.
    row.push(cell.replace(/\r?\n/g, ' '))
    cell = ''
  }
  const endRow = (): void => {
    endCell()
    rows.push(row)
    row = []
  }

  while (index < text.length) {
    const char = text[index]

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 2
          continue
        }
        quoted = false
        index++
        continue
      }
      cell += char
      index++
      continue
    }

    if (char === '"' && cell === '') {
      quoted = true
      index++
      continue
    }
    if (char === '\t') {
      endCell()
      index++
      continue
    }
    if (char === '\n' || char === '\r') {
      endRow()
      // Consume the second half of a CRLF so it does not open an empty row.
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1
      continue
    }

    cell += char
    index++
  }

  // A trailing newline ends the last row rather than starting an empty one.
  if (cell !== '' || row.length > 0) endRow()

  const width = rows.reduce((widest, entry) => Math.max(widest, entry.length), 0)
  return rows.map((entry) => {
    const padded = [...entry]
    while (padded.length < width) padded.push('')
    return padded
  })
}

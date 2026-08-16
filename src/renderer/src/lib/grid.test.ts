import { describe, expect, it } from 'vitest'
import { parseGrid, rangeContains, rangeOf, rangeSize, toTsv } from './grid'

describe('rangeOf', () => {
  it('normalises a rectangle dragged in any direction', () => {
    const wanted = { top: 1, left: 2, bottom: 3, right: 4 }
    expect(rangeOf({ row: 1, column: 2 }, { row: 3, column: 4 })).toEqual(wanted)
    expect(rangeOf({ row: 3, column: 4 }, { row: 1, column: 2 })).toEqual(wanted)
    // Dragged up-and-right: neither corner is the top-left one.
    expect(rangeOf({ row: 3, column: 2 }, { row: 1, column: 4 })).toEqual(wanted)
  })

  it('reports membership and size', () => {
    const range = rangeOf({ row: 1, column: 1 }, { row: 2, column: 3 })
    expect(rangeSize(range)).toBe(6)
    expect(rangeContains(range, 1, 2)).toBe(true)
    expect(rangeContains(range, 0, 2)).toBe(false)
    expect(rangeContains(range, 2, 4)).toBe(false)
    expect(rangeSize(rangeOf({ row: 0, column: 0 }, { row: 0, column: 0 }))).toBe(1)
  })
})

describe('parseGrid', () => {
  it('reads tabs as columns and newlines as rows', () => {
    expect(parseGrid('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })

  it('accepts CRLF without opening an empty row', () => {
    expect(parseGrid('a\tb\r\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })

  it('ignores a trailing newline', () => {
    expect(parseGrid('a\tb\n')).toEqual([['a', 'b']])
  })

  it('pads short rows so callers never index into a hole', () => {
    expect(parseGrid('a\tb\tc\nd')).toEqual([
      ['a', 'b', 'c'],
      ['d', '', '']
    ])
  })

  it('keeps empty cells', () => {
    expect(parseGrid('a\t\tc')).toEqual([['a', '', 'c']])
  })

  it('unwraps a quoted field holding a tab', () => {
    expect(parseGrid('"a\tb"\tc')).toEqual([['a\tb', 'c']])
  })

  it('reads a doubled quote as one literal quote', () => {
    expect(parseGrid('"say ""hi"""\tb')).toEqual([['say "hi"', 'b']])
  })

  it('folds a break inside a quoted field into a space', () => {
    // Growing the grid downwards instead would misalign every later row.
    expect(parseGrid('"two\nlines"\tb\nc\td')).toEqual([
      ['two lines', 'b'],
      ['c', 'd']
    ])
  })

  it('returns nothing for empty input', () => {
    expect(parseGrid('')).toEqual([])
  })
})

describe('toTsv', () => {
  it('joins with tabs and newlines', () => {
    expect(
      toTsv([
        ['a', 'b'],
        ['c', 'd']
      ])
    ).toBe('a\tb\nc\td')
  })

  it('quotes only what would otherwise reparse wrongly', () => {
    expect(toTsv([['plain', 'has\ttab', 'has"quote']])).toBe('plain\t"has\ttab"\t"has""quote"')
  })

  it('round-trips through parseGrid', () => {
    const rows = [
      ['**bold**', 'has\ttab'],
      ['has"quote', '']
    ]
    expect(parseGrid(toTsv(rows))).toEqual(rows)
  })
})

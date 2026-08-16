import { describe, expect, it } from 'vitest'
import { hasMarkup, parseMarkup, stripMarkup, toggleMark } from './markup'

/** What the mirror overlay draws, marker characters included. */
const shape = (text: string): string =>
  parseMarkup(text)
    .map((span) => {
      if (span.marker) return `[${span.text}]`
      const style = `${span.bold ? 'b' : ''}${span.italic ? 'i' : ''}`
      return style ? `${style}(${span.text})` : span.text
    })
    .join('')

describe('parsing emphasis', () => {
  it('reads bold and italic, and nests them', () => {
    expect(shape('a **b** c')).toBe('a [**]b(b)[**] c')
    expect(shape('a *b* c')).toBe('a [*]i(b)[*] c')
    expect(shape('**a *b* c**')).toBe('[**]b(a )[*]bi(b)[*]b( c)[**]')
  })

  it('matches runs by width, so a marker never closes on half of a wider one', () => {
    // The bug this guards: `**bold**` parsed as italic-`*bold*` plus stray stars.
    expect(shape('**bold**')).toBe('[**]b(bold)[**]')
    // Three stars are bold and italic at once, and must consume all three.
    expect(shape('***both***')).toBe('[***]bi(both)[***]')
    // A run of two inside a run of one is not a closer.
    expect(shape('*a ** b*')).toBe('[*]i(a ** b)[*]')
  })

  it('leaves an unpaired run as literal text', () => {
    expect(shape('2 * 3 = 6')).toBe('2 * 3 = 6')
    expect(shape('**unclosed')).toBe('**unclosed')
    expect(shape('a * b ** c')).toBe('a * b ** c')
    expect(shape('****')).toBe('****')
    expect(shape('**')).toBe('**')
  })
})

describe('spans reconstruct the input', () => {
  // The mirror sits under a live caret, so one dropped character would put
  // every following line out of step with the textarea.
  const samples = [
    '',
    'plain text',
    '**bold**',
    '*italic*',
    '***both*** and **more**',
    '2 * 3 ** 4',
    'trailing **',
    'a\nb **c**',
    '**a *b* c** d'
  ]

  it.each(samples)('round-trips %j', (text) => {
    expect(
      parseMarkup(text)
        .map((span) => span.text)
        .join('')
    ).toBe(text)
  })
})

describe('stripMarkup', () => {
  it('drops markers and keeps content', () => {
    expect(stripMarkup('**Sera** owes *120 gp*')).toBe('Sera owes 120 gp')
    expect(stripMarkup('2 * 3')).toBe('2 * 3')
  })
})

describe('hasMarkup', () => {
  it('is a hint, not a verdict', () => {
    expect(hasMarkup('plain')).toBe(false)
    expect(hasMarkup('**bold**')).toBe(true)
    // A lone star has none, but claiming otherwise only costs a no-op overlay.
    expect(hasMarkup('2 * 3')).toBe(true)
  })
})

describe('toggleMark', () => {
  const bold = (text: string, start: number, end: number) => toggleMark(text, start, end, 'bold')

  it('wraps a selection and keeps it over the same characters', () => {
    const result = bold('the duke lies', 4, 8)
    expect(result.text).toBe('the **duke** lies')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('duke')
  })

  it('unwraps when the markers sit just outside the selection', () => {
    const result = bold('the **duke** lies', 6, 10)
    expect(result.text).toBe('the duke lies')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('duke')
  })

  it('unwraps when the selection swallowed the markers too', () => {
    const result = bold('the **duke** lies', 4, 12)
    expect(result.text).toBe('the duke lies')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('duke')
  })

  it('opens an empty pair and parks the caret inside it', () => {
    const result = bold('ab', 1, 1)
    expect(result.text).toBe('a****b')
    expect(result.selectionStart).toBe(3)
    expect(result.selectionEnd).toBe(3)
  })

  it('accepts a backwards selection', () => {
    expect(bold('the duke lies', 8, 4).text).toBe('the **duke** lies')
  })

  it('toggles italic on its own marker width', () => {
    const on = toggleMark('a word b', 2, 6, 'italic')
    expect(on.text).toBe('a *word* b')
    expect(toggleMark(on.text, on.selectionStart, on.selectionEnd, 'italic').text).toBe('a word b')
  })

  it('leaves bold alone when italic is toggled off inside it', () => {
    // `**a *b* c**` — dropping the italic must not disturb the bold markers.
    const result = toggleMark('**a *b* c**', 5, 6, 'italic')
    expect(result.text).toBe('**a b c**')
  })
})

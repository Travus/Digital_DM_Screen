/**
 * The expression language: dice groups, arithmetic over them, and brackets.
 *
 * One parser, shared by the Dice Roller module and the action palette, for the
 * same reason there is one accelerator catalogue — a second copy drifts, and
 * this drift would read as the same expression giving different answers
 * depending on which box it was typed into.
 *
 * Recursive descent rather than a regex over terms, because precedence and
 * brackets are exactly what a regex cannot carry. The scanner this replaced read
 * a flat list of signed terms, so `2 * 3` was not arithmetic it got wrong, it
 * was arithmetic it refused.
 *
 * Anything it cannot consume whole comes back as null rather than as a partial
 * roll, so a caller can show the input as invalid. Rolling `2d6+3` out of
 * `2d6 foo 3` would be answering a question nobody asked.
 */

export interface RollResult {
  total: number
  /** Human-readable trace, e.g. "2d6 [4, 5] + 3". */
  breakdown: string
  expression: string
  /**
   * Whether any dice were thrown. Arithmetic gives the same answer every time,
   * so anything offering to roll again has to know whether there is one — and
   * the breakdown of a dice-free expression is the expression, which is not
   * worth showing twice.
   */
  dice: boolean
}

export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1
}

export function randomOf<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

const MAX_DICE = 1000
const MAX_SIDES = 10000
/** Above this many dice, the breakdown lists a summary instead of every face. */
const BREAKDOWN_LIMIT = 30
/**
 * How deep brackets may nest. The palette parses on every keystroke, so a pasted
 * line of a thousand open brackets would otherwise recurse until the stack gave
 * out — a crash, where every other unreadable input is a null.
 */
const MAX_DEPTH = 32

/** A number, read where the scanner stands rather than anywhere after it. */
const NUMBER = /\d+(?:\.\d+)?/y

/** The suffixes naming dice to keep, and the ones naming dice to throw away. */
const KEEP_MODES = ['kh', 'kl', 'dh', 'dl']

/**
 * The alphabet the grammar uses, kept beside the grammar itself. `dkhl` are in
 * it because `4d6kh3` is spelt out of them; no other letter is.
 */
const EXPRESSION_CHARS = /^[\d\s+\-*/().dkhlDKHL]+$/

/**
 * Whether `input` is aimed at the calculator at all — cheap, and throws no dice.
 *
 * A digit is required, so `data` and `all` stay ordinary words rather than
 * becoming half-typed sums. It is deliberately looser than the parser: `2d6+` is
 * not an expression yet but it is plainly on its way to being one, and a caller
 * that fell back to searching command names halfway through typing one would
 * flicker between two kinds of answer.
 */
export function looksLikeExpression(input: string): boolean {
  const text = input.trim()
  return text !== '' && /\d/.test(text) && EXPRESSION_CHARS.test(text)
}

/**
 * A total as a person would write it. Division is the only thing here that can
 * produce a fraction, and binary floating point produces the whole of one —
 * `10 / 3` is 3.3333333333333335, which is not an answer to read out at a table.
 */
export function formatTotal(total: number): string {
  return String(Math.round(total * 1e4) / 1e4)
}

/** Thrown while parsing; `rollExpression` turns it into the null callers see. */
class Invalid extends Error {}

interface Parsed {
  value: number
  /** The same expression with every dice group replaced by the faces it rolled. */
  text: string
}

/**
 * Parses and evaluates expressions like `2d6+3`, `d20`, `4d6kh3`, `(1d8 + 2) * 2`.
 *
 * Returns null for anything it cannot fully consume — including a division that
 * comes out infinite, which is a question with no answer rather than an answer
 * of `Infinity`.
 */
export function rollExpression(input: string): RollResult | null {
  const expression = input.trim()
  if (!expression) return null

  let at = 0
  let depth = 0
  let dice = false

  function fail(): never {
    throw new Invalid()
  }

  function skip(): void {
    while (at < expression.length && /\s/.test(expression[at])) at += 1
  }

  /** The next meaningful character, with any run of spaces before it stepped over. */
  function peek(): string {
    skip()
    return expression[at] ?? ''
  }

  /** A number where the scanner stands, or null. Never skips space: `2 d6` is not `2d6`. */
  function number(): string | null {
    NUMBER.lastIndex = at
    const match = NUMBER.exec(expression)
    if (!match) return null
    at = NUMBER.lastIndex
    return match[0]
  }

  /** Counts, sides and keep amounts are whole dice, so `1.5d6` is not a roll. */
  function whole(raw: string): number {
    const value = Number(raw)
    if (!Number.isInteger(value)) fail()
    return value
  }

  /** One dice group, the `d` already eaten and the count read off before it. */
  function group(countRaw: string | null): Parsed {
    const sidesRaw = number()
    if (sidesRaw === null) fail()
    const count = countRaw === null ? 1 : whole(countRaw)
    const sides = whole(sidesRaw)
    if (count < 1 || count > MAX_DICE || sides < 1 || sides > MAX_SIDES) fail()

    const rolls = Array.from({ length: count }, () => rollDie(sides))
    let kept = rolls
    let modeLabel = ''

    const mode = expression.slice(at, at + 2).toLowerCase()
    if (KEEP_MODES.includes(mode)) {
      at += 2
      const amountRaw = number()
      // `kh` on its own keeps one, and no suffix can name more dice than were
      // thrown or fewer than one.
      const asked = amountRaw === null ? 1 : whole(amountRaw)
      const amount = Math.min(Math.max(asked, 1), count)
      // kh/kl name the dice to keep; dh/dl name the dice to throw away.
      const keepCount = mode === 'kh' || mode === 'kl' ? amount : count - amount
      // Sort so the dice we want are at the front, then take keepCount of them.
      const highestFirst = mode === 'kh' || mode === 'dl'
      const sorted = [...rolls].sort((a, b) => (highestFirst ? b - a : a - b))
      kept = sorted.slice(0, keepCount)
      modeLabel = `${mode}${amount}`
    }

    dice = true

    // Listing 250 faces helps nobody; summarise past a readable handful.
    const detail =
      rolls.length > BREAKDOWN_LIMIT
        ? `[${rolls.slice(0, BREAKDOWN_LIMIT).join(', ')}, +${rolls.length - BREAKDOWN_LIMIT} more]`
        : `[${rolls.join(', ')}]`

    return {
      value: kept.reduce((sum, value) => sum + value, 0),
      text: `${count}d${sides}${modeLabel} ${detail}`
    }
  }

  /** A bracketed expression, a dice group, or a plain number. */
  function primary(): Parsed {
    if (peek() === '(') {
      at += 1
      if (depth >= MAX_DEPTH) fail()
      depth += 1
      const inner = sum()
      depth -= 1
      if (peek() !== ')') fail()
      at += 1
      return { value: inner.value, text: `(${inner.text})` }
    }

    skip()
    const lead = number()
    // Read adjacently on purpose: a count belongs to the `d` it is written
    // against, so `2 d6` is two things rather than one roll.
    const letter = expression[at]?.toLowerCase()
    if (letter === 'd') {
      at += 1
      return group(lead)
    }
    if (lead === null) fail()
    return { value: Number(lead), text: String(Number(lead)) }
  }

  /** A sign in front of a value. `+5` is `5`, so it leaves no mark on the trace. */
  function unary(): Parsed {
    const sign = peek()
    if (sign === '-') {
      at += 1
      const operand = unary()
      return { value: -operand.value, text: `-${operand.text}` }
    }
    if (sign === '+') {
      at += 1
      return unary()
    }
    return primary()
  }

  function product(): Parsed {
    let left = unary()
    for (;;) {
      const operator = peek()
      if (operator !== '*' && operator !== '/') return left
      at += 1
      const right = unary()
      left = {
        value: operator === '*' ? left.value * right.value : left.value / right.value,
        text: `${left.text} ${operator} ${right.text}`
      }
    }
  }

  function sum(): Parsed {
    let left = product()
    for (;;) {
      const operator = peek()
      if (operator !== '+' && operator !== '-') return left
      at += 1
      const right = product()
      left = {
        value: operator === '+' ? left.value + right.value : left.value - right.value,
        text: `${left.text} ${operator} ${right.text}`
      }
    }
  }

  try {
    const root = sum()
    skip()
    // Anything left over is rubbish the grammar could not place. A partial parse
    // is the one failure worth more than a wrong answer, because nothing on
    // screen would say which half of the input was read.
    if (at < expression.length) return null
    if (!Number.isFinite(root.value)) return null
    return { total: root.value, breakdown: root.text, expression, dice }
  } catch (error) {
    if (error instanceof Invalid) return null
    throw error
  }
}

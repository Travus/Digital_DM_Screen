export interface RollResult {
  total: number
  /** Human-readable trace, e.g. "2d6 [4, 5] + 3". */
  breakdown: string
  expression: string
}

export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1
}

export function randomOf<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/**
 * Matches one term of a dice expression: an optional sign, then either a dice
 * group (`3d8`, `d20`, `2d20kh1`, `4d6dl1`) or a flat modifier.
 */
const TERM = /([+-])?\s*(?:(\d*)d(\d+)((?:kh|kl|dh|dl)\d*)?|(\d+))/gi

const MAX_DICE = 1000
const MAX_SIDES = 10000
/** Above this many dice, the breakdown lists a summary instead of every face. */
const BREAKDOWN_LIMIT = 30

/**
 * Parses and rolls expressions like `2d6+3`, `d20`, `4d6kh3`, `1d8 + 2d4 - 1`.
 * Returns null for anything it cannot fully consume, so callers can show the
 * input as invalid rather than silently rolling something unexpected.
 */
export function rollExpression(input: string): RollResult | null {
  const expression = input.trim()
  if (!expression) return null

  TERM.lastIndex = 0
  let total = 0
  const parts: string[] = []
  let consumed = 0
  let match: RegExpExecArray | null

  while ((match = TERM.exec(expression)) !== null) {
    const [raw, sign, countRaw, sidesRaw, keepRaw, flatRaw] = match
    // Reject stray characters between terms (e.g. "2d6 foo 3").
    if (expression.slice(consumed, match.index).trim() !== '') return null
    consumed = match.index + raw.length

    const negative = sign === '-'
    const signLabel = parts.length === 0 ? (negative ? '-' : '') : negative ? ' - ' : ' + '

    if (flatRaw !== undefined) {
      const value = Number(flatRaw)
      total += negative ? -value : value
      parts.push(`${signLabel}${value}`)
      continue
    }

    const count = countRaw ? Number(countRaw) : 1
    const sides = Number(sidesRaw)
    if (count < 1 || count > MAX_DICE || sides < 1 || sides > MAX_SIDES) return null

    const rolls = Array.from({ length: count }, () => rollDie(sides))
    let kept = rolls
    let modeLabel = ''

    if (keepRaw) {
      const mode = keepRaw.slice(0, 2).toLowerCase()
      const amount = Math.min(Number(keepRaw.slice(2) || 1) || 1, count)
      // kh/kl name the dice to keep; dh/dl name the dice to throw away.
      const keepCount = mode === 'kh' || mode === 'kl' ? amount : count - amount
      // Sort so the dice we want are at the front, then take keepCount of them.
      const highestFirst = mode === 'kh' || mode === 'dl'
      const sorted = [...rolls].sort((a, b) => (highestFirst ? b - a : a - b))
      kept = sorted.slice(0, keepCount)
      modeLabel = `${mode}${amount}`
    }

    const subtotal = kept.reduce((sum, value) => sum + value, 0)
    total += negative ? -subtotal : subtotal

    // Listing 250 faces helps nobody; summarise past a readable handful.
    const detail =
      rolls.length > BREAKDOWN_LIMIT
        ? `[${rolls.slice(0, BREAKDOWN_LIMIT).join(', ')}, +${rolls.length - BREAKDOWN_LIMIT} more]`
        : `[${rolls.join(', ')}]`
    parts.push(`${signLabel}${count}d${sides}${modeLabel} ${detail}`)
  }

  if (parts.length === 0) return null
  if (expression.slice(consumed).trim() !== '') return null

  return { total, breakdown: parts.join(''), expression }
}

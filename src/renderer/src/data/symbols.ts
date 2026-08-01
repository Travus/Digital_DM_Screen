/**
 * Palette offered when configuring a "symbols" column. Plain glyphs come first
 * because they render in any text font and stay crisp at small sizes; the emoji
 * groups follow for when you want the column to read at a glance.
 *
 * Not exhaustive — the settings panel also takes any character you type.
 */
export const SYMBOL_GROUPS: { label: string; symbols: string[]; plain?: boolean }[] = [
  {
    label: 'Marks',
    plain: true,
    symbols: ['★', '☆', '●', '○', '◆', '◇', '▲', '■', '✦', '✚', '✕', '❖']
  },
  {
    label: 'Blessings & magic',
    symbols: ['✨', '🔮', '🕯️', '📜', '⭐', '🌙', '☀️', '🪶']
  },
  {
    label: 'Harm & danger',
    symbols: ['💀', '🩸', '🔥', '❄️', '⚡', '☠️', '🕸️', '⛓️']
  },
  {
    label: 'Gear & resources',
    symbols: ['🛡️', '⚔️', '🏹', '🧪', '🗝️', '💰', '🍀', '❤️']
  }
]

/**
 * Symbols that are plain text glyphs rather than emoji — styled differently.
 *
 * Derived from the `plain` flag rather than from a position or a label: this was
 * `SYMBOL_GROUPS[0].symbols`, which would have silently misclassified every glyph
 * the moment a group was reordered or another added above it.
 */
const PLAIN = new Set(SYMBOL_GROUPS.filter((group) => group.plain).flatMap((group) => group.symbols))

export function isPlainGlyph(symbol: string): boolean {
  return PLAIN.has(symbol)
}

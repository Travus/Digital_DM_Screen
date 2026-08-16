/**
 * Accelerator strings: parsing, validation and the rules about what a user is
 * allowed to bind.
 *
 * Shared rather than renderer-only because both ends need it for different
 * reasons. The renderer validates before saving, so the editor can say why a
 * chord was refused. The main process validates before building the menu, and
 * that one is not cosmetic: `Menu.buildFromTemplate` throws on a malformed
 * accelerator, which would leave the app with no menu at all — and therefore no
 * route back to the editor to undo it. Anything unparseable is dropped on read.
 *
 * No DOM here. `acceleratorFromChord` takes the four modifier flags and a
 * `KeyboardEvent.code` structurally, so a real event satisfies it and a test can
 * pass a plain object.
 */

/** Canonical modifier spellings, in the order they are emitted. */
const MODIFIER_ORDER = ['Super', 'CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'AltGr', 'Shift'] as const

type Modifier = (typeof MODIFIER_ORDER)[number]

const MODIFIER_ALIASES: Record<string, Modifier> = {
  command: 'Cmd',
  cmd: 'Cmd',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  commandorcontrol: 'CmdOrCtrl',
  cmdorctrl: 'CmdOrCtrl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super'
}

/**
 * Modifiers that make a chord safe to bind. Shift is excluded on purpose:
 * Shift+A is just a capital A, so allowing it would fire commands from ordinary
 * typing.
 */
const REAL_MODIFIERS: readonly Modifier[] = ['Super', 'CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'AltGr']

/**
 * Keys safe to bind without a real modifier, because typing cannot produce
 * them: the function keys — F2 renames the layout today — and Escape, which
 * types no character, so Zed's `Shift+Escape` zoom cannot fire mid-word the
 * way `Shift+A` would. Bare Escape never gets this far — it is reserved before
 * the modifier check runs. The other named keys stay behind a modifier on
 * purpose: `Shift+Home` is selection and `Shift+Tab` is navigation, which a
 * binding would steal from every text field.
 */
const safeWithoutModifier = (key: string): boolean =>
  key === 'Escape' || /^F([1-9]|1\d|2[0-4])$/.test(key)

const NAMED_KEYS = [
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'PrintScreen',
  'Plus'
] as const

const PUNCTUATION = `~!@#$%^&*()_+-=[]{}\\|;:'",.<>/?\``

/** `Return` and `Esc` are Electron aliases; fold them so equality is reliable. */
const KEY_ALIASES: Record<string, string> = { return: 'Enter', esc: 'Escape' }

export interface ParsedAccelerator {
  modifiers: Modifier[]
  key: string
}

function canonicalKey(raw: string): string | null {
  const lower = raw.toLowerCase()
  const aliased = KEY_ALIASES[lower]
  if (aliased) return aliased

  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase()
  if (/^num[0-9]$/.test(lower)) return lower
  if (['numdec', 'numadd', 'numsub', 'nummult', 'numdiv'].includes(lower)) return lower
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase()

  const named = NAMED_KEYS.find((name) => name.toLowerCase() === lower)
  if (named) return named

  if (raw.length === 1 && PUNCTUATION.includes(raw)) return raw

  return null
}

export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  if (!accelerator) return null

  // Split on '+' but never on a trailing '+' that *is* the key — `Ctrl++` is
  // legal, and naive splitting turns its key into an empty string.
  const parts: string[] = []
  let current = ''
  for (const character of accelerator) {
    if (character === '+' && current) {
      parts.push(current)
      current = ''
    } else {
      current += character
    }
  }
  if (current) parts.push(current)
  if (parts.length === 0) return null

  const keyPart = parts.pop()
  if (keyPart === undefined) return null

  const key = canonicalKey(keyPart)
  if (!key) return null

  const modifiers: Modifier[] = []
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (!modifier) return null
    if (!modifiers.includes(modifier)) modifiers.push(modifier)
  }

  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
  return { modifiers, key }
}

/** Re-emits a parsed chord in canonical spelling and order. */
export function formatParsed(parsed: ParsedAccelerator): string {
  return [...parsed.modifiers, parsed.key].join('+')
}

/**
 * Canonical form, or null if it does not parse. Two accelerators mean the same
 * chord exactly when their normalised forms are equal, which is what conflict
 * detection compares.
 */
export function normaliseAccelerator(accelerator: string): string | null {
  const parsed = parseAccelerator(accelerator)
  return parsed ? formatParsed(parsed) : null
}

/**
 * Chords the user may not take.
 *
 * The Edit-menu roles are not decoration: on macOS they are the only reason
 * Cmd+C/V/X/A/Z work in a text field at all, because the OS routes those through
 * the menu. Shadowing one kills copy and paste app-wide.
 *
 * Bare Escape is reserved — it is fixed to `panel:restore` (see actions.ts) and
 * `App.tsx`'s dismiss chain owns it outright. A *modified* Escape (Ctrl+Escape,
 * Alt+Shift+Escape, ...) is a different chord and is free to bind: App.tsx's
 * handler now ignores any keypress that carries a modifier.
 */
/**
 * Bare Escape only. `App.tsx` makes the same distinction on the event side, and
 * the two have to agree: anything this says is bindable must actually reach a
 * dispatcher there.
 */
function isBareEscape(parsed: ParsedAccelerator): boolean {
  return parsed.key === 'Escape' && parsed.modifiers.length === 0
}

const RESERVED_CHORDS: readonly string[] = [
  'CmdOrCtrl+C',
  'CmdOrCtrl+V',
  'CmdOrCtrl+X',
  'CmdOrCtrl+A',
  'CmdOrCtrl+Z',
  'CmdOrCtrl+Shift+Z',
  'CmdOrCtrl+Y',
  'CmdOrCtrl+Q'
]

const RESERVED = new Set(
  RESERVED_CHORDS.flatMap((chord) => {
    // Stored as CmdOrCtrl, but a user recording on macOS produces Cmd and on
    // Windows Ctrl. All three spellings have to be caught.
    const normalised = normaliseAccelerator(chord)
    const asCmd = normaliseAccelerator(chord.replace('CmdOrCtrl', 'Cmd'))
    const asCtrl = normaliseAccelerator(chord.replace('CmdOrCtrl', 'Ctrl'))
    return [normalised, asCmd, asCtrl].filter((value): value is string => value !== null)
  })
)

export type AcceleratorProblem = 'syntax' | 'no-modifier' | 'reserved'

export const PROBLEM_MESSAGES: Record<AcceleratorProblem, string> = {
  syntax: 'That is not a key combination this app can bind.',
  'no-modifier': 'Needs Ctrl, Cmd, Alt or Super — a bare key would fire while typing in a panel.',
  reserved: 'That combination is reserved by the system or the app.'
}

/** Returns the reason a chord is unusable, or null when it is fine. */
export function checkAccelerator(accelerator: string): AcceleratorProblem | null {
  const parsed = parseAccelerator(accelerator)
  if (!parsed) return 'syntax'

  if (isBareEscape(parsed)) return 'reserved'
  if (RESERVED.has(formatParsed(parsed))) return 'reserved'

  const hasRealModifier = parsed.modifiers.some((modifier) => REAL_MODIFIERS.includes(modifier))
  if (!safeWithoutModifier(parsed.key) && !hasRealModifier) return 'no-modifier'

  return null
}

export function isValidAccelerator(accelerator: string): boolean {
  return checkAccelerator(accelerator) === null
}

/** The subset of a KeyboardEvent a chord is built from. */
export interface KeyChord {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/

/**
 * Physical-key names, because `KeyboardEvent.key` is the wrong input here.
 *
 * With Shift held, `key` reports the *shifted* character — so the shipped
 * default CmdOrCtrl+Shift+\ would record as CmdOrCtrl+Shift+| and never match.
 * `code` names the key regardless of what it produces, which is also what makes
 * a chord stay put when the user has a non-US layout.
 */
const CODE_KEYS: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
  NumpadDecimal: 'numdec',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv'
}

function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]

  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]

  const numpad = /^Numpad([0-9])$/.exec(code)
  if (numpad) return `num${numpad[1]}`

  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code

  return CODE_KEYS[code] ?? null
}

/**
 * Builds an accelerator from a keypress, or null while only modifiers are held —
 * which is the normal state halfway through recording one.
 *
 * Emits `CmdOrCtrl` for the platform's primary modifier so a keymap recorded on
 * one machine still reads correctly on another; Cmd on Windows or Super on
 * macOS would be nonsense on the other platform.
 */
export function acceleratorFromChord(chord: KeyChord, platform: string): string | null {
  if (MODIFIER_CODES.test(chord.code)) return null

  const key = keyFromCode(chord.code)
  if (!key) return null

  const isMac = platform === 'darwin'
  const modifiers: Modifier[] = []

  // The primary modifier collapses to CmdOrCtrl; the other one stays literal, so
  // Ctrl+S on a Mac remains a distinct chord from Cmd+S.
  if (isMac ? chord.metaKey : chord.ctrlKey) modifiers.push('CmdOrCtrl')
  if (isMac && chord.ctrlKey) modifiers.push('Ctrl')
  if (!isMac && chord.metaKey) modifiers.push('Super')
  if (chord.altKey) modifiers.push('Alt')
  if (chord.shiftKey) modifiers.push('Shift')

  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
  return formatParsed({ modifiers, key })
}

/**
 * How a chord is written on screen. Only resolves CmdOrCtrl to the platform's
 * name — the textual `Ctrl+S` / `Cmd+S` style is what the app already shipped,
 * and swapping it for ⌘-symbols is a separate decision.
 */
export function formatAccelerator(accelerator: string, platform: string): string {
  const parsed = parseAccelerator(accelerator)
  const source = parsed ? formatParsed(parsed) : accelerator
  return source.replace('CmdOrCtrl', platform === 'darwin' ? 'Cmd' : 'Ctrl')
}

/* ------------------------------------------------------------------ bindings */

/**
 * A *binding* is what an action is bound to: either one stroke (`CmdOrCtrl+S`)
 * or two, separated by a space (`CmdOrCtrl+K CmdOrCtrl+S`) — press the first,
 * release, press the second. Emacs writes that `C-x C-s`; VS Code calls it a
 * chord; JetBrains calls the second half a "second stroke".
 *
 * Two is the cap. Emacs goes deeper, but nothing anyone asked to import does,
 * and each extra level widens the window in which the app is swallowing
 * keystrokes that would otherwise be typing.
 */
export const MAX_STROKES = 2

export function bindingStrokes(binding: string): string[] {
  return binding.split(' ').filter(Boolean)
}

export function isChordBinding(binding: string): boolean {
  return bindingStrokes(binding).length > 1
}

export type BindingProblem = AcceleratorProblem | 'too-long'

export const BINDING_PROBLEM_MESSAGES: Record<BindingProblem, string> = {
  ...PROBLEM_MESSAGES,
  syntax: 'That is not a key combination this app can bind.',
  'no-modifier':
    'The first key needs Ctrl, Cmd, Alt or Super — a bare key would fire while typing in a panel.',
  reserved: 'That combination is reserved by the system or the app.',
  'too-long': 'Two keystrokes is the limit.'
}

/**
 * Validates a whole binding.
 *
 * Only the **first** stroke must carry a modifier. The second may be bare, and
 * that is the entire point: `C-x 3`, `C-w v` and `C-b %` all finish on a plain
 * key, and refusing those would leave nothing of Emacs, Vim or tmux to import.
 * It is safe precisely because a sequence can only *start* from a modified
 * stroke — ordinary typing can never open one.
 */
export function checkBinding(binding: string): BindingProblem | null {
  const strokes = bindingStrokes(binding)
  if (strokes.length === 0) return 'syntax'
  if (strokes.length > MAX_STROKES) return 'too-long'

  for (const [index, stroke] of strokes.entries()) {
    const parsed = parseAccelerator(stroke)
    if (!parsed) return 'syntax'

    // Reserved applies to *every* stroke, not just the first. A menu role is
    // registered app-wide and fires whether or not a prefix is pending, so
    // `CmdOrCtrl+K CmdOrCtrl+C` would lose its second stroke to Copy. Only bare
    // Escape is reserved (see checkAccelerator above) — a modified Escape mid-
    // sequence is just another stroke.
    if (isBareEscape(parsed) || RESERVED.has(formatParsed(parsed))) return 'reserved'

    if (index === 0) {
      const hasRealModifier = parsed.modifiers.some((modifier) => REAL_MODIFIERS.includes(modifier))
      if (!safeWithoutModifier(parsed.key) && !hasRealModifier) return 'no-modifier'
    }
  }

  return null
}

export function isValidBinding(binding: string): boolean {
  return checkBinding(binding) === null
}

/** Canonical form of a whole binding, or null if any stroke fails to parse. */
export function normaliseBinding(binding: string): string | null {
  const strokes = bindingStrokes(binding)
  if (!strokes.length) return null

  const normalised = strokes.map(normaliseAccelerator)
  if (normalised.some((stroke) => stroke === null)) return null
  return normalised.join(' ')
}

export function formatBinding(binding: string, platform: string): string {
  return bindingStrokes(binding)
    .map((stroke) => formatAccelerator(stroke, platform))
    .join(' ')
}

import { describe, expect, it } from 'vitest'
import {
  acceleratorFromChord,
  checkAccelerator,
  checkBinding,
  formatAccelerator,
  isRecordableAccelerator,
  isRecordableBinding,
  normaliseAccelerator,
  parseAccelerator,
  type KeyChord
} from '../../../shared/accelerator'
import { ACTIONS, resolveKeymap } from '../../../shared/actions'

/** A keypress with nothing held. Spread over to add modifiers. */
const press = (code: string, held: Partial<KeyChord> = {}): KeyChord => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...held
})

describe('parsing', () => {
  it('canonicalises case and modifier order', () => {
    expect(normaliseAccelerator('shift+cmdorctrl+s')).toBe('CmdOrCtrl+Shift+S')
  })

  it('accepts the aliases Electron accepts', () => {
    expect(normaliseAccelerator('Control+Return')).toBe('Ctrl+Enter')
    expect(normaliseAccelerator('Command+Esc')).toBe('Cmd+Escape')
    expect(normaliseAccelerator('Option+A')).toBe('Alt+A')
  })

  it('keeps a trailing + as the key rather than splitting on it', () => {
    expect(parseAccelerator('CmdOrCtrl++')).toMatchObject({ key: '+' })
  })

  it('rejects an unknown modifier or key', () => {
    expect(parseAccelerator('Hyper+K')).toBeNull()
    expect(parseAccelerator('CmdOrCtrl+F25')).toBeNull()
    expect(parseAccelerator('')).toBeNull()
  })
})

describe('what may be bound', () => {
  it('accepts an ordinary modified chord', () => {
    expect(checkAccelerator('CmdOrCtrl+Shift+P')).toBeNull()
  })

  it('refuses a bare key, which would fire while typing', () => {
    expect(checkAccelerator('K')).toBe('no-modifier')
  })

  it('refuses Shift alone as the modifier — Shift+A is just A', () => {
    expect(checkAccelerator('Shift+A')).toBe('no-modifier')
  })

  it('allows a bare function key, which nothing types into a field', () => {
    expect(checkAccelerator('F2')).toBeNull()
  })

  it('allows Shift+Escape — Escape types nothing, so the Shift rule has nothing to protect', () => {
    expect(checkAccelerator('Shift+Escape')).toBeNull()
  })

  it('keeps the other named keys behind a real modifier', () => {
    // The exemption is Escape, not "named keys": Shift+Home is selection and
    // Shift+Tab is navigation in every text field.
    expect(checkAccelerator('Shift+Home')).toBe('no-modifier')
    expect(checkAccelerator('Shift+Tab')).toBe('no-modifier')
  })

  it('reserves the Edit roles in every spelling of the primary modifier', () => {
    for (const chord of ['CmdOrCtrl+C', 'Cmd+V', 'Ctrl+X', 'CmdOrCtrl+A', 'Cmd+Z']) {
      expect(checkAccelerator(chord)).toBe('reserved')
    }
  })

  it('reserves bare Escape only — it is fixed to panel:restore', () => {
    expect(checkAccelerator('Escape')).toBe('reserved')
  })

  it('allows a modified Escape, since App.tsx now ignores it with a modifier held', () => {
    expect(checkAccelerator('CmdOrCtrl+Escape')).toBeNull()
    expect(checkAccelerator('Alt+Shift+Esc')).toBeNull()
  })

  it('does not over-reserve a role key that carries a different modifier', () => {
    expect(checkAccelerator('Alt+C')).toBeNull()
    expect(checkAccelerator('CmdOrCtrl+Alt+V')).toBeNull()
  })
})

describe('recording a chord', () => {
  it('reports the primary modifier as CmdOrCtrl on either platform', () => {
    expect(acceleratorFromChord(press('KeyS', { ctrlKey: true }), 'win32')).toBe('CmdOrCtrl+S')
    expect(acceleratorFromChord(press('KeyS', { metaKey: true }), 'darwin')).toBe('CmdOrCtrl+S')
  })

  it('keeps the non-primary modifier distinct from it', () => {
    // Ctrl on a Mac is its own modifier, not a second spelling of Cmd.
    expect(acceleratorFromChord(press('KeyS', { ctrlKey: true }), 'darwin')).toBe('Ctrl+S')
    expect(acceleratorFromChord(press('KeyS', { metaKey: true }), 'win32')).toBe('Super+S')
  })

  it('uses the physical key, so Shift does not shift the character', () => {
    // The whole reason `code` is read instead of `key`: this is the shipped
    // default for Split Down, and `key` would report '|' here.
    expect(
      acceleratorFromChord(press('Backslash', { ctrlKey: true, shiftKey: true }), 'win32')
    ).toBe('CmdOrCtrl+Shift+\\')
  })

  it('returns null while only modifiers are held', () => {
    expect(acceleratorFromChord(press('ShiftLeft', { shiftKey: true }), 'win32')).toBeNull()
    expect(acceleratorFromChord(press('MetaRight', { metaKey: true }), 'darwin')).toBeNull()
  })

  it('names function, numpad and navigation keys the way Electron does', () => {
    expect(acceleratorFromChord(press('F2'), 'win32')).toBe('F2')
    expect(acceleratorFromChord(press('Numpad4', { ctrlKey: true }), 'win32')).toBe(
      'CmdOrCtrl+num4'
    )
    expect(acceleratorFromChord(press('ArrowUp', { altKey: true }), 'win32')).toBe('Alt+Up')
  })

  it('ignores a key it cannot name rather than emitting a broken chord', () => {
    expect(acceleratorFromChord(press('MediaPlayPause'), 'win32')).toBeNull()
  })
})

describe('what a keypress could produce', () => {
  it('accepts everything a recording emits', () => {
    // The round trip that defines the rule: anything `acceleratorFromChord`
    // hands back has to pass, or a chord could be recorded and then rejected.
    for (const code of ['KeyH', 'Digit5', 'Minus', 'Equal', 'Quote', 'F7', 'Numpad4', 'ArrowUp']) {
      const stroke = acceleratorFromChord(press(code, { ctrlKey: true, shiftKey: true }), 'win32')
      expect([code, isRecordableAccelerator(stroke as string)]).toEqual([code, true])
    }
  })

  it('refuses a shifted character, which no keypress reports', () => {
    // `%` arrives as Shift+5 and `"` as Shift+', because the stroke is built
    // from `event.code`. Both spellings parse; only one can ever be pressed.
    expect(isRecordableAccelerator('%')).toBe(false)
    expect(isRecordableAccelerator('"')).toBe(false)
    expect(isRecordableAccelerator('Shift+5')).toBe(true)
    expect(isRecordableAccelerator("Shift+'")).toBe(true)
  })

  it('is not part of what the app will accept, only of what it ships', () => {
    // A hand-edited `%` stays valid: refusing it would mean knowing where `%`
    // sits on that keyboard, and the layout API reports unmodified keys only.
    expect(checkBinding('CmdOrCtrl+B %')).toBeNull()
    expect(isRecordableBinding('CmdOrCtrl+B %')).toBe(false)
  })

  it('reads every stroke of a sequence, not just the first', () => {
    expect(isRecordableBinding("CmdOrCtrl+B Shift+'")).toBe(true)
    expect(isRecordableBinding('CmdOrCtrl+W Shift+.')).toBe(true)
    expect(isRecordableBinding('CmdOrCtrl+W >')).toBe(false)
  })
})

describe('display', () => {
  it('resolves CmdOrCtrl to the platform name', () => {
    expect(formatAccelerator('CmdOrCtrl+S', 'darwin')).toBe('Cmd+S')
    expect(formatAccelerator('CmdOrCtrl+S', 'win32')).toBe('Ctrl+S')
  })

  it('leaves a literal modifier alone', () => {
    expect(formatAccelerator('Alt+Shift+K', 'darwin')).toBe('Alt+Shift+K')
  })
})

describe('the catalogue itself', () => {
  it('ships only bindings that pass its own rules', () => {
    for (const action of ACTIONS) {
      if (!action.defaultAccelerator) continue
      // Escape is the one deliberate exception: reserved, and fixed because of it.
      if (action.fixed) continue
      expect([action.id, checkAccelerator(action.defaultAccelerator)]).toEqual([action.id, null])
    }
  })

  it('ships no two actions on the same chord', () => {
    const seen = new Map<string, string>()
    for (const action of ACTIONS) {
      if (!action.defaultAccelerator) continue
      const chord = normaliseAccelerator(action.defaultAccelerator)
      expect(chord).not.toBeNull()
      expect(seen.get(chord as string)).toBeUndefined()
      seen.set(chord as string, action.id)
    }
  })
})

describe('resolving the keymap', () => {
  it('falls back to the default for anything the user has not touched', () => {
    expect(resolveKeymap({})['layout:save']).toBe('CmdOrCtrl+S')
  })

  it('takes the override where there is one', () => {
    expect(resolveKeymap({ 'layout:save': 'Alt+S' })['layout:save']).toBe('Alt+S')
  })

  it('treats an explicit null as unbound, not as absent', () => {
    expect(resolveKeymap({ 'layout:save': null })['layout:save']).toBeNull()
  })

  it('ignores an override on a fixed binding, however it got into the file', () => {
    expect(resolveKeymap({ 'panel:restore': 'CmdOrCtrl+R' })['panel:restore']).toBe('Escape')
  })
})

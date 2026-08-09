import { describe, expect, it } from 'vitest'
import { checkBinding, isChordBinding, normaliseBinding } from '../../../shared/accelerator'
import {
  findConflict,
  resolveKeymap,
  type Keymap,
  type ResolvedKeymap
} from '../../../shared/actions'
import { advanceChord } from './chords'

const keymap = (overrides: Keymap): ResolvedKeymap => resolveKeymap(overrides)

describe('validating a two-stroke binding', () => {
  it('accepts a modified opening stroke and a bare finish', () => {
    // The shape Emacs, Vim and tmux all use — a modified prefix, a plain finish.
    expect(checkBinding('CmdOrCtrl+B 5')).toBeNull() // tmux's C-b %
    expect(checkBinding('CmdOrCtrl+W V')).toBeNull() // Vim's C-w v
    expect(checkBinding('CmdOrCtrl+K 3')).toBeNull()
  })

  it('cannot offer Emacs its own prefix, because Cut owns Ctrl+X', () => {
    // Worth pinning: C-x is *the* Emacs prefix, and it is the Cut role in every
    // desktop app. Reserving it is not a choice this app gets to make — shadowing
    // Cut breaks cut in every text field. An Emacs user has to pick another
    // prefix; C-b and C-k are both free.
    expect(checkBinding('CmdOrCtrl+X 3')).toBe('reserved')
  })

  it('accepts two modified strokes', () => {
    expect(checkBinding('CmdOrCtrl+K CmdOrCtrl+S')).toBeNull()
  })

  it('still refuses a bare opening stroke', () => {
    expect(checkBinding('X 3')).toBe('no-modifier')
  })

  it('refuses more than two strokes', () => {
    expect(checkBinding('CmdOrCtrl+X CmdOrCtrl+K 3')).toBe('too-long')
  })

  it('refuses a reserved stroke in either position', () => {
    // A menu role fires whether or not a prefix is pending, so it would eat the
    // second stroke exactly as it eats the first.
    expect(checkBinding('CmdOrCtrl+C 3')).toBe('reserved')
    expect(checkBinding('CmdOrCtrl+K CmdOrCtrl+C')).toBe('reserved')
    expect(checkBinding('CmdOrCtrl+K Escape')).toBe('reserved')
  })

  it('allows a modified Escape stroke, since only bare Escape is reserved', () => {
    expect(checkBinding('CmdOrCtrl+Escape')).toBeNull()
    expect(checkBinding('CmdOrCtrl+K CmdOrCtrl+Escape')).toBeNull()
  })

  it('normalises each stroke independently', () => {
    expect(normaliseBinding('ctrl+b 3')).toBe('Ctrl+B 3')
    expect(normaliseBinding('shift+cmdorctrl+k cmdorctrl+s')).toBe('CmdOrCtrl+Shift+K CmdOrCtrl+S')
  })

  it('tells a sequence from a single stroke', () => {
    expect(isChordBinding('CmdOrCtrl+K CmdOrCtrl+S')).toBe(true)
    expect(isChordBinding('CmdOrCtrl+S')).toBe(false)
  })
})

describe('the sequence dispatcher', () => {
  const withChord = keymap({ 'panel:splitRight': 'CmdOrCtrl+B 3' })

  it('ignores a stroke that opens nothing', () => {
    expect(advanceChord(null, 'CmdOrCtrl+P', withChord)).toEqual({ type: 'ignore' })
  })

  it('ignores a single-stroke binding the menu still owns', () => {
    // Ctrl+S is bound to save, and no sequence uses it, so it is still a menu
    // accelerator. Claiming it here as well would fire save twice.
    expect(advanceChord(null, 'CmdOrCtrl+S', withChord)).toEqual({ type: 'ignore' })
  })

  describe('when a sequence borrows a stroke that is also bound alone', () => {
    // VS Code's arrangement: Ctrl+K Ctrl+S opens the editor, Ctrl+S still saves.
    const shared = keymap({ 'app:shortcuts': 'CmdOrCtrl+K CmdOrCtrl+S' })

    it('fires the single binding when nothing is pending', () => {
      expect(advanceChord(null, 'CmdOrCtrl+S', shared)).toEqual({
        type: 'fire',
        action: 'layout:save'
      })
    })

    it('completes the sequence when a prefix is pending', () => {
      expect(advanceChord('CmdOrCtrl+K', 'CmdOrCtrl+S', shared)).toEqual({
        type: 'fire',
        action: 'app:shortcuts'
      })
    })

    it('still holds the prefix itself', () => {
      expect(advanceChord(null, 'CmdOrCtrl+K', shared)).toEqual({
        type: 'pending',
        prefix: 'CmdOrCtrl+K'
      })
    })

    it('leaves untouched single strokes to the menu', () => {
      // Ctrl+O is not part of any sequence, so its accelerator stays and the
      // renderer must not fire it a second time.
      expect(advanceChord(null, 'CmdOrCtrl+O', shared)).toEqual({ type: 'ignore' })
    })
  })

  it('holds a prefix that opens a sequence', () => {
    expect(advanceChord(null, 'CmdOrCtrl+B', withChord)).toEqual({
      type: 'pending',
      prefix: 'CmdOrCtrl+B'
    })
  })

  it('fires when the second stroke completes it', () => {
    expect(advanceChord('CmdOrCtrl+B', '3', withChord)).toEqual({
      type: 'fire',
      action: 'panel:splitRight'
    })
  })

  it('reports a miss rather than firing something else', () => {
    expect(advanceChord('CmdOrCtrl+B', '9', withChord)).toEqual({
      type: 'miss',
      attempted: 'CmdOrCtrl+B 9'
    })
  })

  it('does not treat a failed second stroke as a fresh prefix', () => {
    // CmdOrCtrl+B opens a sequence, but arriving as the *second* stroke it is a
    // miss — otherwise a stutter would leave the app permanently half-armed.
    expect(advanceChord('CmdOrCtrl+B', 'CmdOrCtrl+B', withChord)).toMatchObject({ type: 'miss' })
  })

  it('shares a prefix between two sequences', () => {
    const two = keymap({
      'panel:splitRight': 'CmdOrCtrl+B 3',
      'panel:splitDown': 'CmdOrCtrl+B 2'
    })
    expect(advanceChord(null, 'CmdOrCtrl+B', two)).toMatchObject({ type: 'pending' })
    expect(advanceChord('CmdOrCtrl+B', '3', two)).toMatchObject({ action: 'panel:splitRight' })
    expect(advanceChord('CmdOrCtrl+B', '2', two)).toMatchObject({ action: 'panel:splitDown' })
  })

  it('matches regardless of how the stored binding was spelled', () => {
    const messy = keymap({ 'panel:splitRight': 'ctrl+b 3' })
    expect(advanceChord('Ctrl+B', '3', messy)).toMatchObject({ action: 'panel:splitRight' })
  })
})

describe('conflicts between sequences and single strokes', () => {
  it('reports an exact duplicate', () => {
    expect(findConflict(keymap({}), 'CmdOrCtrl+S', 'panel:close')).toEqual({
      kind: 'duplicate',
      action: 'layout:save'
    })
  })

  it('allows a sequence to finish on a stroke that is bound on its own', () => {
    // Ctrl+S is Save, and `Ctrl+K Ctrl+S` still works: with a prefix pending the
    // context says which was meant. Save gives up its menu accelerator for it.
    expect(findConflict(keymap({}), 'CmdOrCtrl+K CmdOrCtrl+S', 'app:shortcuts')).toBeNull()
  })

  it('refuses a sequence that opens on a stroke another action owns alone', () => {
    // Ctrl+W closes the panel. Pressing it can mean that, or the start of a
    // sequence, and nothing later in time tells you which — so it is refused.
    expect(findConflict(keymap({}), 'CmdOrCtrl+W 3', 'app:shortcuts')).toEqual({
      kind: 'prefix-taken',
      action: 'panel:close',
      stroke: 'CmdOrCtrl+W'
    })
  })

  it('refuses a single stroke that is already how a sequence opens', () => {
    const withChord = keymap({ 'panel:splitRight': 'CmdOrCtrl+B 3' })
    expect(findConflict(withChord, 'CmdOrCtrl+B', 'app:shortcuts')).toEqual({
      kind: 'prefix-blocks',
      action: 'panel:splitRight',
      stroke: 'CmdOrCtrl+B'
    })
  })

  it('allows a bare finishing stroke, which nothing can claim alone', () => {
    expect(findConflict(keymap({}), 'CmdOrCtrl+B 3', 'app:shortcuts')).toBeNull()
    expect(findConflict(keymap({}), 'CmdOrCtrl+B 5', 'app:shortcuts')).toBeNull()
  })

  it('lets two sequences share an opening stroke', () => {
    const withChord = keymap({ 'panel:splitRight': 'CmdOrCtrl+B 3' })
    expect(findConflict(withChord, 'CmdOrCtrl+B 2', 'panel:splitDown')).toBeNull()
  })

  it('does not report an action against itself', () => {
    expect(findConflict(keymap({}), 'CmdOrCtrl+S', 'layout:save')).toBeNull()
  })
})

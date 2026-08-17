import { describe, expect, it } from 'vitest'
import { checkBinding, isRecordableBinding } from '../../../shared/accelerator'
import {
  ACTIONS,
  findConflict,
  resolveKeymap,
  type ActionId,
  type Keymap
} from '../../../shared/actions'
import { PRESETS, findPreset, presetBindings, type KeymapPreset } from '../../../shared/presets'

/**
 * Every arm a preset ships. Most have one; a preset whose tool moves a key per
 * platform carries a complete darwin arm beside `bindings`, and whatever must
 * hold for a preset must hold for each arm on its own — an arm is what a
 * platform actually applies.
 */
const arms = (preset: KeymapPreset): [string, Keymap][] =>
  preset.darwin
    ? [
        ['win32', preset.bindings],
        ['darwin', preset.darwin]
      ]
    : [['all platforms', preset.bindings]]

describe('every preset', () => {
  for (const preset of PRESETS) {
    describe(preset.name, () => {
      it('binds only actions that exist', () => {
        const known = new Set(ACTIONS.map((action) => action.id))
        for (const [arm, bindings] of arms(preset)) {
          for (const id of Object.keys(bindings)) {
            expect([arm, id, known.has(id as ActionId)]).toEqual([arm, id, true])
          }
        }
      })

      it('ships only bindings the app would accept', () => {
        for (const [arm, bindings] of arms(preset)) {
          for (const [id, binding] of Object.entries(bindings)) {
            if (!binding) continue
            expect([arm, id, checkBinding(binding)]).toEqual([arm, id, null])
          }
        }
      })

      /**
       * Accepted is not the same as pressable, and the gap is where tmux lost
       * both its splits.
       *
       * An accelerator may *name* any of 31 punctuation characters; a keypress
       * can only produce the eleven unshifted ones, because a stroke is built
       * from `event.code` and the shift comes back as a modifier. So a preset
       * written in its tool's own notation — tmux prints its splits as `%` and
       * `"` — passes every check above, prints in the editor and the ⋯ menu, and
       * can never match a key. Only the presets are held to this: a user's
       * hand-edited file cannot be, since refusing `%` there would mean knowing
       * where `%` sits on their keyboard, and nothing can tell you that.
       */
      it('ships only bindings a keypress could produce', () => {
        for (const [arm, bindings] of arms(preset)) {
          for (const [id, binding] of Object.entries(bindings)) {
            if (!binding) continue
            expect([arm, id, isRecordableBinding(binding)]).toEqual([arm, id, true])
          }
        }
      })

      /**
       * The one that earns its keep. A preset sets several bindings at once, so
       * it can contradict *itself* — and the way it does is subtle: Vim's window
       * commands all sit behind Ctrl+W, which is also the shipped single-stroke
       * binding for Close Panel. Leave that default in place and the menu
       * accelerator eats the prefix, so every Vim sequence silently stops
       * working. Checking each binding against the whole resolved map is what
       * catches it.
       */
      it('does not contradict itself once applied', () => {
        for (const [arm, bindings] of arms(preset)) {
          const resolved = resolveKeymap(bindings)
          for (const action of ACTIONS) {
            const binding = resolved[action.id]
            if (!binding) continue
            expect([arm, action.id, findConflict(resolved, binding, action.id)]).toEqual([
              arm,
              action.id,
              null
            ])
          }
        }
      })
    })
  }
})

describe('the presets that exist', () => {
  it('offers plain defaults as a way back', () => {
    expect(findPreset('default')?.bindings).toEqual({})
  })

  it('moves Close Panel off the prefix it would otherwise open', () => {
    // Vim's window commands all sit behind Ctrl+W, which ships bound to Close
    // Panel. Leave that and the menu owns the prefix, so no sequence ever
    // starts. Vim puts Close on `C-w c` anyway.
    expect(findPreset('vim')?.bindings['panel:close']).toBe('CmdOrCtrl+W C')
    expect(findPreset('tmux')?.bindings['panel:close']).toBe('CmdOrCtrl+B X')
  })

  it('lets a sequence finish on a stroke that is bound on its own', () => {
    // The whole point of the second-stroke rule. VS Code's Ctrl+K Ctrl+S ends on
    // Ctrl+S, which is Save — allowed, because a pending prefix disambiguates.
    const applied = resolveKeymap(findPreset('vscode')!.bindings)
    expect(applied['app:shortcuts']).toBe('CmdOrCtrl+K CmdOrCtrl+S')
    expect(applied['layout:save']).toBe('CmdOrCtrl+S')
    expect(findConflict(applied, 'CmdOrCtrl+K CmdOrCtrl+S', 'app:shortcuts')).toBeNull()
  })

  it('unbinds everything except the bindings that cannot move', () => {
    // Escape and Quit both belong to a layer above the keymap — the renderer's
    // own handler and the system menu item — so "None" cannot reach them.
    const applied = resolveKeymap(findPreset('none')!.bindings)
    for (const action of ACTIONS) {
      expect([action.id, applied[action.id]]).toEqual([
        action.id,
        action.fixed ? action.defaultAccelerator : null
      ])
    }
  })

  it('states the palette key even where it matches the shipped default', () => {
    // A preset reproduces its tool, not our defaults. Left to fall through, the
    // VS Code keymap would quietly stop being VS Code the day we moved ours.
    expect(findPreset('vscode')?.bindings['app:palette']).toBe('CmdOrCtrl+Shift+P')
    expect(findPreset('cursor')?.bindings['app:palette']).toBe('CmdOrCtrl+Shift+P')
    expect(findPreset('cursor')?.darwin?.['app:palette']).toBe('CmdOrCtrl+Shift+P')
    expect(findPreset('zed')?.bindings['app:palette']).toBe('CmdOrCtrl+Shift+P')
    expect(findPreset('sublime')?.bindings['app:palette']).toBe('CmdOrCtrl+Shift+P')
  })

  it('puts the palette on Find Action for JetBrains', () => {
    // IntelliJ has no Ctrl+Shift+P at all; Ctrl+Shift+A is the same idea there.
    expect(findPreset('jetbrains')?.bindings['app:palette']).toBe('CmdOrCtrl+Shift+A')
  })

  it('gives Cursor the leader it uses on each platform, which takes both arms', () => {
    // Sourced from Cursor: `Ctrl+K` is inline edit there, so the chord leader
    // moved — "Cmd+R on Mac and Ctrl+M on Windows and Linux" (staff, on their
    // forum), and the docs reach the shortcuts editor with `Cmd R` `Cmd S`. One
    // chord string cannot name two leaders; the darwin arm is what spells it.
    const cursor = findPreset('cursor')!
    expect(cursor.bindings['app:shortcuts']).toBe('CmdOrCtrl+M CmdOrCtrl+S')
    expect(cursor.bindings['panel:splitDown']).toBe('CmdOrCtrl+M CmdOrCtrl+\\')
    expect(cursor.darwin?.['app:shortcuts']).toBe('CmdOrCtrl+R CmdOrCtrl+S')
    expect(cursor.darwin?.['panel:splitDown']).toBe('CmdOrCtrl+R CmdOrCtrl+\\')
  })

  it('applies the darwin arm on darwin and the only arm everywhere else', () => {
    const cursor = findPreset('cursor')!
    expect(presetBindings(cursor, 'darwin')).toBe(cursor.darwin)
    expect(presetBindings(cursor, 'win32')).toBe(cursor.bindings)
    expect(presetBindings(cursor, 'linux')).toBe(cursor.bindings)
    // A preset without an arm is the same keymap everywhere.
    expect(presetBindings(findPreset('vscode')!, 'darwin')).toBe(findPreset('vscode')!.bindings)
  })

  it('has no preset that quietly does nothing', () => {
    // A button that changes no binding is worse than no button — on either
    // platform, since arm selection decides what the button actually does.
    const defaults = resolveKeymap({})
    for (const platform of ['win32', 'darwin']) {
      for (const preset of PRESETS) {
        if (preset.id === 'default') continue
        expect([platform, preset.id, resolveKeymap(presetBindings(preset, platform))]).not.toEqual([
          platform,
          preset.id,
          defaults
        ])
      }
    }
  })

  it('has no two presets that resolve to the same keymap', () => {
    // The half the assertion above cannot make, and the half whose absence was
    // hidden by a comment claiming it. Comparing every preset against the
    // *defaults* leaves two buttons free to be identical to each other, which is
    // the shape a duplicate actually ships in: an editor forked from another
    // inherits every binding it does not deliberately move. Checked per
    // platform, because arm selection is where a duplicate could now hide — two
    // presets distinct on Windows could still collapse into one on a Mac.
    for (const platform of ['win32', 'darwin']) {
      const seen = new Map<string, string>()
      for (const preset of PRESETS) {
        const resolved = JSON.stringify(resolveKeymap(presetBindings(preset, platform)))
        expect([platform, preset.id, seen.get(resolved)]).toEqual([platform, preset.id, undefined])
        seen.set(resolved, preset.id)
      }
    }
  })
})

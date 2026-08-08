import { describe, expect, it } from 'vitest'
import { checkBinding } from '../../../shared/accelerator'
import { ACTIONS, findConflict, resolveKeymap, type ActionId } from '../../../shared/actions'
import { PRESETS, findPreset } from '../../../shared/presets'

describe('every preset', () => {
  for (const preset of PRESETS) {
    describe(preset.name, () => {
      it('binds only actions that exist', () => {
        const known = new Set(ACTIONS.map((action) => action.id))
        for (const id of Object.keys(preset.bindings)) {
          expect([id, known.has(id as ActionId)]).toEqual([id, true])
        }
      })

      it('ships only bindings the app would accept', () => {
        for (const [id, binding] of Object.entries(preset.bindings)) {
          if (!binding) continue
          expect([id, checkBinding(binding)]).toEqual([id, null])
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
        const resolved = resolveKeymap(preset.bindings)
        for (const action of ACTIONS) {
          const binding = resolved[action.id]
          if (!binding) continue
          expect([action.id, findConflict(resolved, binding, action.id)]).toEqual([action.id, null])
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

  it('has no preset that quietly does nothing', () => {
    // A button that changes no binding is worse than no button — which is why
    // Cursor is absent rather than shipped as a duplicate of VS Code.
    const defaults = resolveKeymap({})
    for (const preset of PRESETS) {
      if (preset.id === 'default') continue
      expect([preset.id, resolveKeymap(preset.bindings)]).not.toEqual([preset.id, defaults])
    }
  })
})

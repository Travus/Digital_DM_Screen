import { ACTIONS, type ActionId, type Keymap } from './actions'

/**
 * Ready-made keymaps borrowed from tools people already have in their fingers,
 * in the spirit of Zed's own "base keymap" list.
 *
 * Each is a **sparse** override map applied wholesale: actions it does not
 * mention fall back to the catalogue defaults, so a preset speaks only for the
 * commands its tool has an opinion about. Applying one replaces whatever was
 * there before rather than merging — a half-applied keymap is how you end up
 * with a prefix that still fires something on its own.
 *
 * Only bindings sourced from the tool itself are here. Two absences are
 * deliberate rather than oversights, and both are the same shape: a keymap whose
 * *prefix* this app cannot carry has nothing left to import.
 *
 * **Emacs.** Its prefix is `C-x`, which is Cut. On Windows and Linux that key is
 * handled by Chromium in any editable field whatever the menu says, so it is not
 * ours to give away; on macOS Cut is `Cmd+X` and `Ctrl+X` would be free, but a
 * preset that only exists on one platform is worse than no button. An Emacs
 * keymap that opens on something other than `C-x` is not an Emacs keymap.
 *
 * **Cursor**, for a reason worth writing down, because "it is a VS Code fork" is
 * the wrong one and was believed here for a while. It genuinely differs: `Ctrl+K`
 * is inline edit, so its chord leader moved — to `Ctrl+M` on Windows and Linux
 * and `Cmd+R` on macOS. That is one keymap with two leaders, and an entry here is
 * one chord for every platform by design, so Cursor's own split cannot be spelled
 * at all. `CmdOrCtrl+M` comes closest: exact on Windows and Linux, and on macOS a
 * key Cursor does not use, since `CmdOrCtrl+R` resolves to the Reload role's
 * stroke rather than to `Cmd+R`.
 *
 * The strokes are all reachable — the menu's roles hand a claimed one over — so
 * this is a judgement about fidelity, not a limit. A preset wearing a tool's name
 * and guessing at a third of its keymap is worse than not shipping it.
 */
export interface KeymapPreset {
  id: string
  name: string
  bindings: Keymap
}

/** Every action, explicitly unbound. */
const NOTHING: Keymap = Object.fromEntries(
  ACTIONS.filter((action) => !action.fixed).map((action) => [action.id, null])
)

export const PRESETS: readonly KeymapPreset[] = [
  {
    id: 'default',
    name: 'Default',
    bindings: {}
  },
  {
    id: 'vscode',
    name: 'VS Code',
    // Ctrl+K is VS Code's prefix. Both sequences finish on a stroke that is
    // separately bound — Ctrl+\ splits right, Ctrl+S saves — which is exactly
    // the case the renderer now arbitrates.
    bindings: {
      'panel:splitDown': 'CmdOrCtrl+K CmdOrCtrl+\\',
      'app:shortcuts': 'CmdOrCtrl+K CmdOrCtrl+S',
      // `workbench.action.showCommands`. Stated rather than left to fall through,
      // even though the catalogue default is the same key today: a preset
      // reproduces its tool, and one that tracked our defaults instead would
      // quietly stop being VS Code the moment we moved one.
      'app:palette': 'CmdOrCtrl+Shift+P'
    }
  },
  {
    id: 'zed',
    name: 'Zed',
    // From Zed's own default keymap: ctrl-k down splits, ctrl-k ctrl-s opens the
    // keymap. Its shift-escape zoom is left out because `Shift` does not count
    // as a real modifier — `checkAccelerator` refuses the chord as unmodified.
    bindings: {
      'panel:splitDown': 'CmdOrCtrl+K Down',
      'app:shortcuts': 'CmdOrCtrl+K CmdOrCtrl+S',
      // `command_palette::Toggle`.
      'app:palette': 'CmdOrCtrl+Shift+P'
    }
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    bindings: {
      'panel:splitRight': 'Alt+Shift+2',
      'panel:splitDown': 'Alt+Shift+8',
      // `show_overlay` with `"overlay": "command_palette"`.
      'app:palette': 'CmdOrCtrl+Shift+P'
    }
  },
  {
    id: 'jetbrains',
    name: 'JetBrains',
    // JetBrains spends its Ctrl keys on editor commands, so the overlap with
    // this app is small but real: Ctrl+W is Extend Selection there, not Close.
    bindings: {
      'layout:rename': 'Shift+F6',
      'layout:new': 'Alt+Insert',
      'panel:close': 'CmdOrCtrl+F4',
      // Find Action, which is the palette by another name — and the one preset
      // here that actually moves it, since IntelliJ has no Ctrl+Shift+P.
      'app:palette': 'CmdOrCtrl+Shift+A'
    }
  },
  {
    id: 'vim',
    name: 'Vim',
    // C-w is Vim's window prefix and this app's default for Close Panel, so the
    // preset has to claim it — onto `C-w c`, which is where Vim puts it anyway.
    bindings: {
      'panel:splitRight': 'CmdOrCtrl+W V',
      'panel:splitDown': 'CmdOrCtrl+W S',
      'panel:close': 'CmdOrCtrl+W C',
      'panel:maximize': 'CmdOrCtrl+W O'
    }
  },
  {
    id: 'tmux',
    name: 'tmux',
    // % splits vertically (a vertical divider, panes side by side) and " splits
    // horizontally. Famously the opposite way round from how they read.
    bindings: {
      'panel:splitRight': 'CmdOrCtrl+B %',
      'panel:splitDown': 'CmdOrCtrl+B "',
      'panel:close': 'CmdOrCtrl+B X',
      'panel:maximize': 'CmdOrCtrl+B Z'
    }
  },
  {
    id: 'none',
    name: 'None',
    bindings: NOTHING
  }
]

export function findPreset(id: string): KeymapPreset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

/** Actions a preset speaks for, so the editor can say what it will change. */
export function presetActions(preset: KeymapPreset): ActionId[] {
  return Object.keys(preset.bindings) as ActionId[]
}

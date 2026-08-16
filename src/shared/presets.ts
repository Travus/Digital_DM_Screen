import { ACTIONS, type Keymap } from './actions'

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
 * Only bindings sourced from the tool itself are here — a preset wearing a
 * tool's name and guessing at its keymap is worse than not shipping it. One
 * absence is deliberate rather than an oversight:
 *
 * **Emacs.** Its prefix is `C-x`, which is Cut. On Windows and Linux that key is
 * handled by Chromium in any editable field whatever the menu says, so it is not
 * ours to give away; on macOS Cut is `Cmd+X` and `Ctrl+X` would be free, but a
 * preset that only exists on one platform is worse than no button. An Emacs
 * keymap that opens on something other than `C-x` is not an Emacs keymap.
 */
export interface KeymapPreset {
  id: string
  name: string
  bindings: Keymap
  /**
   * A complete second arm for macOS, applied *instead of* `bindings` — never
   * merged over them. A delta arm would inherit whatever it forgot to restate,
   * and what it forgets is exactly the other platform's chords: Cursor minus
   * one line would open its sequences on `Cmd+M` while also claiming a `Cmd+R`
   * leader, two prefixes where the tool has one.
   *
   * This exists for a tool that binds a *different key* per platform.
   * `CmdOrCtrl` already swaps the modifier on its own; an arm is only for a
   * keymap `CmdOrCtrl` cannot spell.
   */
  darwin?: Keymap
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
    id: 'cursor',
    name: 'Cursor',
    /*
     * A VS Code fork, and *not* the same button twice — the one thing Cursor
     * moved is the thing the preset above is made of. `Ctrl+K` is inline edit
     * there, so the chord leader was reassigned, to a different key per
     * platform: "we therefore changed the keychord leader key to be Cmd+R on
     * Mac and Ctrl+M on Windows and Linux" (Cursor staff, on their forum).
     * Cursor's own docs reach the shortcuts editor with `Cmd R` then `Cmd S`.
     *
     * One chord string cannot name two leaders, which is what the darwin arm
     * is for: each arm is exactly Cursor's chord on the platform that applies
     * it. Both leaders sit on strokes Electron's roles hold — Reload's `Cmd+R`,
     * Minimize's `Cmd+M` — and the menu hands a claimed stroke over, so both
     * arms fire. What lands in the keymap is still ordinary chords: a
     * keybindings.json written on one platform works on the other, it just
     * keeps the leader of the machine that wrote it.
     */
    bindings: {
      'panel:splitDown': 'CmdOrCtrl+M CmdOrCtrl+\\',
      'app:shortcuts': 'CmdOrCtrl+M CmdOrCtrl+S',
      // Inherited from VS Code unchanged, and stated for the same reason it is
      // stated there.
      'app:palette': 'CmdOrCtrl+Shift+P'
    },
    darwin: {
      'panel:splitDown': 'CmdOrCtrl+R CmdOrCtrl+\\',
      'app:shortcuts': 'CmdOrCtrl+R CmdOrCtrl+S',
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

/**
 * The arm `platform` applies. Everything reading a preset's bindings comes
 * through here, so the editor, the tests and the menu cannot disagree about
 * which arm a platform gets.
 */
export function presetBindings(preset: KeymapPreset, platform: string): Keymap {
  return platform === 'darwin' && preset.darwin ? preset.darwin : preset.bindings
}

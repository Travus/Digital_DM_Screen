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
 * deliberate rather than oversights:
 *
 * **Emacs.** Its prefix is `C-x`, which is Cut. On Windows and Linux that key is
 * handled by Chromium in any editable field whatever the menu says, so it is not
 * ours to give away; on macOS Cut is `Cmd+X` and `Ctrl+X` would be free, but
 * shipping a preset that works on one platform and not another is worse than not
 * shipping it. An Emacs keymap that opens on something other than `C-x` is not
 * an Emacs keymap.
 *
 * **Cursor** is a VS Code fork and its defaults are identical, so it would be
 * the same button twice.
 */
export interface KeymapPreset {
  id: string
  name: string
  /** One line, shown under the button. */
  blurb: string
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
    blurb: 'What the app ships with.',
    bindings: {}
  },
  {
    id: 'vscode',
    name: 'VS Code',
    // Ctrl+K is VS Code's prefix. Both sequences finish on a stroke that is
    // separately bound — Ctrl+\ splits right, Ctrl+S saves — which is exactly
    // the case the renderer now arbitrates.
    blurb: 'Ctrl+K sequences for the split and the shortcut editor. Also Cursor.',
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
    // keymap. Its zoom is shift-escape, which Escape being reserved rules out.
    blurb: 'Zed’s Ctrl+K family. Its Shift+Esc zoom is left out — Esc is reserved.',
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
    blurb: 'Sublime’s Alt+Shift layout commands for splitting.',
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
    blurb: 'IntelliJ: Ctrl+Shift+A finds actions, Shift+F6 renames, Ctrl+F4 closes.',
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
    blurb: 'Window commands behind Ctrl+W: v and s split, c closes, o for only.',
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
    blurb: 'Pane commands behind Ctrl+B: % and " split, x kills, z zooms.',
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
    blurb: 'Every shortcut unbound. Esc still leaves fullscreen.',
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

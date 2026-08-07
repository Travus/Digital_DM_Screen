import type { ActionId, Keymap } from './actions'

/**
 * Ready-made keymaps borrowed from tools people already have in their fingers.
 *
 * Each one is a **sparse** override map applied wholesale: actions it does not
 * mention fall back to the catalogue defaults, so a preset changes the commands
 * that tool has an opinion about and leaves the rest alone.
 *
 * ## Why this list is short
 *
 * Two-stroke sequences made presets possible at all, but not universally, and
 * the reasons are worth writing down because they look like omissions.
 *
 * **VS Code and Zed are already the defaults.** Every binding of theirs this app
 * has an equivalent for — `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S`,
 * `Ctrl+W`, `Ctrl+\`, `F2` — is what ships. The parts that differ are the ones
 * that cannot work here: `Ctrl+K Ctrl+S` and `Ctrl+K Ctrl+\` each repeat a
 * stroke that is already a single-stroke binding, and a menu accelerator always
 * fires first. A "VS Code" button would be a button that does nothing.
 *
 * **Emacs cannot have its prefix.** `C-x` is Cut. Not reserving it would break
 * cut in every text field on every platform, and an Emacs keymap that opens on
 * anything other than `C-x` is not an Emacs keymap. Better to leave it out than
 * to ship something wearing the name.
 *
 * Vim and tmux both survive intact, because both drive their windows from a
 * modified prefix and finish on a plain key — the one shape this app supports
 * completely.
 */
export interface KeymapPreset {
  id: string
  name: string
  /** One line, shown under the button. */
  blurb: string
  bindings: Keymap
}

export const PRESETS: readonly KeymapPreset[] = [
  {
    id: 'default',
    name: 'Defaults',
    blurb: 'What the app ships with, which is also the VS Code and Zed layout.',
    bindings: {}
  },
  {
    id: 'vim',
    name: 'Vim',
    // C-w is Vim's window prefix. It is this app's default for Close Panel too,
    // which is exactly the collision `findConflict` reports — so the preset has
    // to move Close onto `C-w c`, which is where Vim puts it anyway.
    blurb: 'Window commands behind Ctrl+W, as in Vim: v and s to split, c to close, o for only.',
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
    blurb: 'Pane commands behind Ctrl+B, as in tmux: % and " to split, x to kill, z to zoom.',
    bindings: {
      'panel:splitRight': 'CmdOrCtrl+B %',
      'panel:splitDown': 'CmdOrCtrl+B "',
      'panel:close': 'CmdOrCtrl+B X',
      'panel:maximize': 'CmdOrCtrl+B Z'
    }
  }
]

export function findPreset(id: string): KeymapPreset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

/** Actions a preset speaks for, so the editor can say what it will change. */
export function presetActions(preset: KeymapPreset): ActionId[] {
  return Object.keys(preset.bindings) as ActionId[]
}

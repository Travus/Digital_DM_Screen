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
 * tool's name and guessing at its keymap is worse than not shipping it.
 *
 * **A stroke is written the way the app records it, not the way the tool prints
 * it.** tmux calls its split `%`; what a keypress produces is `Shift+5`, because
 * strokes are built from `event.code` and the shift arrives as a modifier. An
 * accelerator can *name* `%` — the parser takes 31 punctuation characters and a
 * keypress can only ever produce the eleven unshifted ones — so a preset written
 * in the tool's notation validates, prints in the editor and the ⋯ menu, and
 * never fires. tmux shipped two of those. `isRecordableBinding` is the rule, and
 * a test holds every preset to it.
 *
 * The cost is that a character's *position* is a US layout's: `%` is Shift+5
 * there and elsewhere on an AZERTY. The chord then stays on the same physical
 * key rather than on the same character, which is the bargain `event.code`
 * already makes for every other binding in the app.
 *
 * One absence is deliberate rather than an oversight:
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
      'app:palette': 'CmdOrCtrl+Shift+P',
      // `workbench.action.moveActiveEditorGroup{Left,Right,Up,Down}`, which move
      // a group past its neighbour — the nearest thing VS Code has to a swap.
      // Its own resize commands carry `f1: true` and no keybinding at all, so
      // the four resizes here keep the catalogue default.
      'panel:swapLeft': 'CmdOrCtrl+K Left',
      'panel:swapRight': 'CmdOrCtrl+K Right',
      'panel:swapUp': 'CmdOrCtrl+K Up',
      'panel:swapDown': 'CmdOrCtrl+K Down'
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
      'app:palette': 'CmdOrCtrl+Shift+P',
      // VS Code's group moves, on Cursor's leader. Every arm is complete, so
      // these are written out twice rather than shared.
      'panel:swapLeft': 'CmdOrCtrl+M Left',
      'panel:swapRight': 'CmdOrCtrl+M Right',
      'panel:swapUp': 'CmdOrCtrl+M Up',
      'panel:swapDown': 'CmdOrCtrl+M Down'
    },
    darwin: {
      'panel:splitDown': 'CmdOrCtrl+R CmdOrCtrl+\\',
      'app:shortcuts': 'CmdOrCtrl+R CmdOrCtrl+S',
      'app:palette': 'CmdOrCtrl+Shift+P',
      'panel:swapLeft': 'CmdOrCtrl+R Left',
      'panel:swapRight': 'CmdOrCtrl+R Right',
      'panel:swapUp': 'CmdOrCtrl+R Up',
      'panel:swapDown': 'CmdOrCtrl+R Down'
    }
  },
  {
    id: 'zed',
    name: 'Zed',
    // From Zed's own default keymap: ctrl-k down splits, ctrl-k ctrl-s opens the
    // keymap, and shift-escape is `workspace::ToggleZoom` — maximize by another
    // name, bindable since Escape joined the keys that need no real modifier.
    bindings: {
      'panel:splitDown': 'CmdOrCtrl+K Down',
      'app:shortcuts': 'CmdOrCtrl+K CmdOrCtrl+S',
      'panel:maximize': 'Shift+Escape',
      // `command_palette::Toggle`.
      'app:palette': 'CmdOrCtrl+Shift+P',
      // `workspace::SwapPane{Left,Right,Up,Down}` — the one tool listed here
      // whose commands are ours exactly rather than the nearest equivalent. Zed
      // writes them `ctrl-k shift-left` and `cmd-k shift-left`, which is the
      // difference `CmdOrCtrl` already spells, so this needs no darwin arm. Its
      // own size keys move the docks, not the panes, so they are left out.
      'panel:swapLeft': 'CmdOrCtrl+K Shift+Left',
      'panel:swapRight': 'CmdOrCtrl+K Shift+Right',
      'panel:swapUp': 'CmdOrCtrl+K Shift+Up',
      'panel:swapDown': 'CmdOrCtrl+K Shift+Down'
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
      'panel:maximize': 'CmdOrCtrl+W O',
      // `CTRL-W H/J/K/L` move the window to the far left, bottom, top or right.
      // Not a swap with the neighbour, but it is what Vim has, and in two
      // windows the two are the same act. Capitals, so each is a Shift stroke.
      'panel:swapLeft': 'CmdOrCtrl+W Shift+H',
      'panel:swapDown': 'CmdOrCtrl+W Shift+J',
      'panel:swapUp': 'CmdOrCtrl+W Shift+K',
      'panel:swapRight': 'CmdOrCtrl+W Shift+L',
      // `CTRL-W -/+` change height and `CTRL-W </>` width. Three of the four are
      // shifted characters, so they are written as the keys that produce them on
      // a US layout: + is Shift+=, < is Shift+, and > is Shift+. — see the note
      // at the top about what that costs elsewhere.
      'panel:shorter': 'CmdOrCtrl+W -',
      'panel:taller': 'CmdOrCtrl+W Shift+=',
      'panel:narrower': 'CmdOrCtrl+W Shift+,',
      'panel:wider': 'CmdOrCtrl+W Shift+.',
      // `CTRL-W =` makes every window equally high and wide.
      'split:equalise': 'CmdOrCtrl+W ='
    }
  },
  {
    id: 'tmux',
    name: 'tmux',
    // % splits vertically (a vertical divider, panes side by side) and " splits
    // horizontally. Famously the opposite way round from how they read.
    //
    // Written as the keys that produce them rather than as the characters tmux
    // prints: `%` is Shift+5 and `"` is Shift+' on a US layout, and a stroke is
    // built from `event.code`, so the character spelling could never match a
    // keypress. Both of these were dead bindings until they were written this
    // way — see the note at the top of this file.
    bindings: {
      'panel:splitRight': 'CmdOrCtrl+B Shift+5',
      'panel:splitDown': "CmdOrCtrl+B Shift+'",
      'panel:close': 'CmdOrCtrl+B X',
      'panel:maximize': 'CmdOrCtrl+B Z',
      // prefix M-arrow resizes the current pane in steps of five cells, moving
      // the border in the direction pressed — so left narrows it and up shortens
      // it. tmux's own pane swaps, `{` and `}`, take the previous or next pane
      // rather than a direction, so they have nothing to map onto here.
      'panel:narrower': 'CmdOrCtrl+B Alt+Left',
      'panel:wider': 'CmdOrCtrl+B Alt+Right',
      'panel:shorter': 'CmdOrCtrl+B Alt+Up',
      'panel:taller': 'CmdOrCtrl+B Alt+Down'
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

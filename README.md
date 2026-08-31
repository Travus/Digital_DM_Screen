# Digital DM Screen

[![CI](https://github.com/Travus/Digital_DM_Screen/actions/workflows/ci.yml/badge.svg)](https://github.com/Travus/Digital_DM_Screen/actions/workflows/ci.yml)

A tiling DM screen for running tabletop games. Split the window into as many panes as you want, drop a module into each one, and save the whole arrangement as a layout file. The file includes every panel's settings and contents, and you can reopen it or give it to a friend. A layout can span several windows: one for what you reach for constantly, another for what you check rarely, and one your players can see.

The app runs on Windows, Linux and Apple-silicon Macs. It is built with Electron, React and TypeScript.

![The starter layout](docs/screenshot.png)

## Modules

| | Module | What it does |
|---|---|---|
| 🩸 | **Conditions** | Every status condition and its full effects, searchable. Conditions named inside another condition's text are hoverable, so Paralyzed tells you what Incapacitated means without leaving the panel. |
| 📖 | **Rules Reference** | Actions, special attacks, cover, vision, DCs, travel, improvised damage, objects, resting. Choose which tabs a panel shows. |
| ✨ | **Player Abilities** | Metamagic and channel divinity, one tab each, labelled with the source of each option. Star the options your players took and they pin to the top. |
| 🧫 | **Diseases** | Nine diseases, each with its saves, symptoms and cure: the six that the *contagion* spell inflicts, plus Cackle Fever, Sewer Plague and Sight Rot. |
| 🛡️ | **Party Tracker** | Your party, with customisable columns: number, text, checkbox, current/max meter, or togglable symbols. Add, rename, reorder and retype columns in the panel's settings, and drag a header's edge to resize it. |
| ⚔️ | **Initiative Tracker** | Turn order, round counter, HP with damage and heal entry, conditions per combatant. *+ Party* pulls everyone straight out of a Party Tracker panel and keeps their AC and HP in sync with it afterwards. |
| 📊 | **Counters & Tracks** | Resource counters (torches, rations, charges) and segmented progress tracks for things that close in. |
| 📝 | **Notes** | A scratchpad that travels with the layout, with bold and italic support. |
| ▦ | **Table** | Rows and columns you fill in: shop stock, travel times, loot. Blocks copy and paste to and from a spreadsheet, and cells can take bold and italic formatting. |
| 🖼️ | **Image** | A map, a handout or a portrait, held open beside everything else. Drop a file on the panel or choose one, then drag to pan and use the wheel to zoom. |
| 🎲 | **Dice Roller** | Roll a number of set rolls, or roll a custom roll formula. Has a running history and configurable quick buttons. |
| 🎯 | **Big Dice** | One oversized die that you throw with a click, for rolls the whole table watches. |
| 🗒️ | **Random Tables** | Your own roll tables, edited in place, one tab per table. |
| 🎭 | **Name Generator** | Names for people, taverns and shops. Expand any of them into a whole NPC (quirk + motive) or a whole place (detail + hook), and keep the ones you like. |
| ⏱️ | **Timers** | Count-up and count-down timers: session length, a player's turn, a burning fuse. |

Panels with a `⚙` in the header have settings. Those settings are saved with the layout too.

### Initiative ↔ party sync

Combatants added with **+ Party** stay linked to the character they came from, shown by a ⇄ on the row. Damage applied in initiative updates the party panel, and the reverse, even when the two panels sit in different windows. The party panel opts in by naming its columns exactly **AC** (number) and **HP** (meter). Turn the sync off per panel in the initiative settings.

## Using it

**Tiling.** Every panel's `⋯` menu has *Split right* and *Split down* (`Cmd/Ctrl+\` and `Cmd/Ctrl+Shift+\`). Splits nest freely, so one tall pane on the left with two stacked on the right is two splits. Drag the bar between panes to resize them, and double-click it to even out that row or column.

**Rearranging.** Drag a panel by its header onto another panel and the two swap places. `Cmd/Ctrl+Alt+←/→/↑/↓` swaps with the panel on that side without the mouse.

**Fullscreen.** The `⤢` button in a panel header expands it to fill the window. `Esc` or the floating button at the bottom brings the tiling back, and `Cmd/Ctrl+Enter` does the same from the keyboard.

**Windows.** *Layout → New Window* (`Cmd/Ctrl+Shift+N`) opens a second window with its own tiling. Panels drag between windows just as they do within one. Closing a secondary window keeps it in the switcher, ready to reopen. Closing the main window quits the app. All windows are saved as part of the same layout.

**Locking.** Once a screen is arranged the way you want it, click the padlock in the top bar (or press `Cmd/Ctrl+L`). Panes can then no longer be resized, split, swapped, closed or renamed, so nothing moves by accident mid-session. Everything *inside* the panels carries on as normal.

**Layouts.** *Save* writes a `.dmscreen` file holding every window and panel, its settings, and its live contents: your party roster, your notes, your random tables. *Recent* in the top bar (also under **Layout → Open Recent**) lists what you opened before. The app also stashes whatever is on screen automatically, so closing it without saving costs nothing. It comes back exactly as you left it.

Double-click a panel title to rename it, or press `F2`. Click the layout name in the top bar, or press `Shift+F2`, to rename the layout.

Some ready-made layouts live in [`examples/`](examples/), but you are encouraged to arrange your own.

## Data packs

The reference modules ship SRD content only, so Player Abilities has Metamagic and Channel Divinity and nothing else out of the box. A data pack is a JSON file that adds your own conditions, diseases, ability tabs, rules sections and name generator pools on top, loaded from **Data → Import Data Pack…** (`Cmd/Ctrl+Shift+D`). The same menu turns the bundled content off — SRD and name pools on separate switches — so a pack can replace either entirely rather than sit beside it.

See [docs/data-packs.md](docs/data-packs.md) for the file format and a worked example.

## Keyboard

### The action palette

`Cmd/Ctrl+Shift+P` (or **View → Action Palette…**) floats a searchable list of every command the app has, and runs the one you pick with Enter. Arrow keys move, `Esc` puts it away, and typing filters on the command name or on the menu it lives under, so `data` brings up everything in the Data menu at once.

It is how you reach the commands that ship with no key of their own, which is most of them. Each row shows its shortcut if it has one, so the palette is also how you learn them. The list is context aware, so locking the layout greys out splitting, closing, renaming and rearranging.

It is also a calculator. Type digits instead of a command — `12 * 8`, `(120 + 30) / 4`, `2d6+3`, `4d6kh3` — and it works the sum out on the spot rather than listing anything. Enter rolls again when there are dice in it. The syntax is the Dice Roller module's, so anything that module takes works here too; the module is still where you go for a running log of what you rolled.

### Shortcuts

These are the defaults. **Help → Keyboard Shortcuts…** rebinds any of them.

| Key | Action |
|---|---|
| `Cmd/Ctrl+\` | Split the active panel right |
| `Cmd/Ctrl+Shift+\` | Split the active panel down |
| `Cmd/Ctrl+Alt+←/→/↑/↓` | Swap the active panel with its neighbour in that direction |
| `Cmd/Ctrl+Alt+Shift+←/→/↑/↓` | Resize the active panel, moving its edge in that direction |
| `Cmd/Ctrl+Enter` | Fullscreen the active panel |
| `Esc` | Leave fullscreen |
| `Cmd/Ctrl+W` | Close the active panel |
| `F2` | Rename the active panel |
| `Shift+F2` | Rename the layout |
| `Cmd/Ctrl+L` | Lock or unlock the layout |
| `Cmd/Ctrl+N` | New layout |
| `Cmd/Ctrl+O` | Open a layout |
| `Cmd/Ctrl+S` | Save |
| `Cmd/Ctrl+Shift+S` | Save as |
| `Cmd/Ctrl+Shift+N` | New window |
| `Cmd/Ctrl+Shift+W` | Close this window |
| `Cmd/Ctrl+B` | Bold, in Notes and Table cells |
| `Cmd/Ctrl+I` | Italic, in Notes and Table cells |
| `Cmd/Ctrl+Shift+D` | Import a data pack |
| `Cmd/Ctrl+Shift+P` | Open the action palette |

### Two-key sequences

A shortcut can also be two keystrokes in a row, the way Emacs, Vim and tmux work. Press `Ctrl+B`, let go, then press `5`. To record one, press the second key straight after the first. The first needs a modifier, and the second can be anything.

A sequence cannot *start* on a key that is already a shortcut by itself. `Ctrl+W` closes a panel, so nothing can begin `Ctrl+W …` until you move it. Finishing on such a key is fine, so `Ctrl+K Ctrl+S` works beside `Ctrl+S` for save.

### Starting from another editor's keymap

The shortcuts window has a **Start from** row: **Default**, **VS Code**, **Cursor**, **Zed**, **Sublime Text**, **JetBrains**, **Vim**, **tmux**, and **None** to unbind everything.

They cover only what the tool has an opinion about. Vim and tmux drive panes and say nothing about saving files, so those keep their usual keys.

## Installing

Installers for Windows, Linux and Apple-silicon Macs are attached to every [release](https://github.com/Travus/Digital_DM_Screen/releases).

The Mac build is signed ad-hoc rather than with a paid Apple Developer ID, so Gatekeeper cannot verify a downloaded copy. Copy the app to Applications, then clear quarantine once:

```sh
xattr -dr com.apple.quarantine '/Applications/Digital DM Screen.app'
```

## Contributing

Bug reports, ideas and pull requests are all welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the tests and how to add a module of your own.

## Licence

Two licences, because two different things live here. The code is MIT. The reference text under `src/renderer/src/data/` is summarised from the D&D System Reference Document 5.1 and is used under CC BY 4.0. See [LICENSE.md](LICENSE.md) for the full terms and the required attribution.

That split is why the shipped content is SRD-only. The SRD carries one archetype per class, so there is no Battle Master tab, and Channel Divinity covers only the Life domain and the Oath of Devotion. Anything beyond that loads at runtime from a data pack, which is not part of this repository and not covered by either licence.

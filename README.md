# Digital DM Screen

A tiling DM screen for running tabletop games. Split the window into as many
panes as you want, drop a module into each one, and save the whole arrangement —
panel settings and contents included — as a layout file you can reopen or hand to
a friend.

Runs on Windows and Linux. Built with Electron, React and TypeScript; the entire
toolchain lives in Docker, so nothing needs installing on the host.

![The starter layout](docs/screenshot.png)

## Using it

**Tiling.** Every panel's `⋯` menu has *Split right* and *Split down*
(`Ctrl+\` and `Ctrl+Shift+\`). Splits nest freely, so the classic "one tall pane
on the left, two stacked on the right" is two splits. Drag the bar between panes
to resize; double-click it to even that row or column out. Closing a panel hands
its space back to its neighbours.

**Fullscreen.** The `⤢` button in any panel header blows it up to fill the
window; `Esc` or the floating button at the bottom brings the tiling back.
`Ctrl+Enter` does the same from the keyboard.

**Locking.** Once a screen is arranged the way you want it, hit the padlock in
the top bar (or `Ctrl+L`). Panes can no longer be resized, split or closed, and
the drag handles between them disappear so there is nothing to catch by
accident mid-session. Everything *inside* the panels carries on as normal —
including dragging party tracker columns. The lock is saved with the layout.

**Layouts.** *Save* writes a `.dmscreen` file containing the tree, every panel's
module, its settings and its live contents — your party roster, your notes, your
random tables. *Recent* in the top bar (also under **Layout → Open Recent**)
lists what you have opened before. Whatever is on screen is also stashed
automatically, so closing the app without saving costs nothing: it comes back
exactly as you left it.

Double-click a panel title to rename it; click the layout name in the top bar
(or press `F2`) to rename the layout.

There is a ready-made layout in [`examples/starter.dmscreen`](examples/starter.dmscreen)
— **Open** it to see a populated screen.

## Modules

| | Module | What it does |
|---|---|---|
| 🩸 | **Conditions** | Every status condition and its full effects, searchable. Conditions named inside another condition's text are hoverable — Paralyzed tells you what Incapacitated means without leaving the panel. |
| 📖 | **Rules Reference** | Actions, special attacks, cover, vision, DCs, travel, improvised damage, objects, resting. Choose which tabs a panel shows. |
| ✨ | **Player Abilities** | Metamagic, battle master maneuvers and channel divinity, one tab each — PHB plus TCE, XGE, MOT, GGR and SCAG, each labelled with the book it came from. Star the options your players actually took and they pin to the top. |
| 🧫 | **Diseases** | The six PHB diseases, the three from the DMG, and bluerot from GOS. |
| 🛡️ | **Party Tracker** | Your party, with columns *you* define — number, text, checkbox, current/max meter, or **symbols**. Add, rename, reorder and retype columns in the panel's settings; drag the divider at the right edge of any header to resize a column, double-click it to reset. |
| ⚔️ | **Initiative Tracker** | Turn order, round counter, HP with damage/heal entry, conditions per combatant. *+ Party* pulls everyone straight out of a Party Tracker panel, and keeps their AC and HP in sync with it afterwards. Optionally hides enemy HP. |
| 📊 | **Counters & Tracks** | Resource counters (torches, rations, charges) and segmented progress tracks for things closing in. |
| ⏱️ | **Timers** | Count-up and count-down timers — session length, a player's turn, a burning fuse. Names are always editable; a countdown's duration can be changed whenever it isn't running. |
| 📝 | **Notes** | A scratchpad that travels with the layout. |
| 🎲 | **Dice Roller** | `2d6+3`, `4d6kh3`, `4d6dl1`, `250d20` — with a running history and configurable quick buttons. |
| 🗒️ | **Random Tables** | Your own roll tables, edited in place, one tab per table. |
| 🎭 | **Name Generator** | Names for people, taverns and shops. Flesh any of them out into a whole NPC (quirk + motive) or a whole place (detail + hook), and keep the ones you like. |

Panels with a `⚙` in the header have settings; those settings are saved with the
layout too.

### Initiative ↔ party sync

Combatants added with **+ Party** stay linked to the character they came from,
shown by a ⇄ on the row. Damage applied in initiative updates the party panel and
vice versa — there is one set of numbers, not two. The party panel opts in by
naming its columns exactly **AC** (number) and **HP** (meter); a column that
isn't there simply isn't synced. Turn it off per panel in the initiative
settings.

### Symbol columns

A **symbols** column holds one or more glyphs you pick per column, and each one
toggles between lit and dimmed per character — a checkbox that says what it is
about. Good for things a character either still has or has spent: a deity's
blessing, a one-shot luck reroll, an unused potion. Pick the glyphs from the
palette in the panel's settings, or paste any character you like. Repeating the
same glyph is fine — three ⭐ makes a three-charge tracker, and each toggles
independently.

## Keyboard

| Key | Action |
|---|---|
| `Ctrl+\` / `Ctrl+Shift+\` | Split the active panel right / down |
| `Ctrl+Enter` / `Esc` | Fullscreen the active panel / return |
| `Ctrl+W` | Close the active panel |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | New / open / save / save as |
| `F2` | Rename the layout |
| `Ctrl+L` | Lock or unlock the layout |

## Building

Everything runs through Docker Compose — no Node, no Electron on the host.

```sh
docker compose run --rm build npm install       # first time, and after dependency changes
docker compose run --rm build npm run dist:all  # Windows + Linux installers → ./release
```

`dist:all` produces, in `release/`:

- `Digital DM Screen-<version>-x64-setup.exe` — Windows installer
- `Digital DM Screen-<version>-x64-portable.exe` — Windows, no install
- `Digital DM Screen-<version>.AppImage` — Linux, no install
- `digital-dm-screen_<version>_amd64.deb` — Debian/Ubuntu

Use `dist:win` or `dist:linux` for one platform. Windows targets are cross-built
from Linux through Wine, which is why the compose service uses the
`electronuserland/builder:wine` image.

`node_modules` lives in a named volume rather than on the host, so Linux-only
binaries never touch your Windows checkout. `release/` is a bind mount, so the
finished installers land in the working tree.

### Other commands

```sh
docker compose run --rm build npm run typecheck  # tsc over main, preload and renderer
docker compose run --rm build npm run build      # bundles only, no packaging
docker compose run --rm smoke                    # headless render check → release/smoke/*.png

docker compose run --rm build node scripts/audit-deps.mjs           # supply-chain check
docker compose run --rm build sh -c 'npm audit --json | node scripts/audit-summary.mjs'
```

`audit-deps.mjs` reports the resolved tree, flags anything not served from
registry.npmjs.org or missing an integrity hash, and lists every package that
runs an install script — worth a glance after any dependency change.

`smoke` launches the built app on a virtual display, screenshots it, and fails on
a renderer error — useful for checking the UI still draws without a desktop
session.

The app icon is committed twice: `build/icon.png` at 1024×1024, which Windows
converts to an `.ico`, and `build/icons/*.png`, the size set the Linux packages
install into `hicolor`. Linux needs the set because electron-builder ships a
lone png at whatever size it already is, and nothing looks for icons in a
`1024x1024` directory. After editing `build/icon.svg`, regenerate both with:

```sh
docker compose run --rm --entrypoint bash smoke -lc scripts/gen-icons.sh
```

### Running it while developing

`electron-vite dev` needs a display, so it has to run on the host (or on a Linux
box with X). The Docker workflow above covers install, typecheck, packaging and
the headless render check.

## How a layout file is structured

```jsonc
{
  "formatVersion": 1,
  "name": "Starter screen",
  "root": {                      // a split holds any number of children, and nests
    "type": "split",
    "direction": "row",          // "row" = side by side, "column" = stacked
    "sizes": [0.56, 0.44],       // flex weights, one per child
    "children": [ /* panel or split nodes */ ]
  },
  "locked": false,               // freezes sizes and positions when true
  "panels": {                    // keyed by the panelId a leaf node points at
    "panel_init": {
      "moduleId": "initiative",
      "settings": { /* module-defined */ },
      "state": { /* module-defined */ }
    }
  }
}
```

Panel state is merged over each module's defaults when loaded, so a layout saved
by an older version keeps working when a module gains new options. Files are
validated on open: a malformed tree is rejected, but an unrecognised panel
degrades to an empty one rather than losing the rest of the layout.

## Adding a module

Modules are self-contained. Create one in `src/renderer/src/modules/`:

```tsx
export const myModule = defineModule<State, Settings>({
  id: 'my-module',
  name: 'My Module',
  icon: '🔮',
  blurb: 'Shown in the module picker.',
  category: 'Tools',              // Reference | Tracking | Tools
  defaultState: () => ({ ... }),
  defaultSettings: () => ({ ... }),
  Component: MyModule,            // gets { state, setState, settings, setSettings }
  Settings: MySettings            // optional; adds the ⚙ button
})
```

Then add it to `MODULES` in `src/renderer/src/modules/registry.ts`. Persistence,
the picker, fullscreen and the settings drawer come for free — `setState` writes
straight into the layout document.

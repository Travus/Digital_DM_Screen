# Working on this project

Context for an AI assistant picking this up cold. Read this before changing
anything — several of the notes below are bugs that have already been paid for
once.

## What it is

A tiling digital DM screen for tabletop RPGs. Electron + React + TypeScript.
The window splits into arbitrary panes; each pane holds a *module*; the whole
arrangement — including every module's settings and live contents — saves to a
`.dmscreen` JSON file. Audience is one DM and a few friends, not a product.

## Hard rules

**Never run node, npm or tsc on the host.** The entire toolchain lives in
Docker. The host has no Node install and the user wants it kept that way.

```sh
docker compose run --rm build npm install       # after dependency changes
docker compose run --rm build npm run build     # typecheck + bundle
docker compose run --rm build npm run dist:all  # installers -> ./release
docker compose run --rm smoke                   # headless render check
```

`node_modules` lives in a named volume, so Linux-only binaries never touch the
Windows checkout. `release/` is a bind mount so installers land in the tree.

**Verify UI changes by looking at them.** `docker compose run --rm smoke`
launches the built app on a virtual display and screenshots it into
`release/smoke/*.png`. Read those images. This has caught real bugs that
typechecking could not — a panel not filling its container, a font hijacking
digits, a list that silently ignored clicks.

## Architecture

- `src/shared/` — types and the layout tree, used by both main and renderer.
- `src/main/` — window, native menu, file dialogs, recents, session autosave.
- `src/preload/` — the `window.dmscreen` bridge. Sandboxed; only uses
  `contextBridge` and `ipcRenderer`.
- `src/renderer/src/modules/` — one file per module, registered in
  `registry.ts`. Adding a module needs nothing else: persistence, the picker,
  fullscreen and the settings drawer all come from the host.
- `src/renderer/src/components/ReferenceList.tsx` — the shared searchable card
  list behind Conditions, Player Abilities and Diseases.

The layout is an n-ary tree: a `split` holds any number of children in a row or
column, with `sizes` as flex weights; a `panel` leaf points at an entry in
`doc.panels`. All tree operations are pure functions in `src/shared/layout.ts`.

## Lessons already learned the hard way

**Panel state is sparse.** `doc.panels[id].state` holds only what the user has
changed; module defaults are merged over it at render time. So a panel the user
has barely touched has almost no state of its own. Anything reading *another*
panel's state must merge over that module's declared defaults — see
`defaultPartyFields()` and `src/renderer/src/lib/partyLink.ts`. Reading
`state.fields` directly is how the initiative/party sync silently did nothing
for every party panel whose columns had never been opened.

**`defaultState()` must be stable.** It is called to build the merge base, and
if it mints fresh ids each time, anything that persisted a reference to one of
those ids is instantly stale. `PanelFrame` caches defaults per mounted module in
a **ref** — not `useMemo`, which React may discard. Module defaults also use
literal ids (`'tbl_complications'`, not `uid()`). Getting this wrong made the
second Random Tables tab unclickable and swallowed the first click on every
starter tracker.

**Never put an emoji font in the body font stack.** Noto Color Emoji also
covers digits and the space character, so it hijacks ordinary text — numbers
render wide and words gain gaps. Emoji fonts are scoped to `.emoji`,
`.panel-icon` and `.picker-icon` only. Putting them *after* the generic
fallback is not enough; it must be scoped.

**Escape belongs to the renderer.** A menu accelerator for Escape swallows the
key application-wide, including inside text fields. Panel fullscreen exits via
a `keydown` listener in `App.tsx`.

**The portable exe locks itself while running.** If the user has
`release/…-portable.exe` open, `dist:win` fails with a bare "Error - aborting
creation process" from NSIS. Check for a running `Digital DM Screen` process
before blaming the build. Don't kill it — ask.

**Don't key build-completion checks on a filename existing.** A stale artifact
from a previous run looks identical to a fresh one. Key on the process exiting,
or compare timestamps.

**The Linux icon must be a set, not one png.** Handed a single png,
electron-builder does not resize it — it installs that one file into
`hicolor/<its own size>/apps/`. `build/icon.png` is 1024x1024, and hicolor
defines no `1024x1024` directory, so the lookup found nothing and the installed
`.deb` showed a blank icon. `linux.icon` therefore points at `build/icons/`,
which holds the sizes hicolor actually indexes; `scripts/gen-icons.sh` renders
them from `icon.svg`. `build/icon.png` stays as-is — Windows converts it to
`.ico`, where one large source is correct.

**Don't set `Categories` under `linux.desktop.entry`.** The entry is merged
first, then `Categories` is overwritten unconditionally from `linux.category`,
so anything set there is silently discarded. `linux.category` is the only knob;
to ship more than one category, put them all in it.

## Data packs

Shipped reference data is **SRD only** — that is what makes the repo licensable
(MIT for code, CC BY 4.0 for the text). Everything else loads at runtime from a
`.dmpack.json`, and lives outside this repo.

- **`resolve()` in `src/renderer/src/data/resolve.ts` is the whole merge.** It is
  **total**: it collects problems into `warnings` and never throws. The only UI
  for removing a bad pack is the native menu, so a renderer that died on load
  would leave no way out.
- **Containers extend, entries don't.** An `AbilityGroup` or `RuleSection` whose
  id matches one already loaded merges its contents in — that is how a pack adds
  one manoeuvre without restating twenty-two. So **container ids are never
  namespaced**; matching is the point, and `defaultState()` names them by literal.
- **Entry ids are namespaced `source:id`.** Two sources both defining
  `mm-careful` would otherwise share a favourites key and a React key — starring
  one would star both. `migrateIds()` reads pre-namespace state as `bundled:`.
- **Conditions collide on *name*, not id.** The name is what the cross-reference
  popover scans prose for, and what the initiative tracker persists against
  combatants.
- **The snapshot crosses to the renderer synchronously**, via the one `sendSync`
  channel in an otherwise all-`handle` bridge. See the next entry for why.
- Data lives in **`dataStore`, not `useAppStore`** — everything in the latter
  funnels through `mutate()`, which sets `dirty` and rides into the autosaved
  session. Loading a pack must not mark a layout unsaved.

**An empty condition list used to hang the renderer.** The cross-reference
scanner built `/\b(a|b|c)\b/gi` from the loaded condition names; with none, that
becomes `/\b()\b/gi`, which matches the empty string at the first word boundary
without advancing `lastIndex`. Every reference card renders through that loop, so
switching SRD Content off froze the app rather than showing an empty panel.
`buildPattern()` returns null for an empty list, and the loop nudges `lastIndex`
past any zero-length match. The `conditions-empty` smoke shot exists to catch a
regression — it would time out at 60 s, not fail quietly.

**Distinguish "hidden" from "not loaded".** Both leave a reference module with
nothing to show, but "re-enable it in this panel's settings" is actively wrong
when the cause is a switch in the Data menu. Every reference module checks the
unfiltered set first.

## Pinned dependencies

Deliberate, with reasons; see `//pinned` in `package.json`.

- **zustand at 4** — v5 removed the `useStore(selector, equalityFn)` overload
  that the initiative/party sync uses to avoid re-rendering on every keystroke.
- **vite at 7** — electron-vite 5 peers on `^5 || ^6 || ^7`.
- **@vitejs/plugin-react at 5** — 6.x demands vite 8.
- **react at 18, typescript at 5** — nothing here needs 19 or the TS 7 rewrite.

Electron itself should stay current: it ships Chromium to the user, so an
out-of-support Electron means shipping unpatched browser CVEs.

## Rules data

Everything under `src/renderer/src/data/` is game reference text. It is
**2014-edition** D&D.

Verify against a source rather than writing from memory — several errors were
found that way (Mithral/Adamantine object AC, fragile vs resilient object HP, a
fabricated improvised-damage example, a missing clause in Dodge).

- `https://www.dnd5eapi.co/api/2014/...` works and is the easiest check —
  `conditions`, `rule-sections`, `spells`. SRD content only.
- `2014.5e.tools` returns 403 to direct fetches.
- Non-SRD content (TCE/XGE/MOT maneuvers, domains, oaths) needs a web search.

**Source labelling convention:** `meta` always leads with the book, then any
further qualifiers, separated by ` · `, never parenthesised —
`XGE · Cleric · Forge`, `TCE · 2 sorcery points`, `DMG · Humanoids only`. Cite
where an option *first* appeared, not a reprint (Oath of Glory is MOT, not TCE;
Order domain is GGR, not TCE). Use short codes: PHB, DMG, XGE, TCE, MOT, GGR,
SCAG, GOS.

## The smoke harness

`scripts/smoke.mjs` drives the built app. Each shot may:

- `layout` — seed a session from a `.dmscreen` file, or `null` for empty
- `mutate(doc)` — adjust that layout for states clicking can't reach
- `click` — newline-separated CSS selectors, clicked *and* focused in sequence
  (focus is what reveals the condition cross-reference popovers)
- `settle` — extra dwell before capture, for anything that changes over time

Picker cards carry `data-module-id`, so `.picker-card[data-module-id="timers"]`
is a stable way into any module from an empty layout.

## Style

Match the surrounding code. Comments explain *why*, not what — most existing
comments mark a decision or a trap, and that is the bar. British spelling in
user-facing text. No test suite; the smoke check and typechecking are the net.

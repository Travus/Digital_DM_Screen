# Working on this project

Context for an AI assistant picking this up cold. Read this before changing
anything — several of the notes below are bugs that have already been paid for
once.

**A PR that invalidates a paragraph in this file updates that paragraph.**
Documentation is not a separate task queued behind the work.

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
docker compose run --rm build npm run check     # format + lint + typecheck
docker compose run --rm build npm run build     # typecheck + bundle
docker compose run --rm build npm run dist:all  # installers -> ./release
docker compose run --rm smoke                   # headless render check
```

The rule is about *this* machine, not about ephemeral CI runners — see the CI
section below for where it does and does not carry over.

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

That listener does not check modifiers, so `Ctrl+Escape` leaves fullscreen too.
Escape is therefore reserved in *every* combination, not just bare — see
`checkAccelerator`.

## Keybindings

`src/shared/actions.ts` is the catalogue: one entry per command, with its default
accelerator. It is the only place a binding is written. `src/main/menu.ts` reads
accelerators from it, and so does the renderer for every caption.

That used to be two copies — literal `accelerator:` strings in `menu.ts` and a
literal table in `lib/shortcuts.ts`, whose own comment said the two had to be
edited together. Constants can survive that. A user-editable binding cannot: the
copy that is not the keymap just becomes a caption that lies.

**Overrides are sparse, and `??` is the wrong merge.** `keybindings.json` holds
only what the user changed, so a later change to a default still reaches anyone
who never touched it — the same argument as panel state. But `null` there means
*deliberately unbound*, which is not the same as absent, and
`overrides[id] ?? default` silently turns one into the other. `resolveKeymap`
tests presence with `hasOwnProperty`. A test caught this; nothing else would
have, because the wrong behaviour looks exactly like the right one until someone
clears a binding.

**A bad accelerator costs you the whole menu.** `Menu.buildFromTemplate` throws
on a malformed string, and the menu is where Help → Keyboard Shortcuts… lives —
so the throw takes away the only route to undoing what caused it. `sanitiseKeymap`
is therefore total in the way `resolve()` is: it collects warnings and drops bad
entries rather than raising. `menu.ts` re-checks anyway before building.

**Record from `event.code`, not `event.key`.** With Shift held, `key` reports the
*shifted* character, so the shipped default `CmdOrCtrl+Shift+\` would record as
`CmdOrCtrl+Shift+|` and never match. `code` names the physical key, which also
keeps a chord put on a non-US layout.

**The macOS Edit roles are load-bearing.** `Cmd+C/V/X/A/Z` work in text fields
only because the OS routes them through the menu; shadowing one kills copy and
paste app-wide. They are reserved in all three spellings of the primary modifier,
since a user recording on macOS produces `Cmd` and on Windows `Ctrl` while the
catalogue stores `CmdOrCtrl`.

### Two-stroke sequences

A binding is one stroke or two, space-separated in `keybindings.json`:
`"CmdOrCtrl+K CmdOrCtrl+S"`. Emacs writes that `C-x C-s`; JetBrains calls the
second half a "second stroke".

**Dispatch is split, and the split is forced.** An Electron accelerator is
single-stroke only, so a sequence cannot be one. Single-stroke bindings stay menu
accelerators; sequences run through `advanceChord` in
`src/renderer/src/lib/chords.ts`. Do not "simplify" this by moving everything to
the renderer — the menu would then show no accelerators at all, and
`registerAccelerator: false` (display without registering) is **macOS-only**, so
there is no cross-platform way back.

**A menu accelerator beats the renderer, so the menu gives the stroke up.**
Electron fires accelerators before the web page sees the key — the same mechanism
as the Escape trap above. The fix is not to suppress the accelerator while a
prefix is pending (stateful, and it gets stuck); it is `rendererSingles`: any
single-stroke binding whose stroke is *also* used by a sequence loses its
accelerator permanently and is dispatched by `advanceChord` instead. Both sides
compute that set from the same keymap, so they cannot disagree about who owns a
key.

**The native accelerator column shows what the menu will fire, and nothing else.**
So a sequence, and a stroke handed to the renderer, both leave it blank. Writing
them into the label instead — `Split Down  (Ctrl+K Ctrl+\)` — was tried and
reverted: it put two different treatments in one menu, native-right-aligned for
some rows and parenthesised body text for others, which reads as a bug rather
than as information. The column means one thing on every platform and a sequence
is not expressible in it. The ⋯ panel menu and the shortcuts editor render
sequences properly and sit closer to where they are used, so nothing is lost that
a user cannot reach.

**Only the opening stroke is contested.** A second stroke may reuse a stroke that
is bound on its own, because a pending prefix says which was meant —
`CmdOrCtrl+K CmdOrCtrl+S` and `CmdOrCtrl+S` coexist. A *first* stroke cannot,
because pressing it would have to mean both "run that action" and "wait, a
sequence is starting", and nothing later in time resolves it; the single-stroke
binding would have to fire late, on a timeout, forever. `findConflict` returns
`prefix-taken`/`prefix-blocks` for that and nothing else.

This is what makes the VS Code, Zed and Sublime keymaps expressible — every one
of them finishes a sequence on a stroke that is separately bound. The earlier
rule refused all of them.

**Only the first stroke needs a modifier; the second may be bare.** That is not
laxity, it is the whole feature: `C-w v` and `C-b %` finish on a plain key. It
stays safe because a sequence can only *begin* on a modified stroke, so ordinary
typing can never open one.

**Emacs cannot have its own prefix, and this is not fixable here.** `C-x` is Cut.
On Windows and Linux that key is handled by Chromium in any editable field
whatever the menu does, so it is not ours to give away. On macOS Cut is `Cmd+X`
and `Ctrl+X` would in fact be free — the reservation is over-broad there — but
freeing it only on Darwin makes one `keybindings.json` behave differently per
platform, which is worse than the over-reservation. Left deliberately blunt.

**A pending prefix times out; Emacs and VS Code wait forever.** Different stakes:
a DM who fumbles a prefix mid-session would otherwise have the app silently eat
whatever they typed next. Two seconds, plus a conspicuous indicator, because a
swallowed keystroke with no explanation reads as a dropped key.

**Recording waits 900 ms after the first stroke.** There is no way to tell
`Ctrl+S` from the opening of `Ctrl+K Ctrl+S` except by waiting — they are
identical up to that point. The alternative was an explicit "record a sequence"
toggle, which taxes every ordinary rebinding to avoid a pause that lands once.

### Presets

`src/shared/presets.ts` holds the borrowed keymaps, in the spirit of Zed's base
keymap list. Each is a **sparse** override map applied wholesale — replacing
every override, never merging. Merging is how you end up with a prefix that still
fires something on its own, which is the one arrangement nothing can resolve.

**Every binding is sourced from the tool, not remembered.** Zed's came out of
`assets/keymaps/default-linux.json` in their repo; VS Code's split-down is
`workbench.action.splitEditorOrthogonal`. A preset wearing a tool's name and
guessing at its bindings is worse than not shipping it.

**A preset must not contradict itself**, and the way it does is subtle: Vim's
window commands all sit behind `Ctrl+W`, which ships bound to Close Panel, so the
preset has to claim that too or the menu owns the prefix and no sequence ever
starts. A test resolves each preset in full and runs every binding through
`findConflict`. Another asserts no preset is a no-op — that is why Cursor is
absent rather than shipped as a duplicate of VS Code.

### The action palette

`Cmd/Ctrl+Shift+P`. `src/renderer/src/lib/palette.ts` decides what it shows;
`components/ActionPalette.tsx` is only the window around that.

**It is the catalogue, rendered.** Rows are `ACTIONS` filtered by `enabled`, with
the live binding beside each one — so a command added to `actions.ts` appears in
the palette with no further wiring, and its key cannot become a caption that
lies. That is the same argument that collapsed the two copies of the accelerators
in the first place.

**`ActionDef.enabled` is what makes it honest**, and is no longer unused. A menu
can carry a row that quietly does nothing; the palette is the discovery surface,
so offering "Close panel" on a locked layout is a wrong answer rather than a dead
one. Every predicate restates a guard that already exists somewhere imperative —
`store.closePanel`'s early return, `PanelFrame`'s omitted rows, `App`'s
`if (target)`. Filtering rows out rather than greying them is deliberate and
matches the ⋯ menu, but the palette says *why* the list is short when the layout
is locked: half a list with no explanation reads as a broken palette.

**The last query is remembered, the last row is not.** A module-level `let` in
`ActionPalette.tsx` — outside React and outside every store, because it must
outlive the component, is nobody's document state, and writing it must not
render anything. Reopening lands on the same filtered list with the text
selected, so repeating a command is two keys and a different search is just
typing over it.

Remembering the highlighted *index* as well would look like the obvious next
step and is not: an index means a different command as soon as the context
changes — lock the layout and the structural rows vanish — so restoring one
hands a blind Enter to whatever moved into that position. The text re-filters
against the current list and cannot do that.

**Quit is in the catalogue, `fixed`.** The issue asked for "close the app" to be
reachable, and a palette row needs a command to point at. `fixed` already meant
"a key some other layer owns app-wide" — Escape belongs to the renderer, Quit to
the system menu item — so it carries the *reason* as its value now, and the
editor shows that rather than a hardcoded sentence about Escape.

Its accelerator is written onto `role: 'quit'` from the keymap even though the
role supplies the same key unprompted (`getDefaultRoleAccelerator()` returns
`CommandOrControl+Q` — measured, not assumed). Left implicit it would be the one
row in the menu where what the palette claims and what the menu fires agreed by
coincidence.

**A single-stroke accelerator cannot be smoke-tested by `press`.** Electron fires
it before the page sees the key, so a synthetic `keydown` for `Ctrl+Shift+P` is
correctly ignored by `advanceChord` and opens nothing. The palette shots use
`menu:` instead. To check that an accelerator really registers, build the
template and read it back — `Menu.buildFromTemplate([...]).items[0].accelerator`
under `xvfb-run node_modules/.bin/electron` in the smoke container.

**A panel clips anything laid out inside it.** `.panel` is `overflow: hidden`,
so an absolutely positioned popover is cut off at the panel edge — the ⋯ menu
lost its last rows, "Close panel" among them, in any panel shorter than the
menu. Anything overhanging a panel is therefore `position: fixed` and placed
from JS: `placeMenu()` for the panel menu, and `ConditionPopover` inline for the
cross-reference cards. That escapes the clip because no ancestor of a panel sets
`transform`, `filter` or `contain` — any of which would make itself the
containing block and bring the clipping back.

Escaping the clip means nothing keeps the popover inside the *window* either, so
placement has to flip and clamp for itself. And a smoke shot only proves it if
the panel it opens in is too small to hold it: `panel-menu` opens the same menu
on a full-height panel and stayed green throughout.

**The portable exe locks itself while running.** If `release/…-portable.exe` is
open, `dist:win` fails with a bare "Error - aborting creation process" from NSIS,
with nothing pointing at the cause. Worse, the Linux targets and the NSIS
installer may build fine first, so you get a half-fresh `release/` — the portable
silently stays at its old build under an unchanged filename.

Gate the build on the check rather than just printing it; a check whose result
you ignore is decoration:

```powershell
if (Get-Process 'Digital DM Screen*' -EA SilentlyContinue) { "close the app first" }
else { docker compose run --rm build npm run dist:all }
```

**Closing it is pre-authorised** — Travus asked for it to be force-closed rather
than being prompted every time.

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

**`Comment` is overwritten the same way, from `description`.** So a long deb
description would also become the desktop file's one-line tooltip, and setting
`desktop.entry.Comment` cannot rescue it. The deb's own description therefore
goes to fpm directly, as a second `--description` in `deb.fpm` — fpm gets the
flag twice and keeps the last. Worth knowing that the override is positional:
electron-builder pushes `options.fpm` after the args it builds itself, and if
that ever changes the description silently reverts to the one-liner. `dpkg-deb
-I` on the built package is what says which one won.

**The Linux install screen reads the control file and nothing else.** Opening a
`.deb` in GNOME Software shows the *package* name, the control Description, and
`Homepage` as "Project Website" — and no icon, because nothing is unpacked yet.
Its `file_to_app` path (`plugins/packagekit/gs-plugin-packagekit.c`) asks
PackageKit for a file *list* purely to find a `.desktop` name; it never reads a
file out of the archive. So an icon on that screen is not something the package
can supply. The AppStream metainfo in `build/` is for after the install, where it
is what makes the app a named entry with an icon rather than a bare package. Its
`<launchable>` must match the installed `.desktop` filename, which electron-builder
names after `linux.executableName`.

**A deb description is one paragraph, or it grows dots.** The control format
marks a blank line with ` .`, and nothing between the file and the screen turns
that back into a paragraph break — apt hands the description over as written,
PackageKit passes it through, GNOME Software prints it. Every break arrives as a
stray `.` on a line of its own, and a description that opens with one leads with
it. Lines wrap into a paragraph by themselves, so hand-wrapping is free; it is
only breaks that cost. The metainfo keeps its paragraphs, because the tools that
read *it* understand them.

**The metainfo is verifiable without a desktop.** Unpack the built package over
a throwaway Ubuntu and ask AppStream what it found:

```sh
docker run --rm -v "${PWD}/release:/r" ubuntu:24.04 bash -c \
  'apt-get update -qq && apt-get install -y -qq appstream &&
   dpkg-deb -x /r/Digital-DM-Screen-*-amd64.deb / &&
   appstreamcli get dev.travus.dmscreen'
```

It should print the component with `Name: Digital DM Screen` and
`Icon: digital-dm-screen` — the icon proving the `<launchable>` matched the
installed `.desktop` file, which is the join gnome-software makes too
(`gs_appstream_add_data_merge_fixup` in `lib/gs-appstream.c`, matching on
`launchable[@type='desktop-id']`). If that works and a software centre still
does not list the app, the package is not the variable: suspect a stale
`~/.cache/gnome-software/appstream/components.xmlb`, or a centre that only lists
what it can install itself.

**Check the metainfo against `ubuntu:20.04` as well, which is what this is for.**
Focal ships AppStream 0.12, and a tag introduced after it is not an error there —
it is an *info* saying `unknown-tag`, and the value is silently dropped. That is
how `<developer>`, which is 1.0 syntax, left the author name off every 20.04
machine while validating perfectly on 24.04. The file therefore carries both
spellings: 0.12 reads `<developer_name>` and ignores the other, 1.0 reads
`<developer>` and calls the other deprecated. Each version emits one info and
neither loses anything. `appstreamcli dump <id>` is what shows which tags
survived parsing — `get` prints a fixed summary and would have hidden this.

**macOS must be built on macOS.** The original cross-build experiment was
measured against electron-builder 26.15.3 in the `builder:wine` container, not
assumed:

- `--mac dmg` fails outright — `sips process failed ENOENT`, a macOS-only image
  tool. At least that one is loud.
- `--mac zip` *appears to succeed* and is the trap. The `.app` on disk is fine,
  but the zip step dereferences its symlinks: the 203 MB `Electron Framework`
  binary lands three times over — framework root, `Versions/A`, `Versions/Current`
  — giving a 351 MB archive whose framework bundle is structurally invalid.

The supported personal build therefore runs on the native arm64 `macos-15`
GitHub runner and is ad-hoc signed with
`build/entitlements.mac.adhoc.plist`. It is launch-tested as a packaged `.app`
before its DMG is uploaded. A downloaded copy still needs a one-time
`xattr -dr com.apple.quarantine` because an ad-hoc identity cannot be notarized;
managed Macs may refuse it. Do not represent this as normal public distribution.
A seamless download still requires a paid Apple Developer ID and notarization.

Keep the ad-hoc exception out of the normal `dist:mac` path. The explicit
`dist:mac:adhoc` command supplies both the identity and its relaxed library
validation entitlement; a future Developer ID build must retain hardened
runtime and use the normal identity discovery instead.

The runtime side is also platform-specific: macOS needs an application menu and
an Edit menu or `Cmd+C/V/X/A/Z` are dead in text fields. Since
`window-all-closed` is deliberately a no-op on Darwin, a prevented close during
Cmd+Q must resume `app.quit()` after confirmation; merely closing the window
strands the process windowless. Keep close-window and quit-app paths distinct.

**Search is exact-first, typo-tolerance second.** `src/renderer/src/lib/search.ts`
is the one matcher, shared by the reference lists and the module picker. The
fallback runs *only* when the exact substring pass finds nothing, so a search
that works today can never start returning extra rows — and queries under four
characters get no latitude at all, because at three almost everything is within
one edit of anything.

Two details that look like oversights and are not. The distance is measured
against the best window *inside* the name, not the whole string: `quck` has to
reach "Quickened Spell", and whole-string distance between those is enormous.
And reference lists still search **names only** — body text meant "incapacitated"
returned every condition that merely mentions it.

**The `conditions-search` smoke shot seeded a query that matched nothing** —
`saving throw`, which is in plenty of condition *bodies* and no condition *name*
— so for a long time it captured the empty state while claiming to demonstrate
that searching expands every match. If you seed a query in a shot, check the
screenshot shows results.

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
- Non-SRD content (TCE/XGE maneuvers, domains, oaths) needs a web search — and
  so does "was this reprinted anywhere", which is what decides its label.

**Source labelling convention:** `meta` always leads with the book, then any
further qualifiers, separated by ` · `, never parenthesised —
`XGE · Cleric · Forge`, `TCE · 2 sorcery points`, `DMG · Humanoids only`.
Content that ships here is SRD only, so it reads `SRD`; the rule below is for
data packs.

**Cite the book you are most likely to own, not the one an option debuted in.**
In order: the earliest **core book or core expansion** it appears in — PHB, MM,
DMG, XGE, MTF, TCE, VGM — then MPMM, then wherever it actually appeared (GoS,
SCAG, GGR, MOT, …). So Oath of Glory is `TCE`, not MOT, and the Order domain is
`TCE`, not GGR: both were reprinted into a core expansion. Oath of the Crown
stays `SCAG` because it never was.

This reverses an earlier convention that cited first appearance. The point of
the change is that a setting book you do not own is a worse pointer than an
expansion you do. Mind the casing on `GoS`.

Only PHB, DMG, XGE and TCE can ever match player options: MM, MTF, VGM and MPMM
are monster and lineage books and carry no subclasses, metamagic or manoeuvres.

## The smoke harness

`scripts/smoke.mjs` drives the built app. Each shot may:

- `layout` — seed a session from a `.dmscreen` file, or `null` for empty
- `mutate(doc)` — adjust that layout for states clicking can't reach
- `data` / `keys` — seed `datapacks.json` / `keybindings.json` in userData
- `menu` — fire a `MenuAction` before anything is clicked
- `press` — one synthetic `keydown`, e.g. `{ code: 'KeyB', ctrlKey: true }`
- `click` — newline-separated CSS selectors, clicked *and* focused in sequence
  (focus is what reveals the condition cross-reference popovers)
- `type` — `{ selector, text }`, for UI whose interesting state is a *query*
- `settle` — extra dwell before capture, for anything that changes over time
- `expect` — **required**: what the shot claims to show. A bare array is a list
  of selectors that must be present; the long form takes `found`, `missing` and
  `text`

**A shot without `expect` is a shot that cannot fail**, so the harness refuses
one — before the spawn, rather than as a mystery inside a 60-second launch. The
check runs in the renderer, is reported over stdout as `[smoke:expect]`, and the
driver decides; that is the same channel console errors already use. `found`
requires a non-zero box as well as a match, because a `display: none` element is
the same false green as photographing an absent feature. A `display: contents`
wrapper has no box either — `.bigdice-pair` is one — so assert through a child.

The capture still happens when an expectation fails. **The screenshot is the
diagnostic, not the verdict** — assertions say a thing is on screen, and nothing
more. Clipping, spacing, fonts and "does this look right" are still eyes only.

`menu` exists because a native menu is not something a CSS selector can reach,
and the About and Keyboard Shortcuts dialogs open from nowhere else — so until it
was added they had no coverage available to them at all. `press` is there for the
same reason one rung down: the half-typed state of a two-stroke sequence is
reached by a *key*, and there is no control for `click` to select.

`type` writes through the **native value setter**, not `el.value`. React keeps a
tracker on the node holding the last value it wrote; a plain assignment updates
the DOM but leaves the tracker agreeing with it, so React discards the change
event that follows as a no-op and the component never sees a thing.

**Build before you smoke, or you are photographing the last build.**
`scripts/smoke.mjs` launches `out/`, not `src/`. Run `npm run build` first;
`ci.yml` does, which is why this only bites locally. It fails silently in the
worst way — a shot whose new UI is simply absent still captures a valid-looking
screenshot and reports `ok`, exactly like the `conditions-search` empty-state
trap above. Read the image.

Picker cards carry `data-module-id`, so `.picker-card[data-module-id="timers"]`
is a stable way into any module from an empty layout. Palette rows carry
`data-action-id` for the same reason — the label is user-facing prose and the
list reorders as you type, so neither is anything to select on.

## CI

Four workflows in `.github/`. Traps found while building them, all paid for once:

**`docker compose run` needs `-T` in CI.** The `build` service sets
`stdin_open`/`tty`, so without it every invocation dies on a missing TTY.

**The hook rules in `eslint.config.mjs` are named one by one on purpose.**
`eslint-plugin-react-hooks` also ships the React Compiler rules — `refs`,
`purity`, `set-state-in-render` and ~25 more — and which preset carries them has
moved between releases. `react-hooks/refs` forbids writing a ref during render,
which is exactly what `PanelFrame` does deliberately. A preset must not be able
to switch that on during a routine upgrade.

**Prettier does not touch `*.md`.** It trims inside inline code spans, which
silently rewrote this file's own `` ` · ` `` separator convention to `` `·` `` —
in the line documenting that separator. It also restyles `*emphasis*` across the
README for nothing. The three markdown files here are hand-wrapped and fine.

**The audit report writes to a file rather than piping.** `npm audit` exits
non-zero on any finding, and in a pipe the shell reports only the last command's
status, so `npm audit --json | node scripts/audit-summary.mjs` silently swallowed
it. The summary script is a formatter; the gate is a separate
`npm audit --audit-level=critical` step. `critical` and not `high` because
nothing here has a `dependencies` block — a dev-server advisory cannot reach a
user, and a gate that cries wolf is decoration.

**`package.yml` must never become a required status check.** It is
`paths`-filtered, and a skipped check never reports, which would block every
unrelated PR permanently.

The same filter means a PR touching only `src/**` never builds installers. To
build one by hand, dispatch the workflow against the branch — `gh workflow run
package.yml --ref <branch>`, or the Run workflow button. `scripts/resolve-pr.sh`
then looks up whether that branch has an open PR, so a dispatched build still
labels its artifacts; with no PR open it returns empty and the labelling step
skips rather than guessing. Releases never reach it — they run from `release.yml`
on a tag.

**The release tag goes on after the merge**, not via `npm version`. Its own tag
points at the pre-merge commit, which a squash merge leaves off `main` — cutting
the release from something no branch contains.

**A tag-triggered run uses the workflow as it was at that tag.** So a bug in
`release.yml` cannot be fixed by pushing to `main` and re-running — the tag still
pins the broken copy. Recovering means deleting and re-cutting the tag, which the
tag ruleset blocks by design, so it needs the ruleset disabled for a moment.

**The compose services run as root, so anything they write is root-owned.** The
bind mount means `release/`, `out/` and `.cache/` come out owned by uid 0, mode
755. Reading them afterwards is fine — which is why this stayed invisible for so
long — but a later step running as the runner's own user cannot *write* into
them.

It surfaced as `actions/download-artifact` failing with "Artifact download failed
after 5 retries", which reads like a network problem and is nothing of the kind:
it was `EACCES` on a root-owned `release/`, five times, in 26 seconds. The macOS
DMG is therefore downloaded into `release-mac/`, a directory Docker never
touches. Anything else added to `release.yml` that writes into the workspace
after a compose step needs the same care.

**Nothing catches a `release.yml` bug before a release**, because it only runs on
a tag. It gets no PR coverage at all, so a change there is unverified until the
moment it matters.

**CI runners are not "the host".** The Docker rule above exists because this
machine has no Node and should keep it that way; a runner is destroyed when the
job ends. What does carry over is that anything a user *installs* comes out of
`builder:wine`, because that is the only place the Wine cross-build and the
Linux icon set are known to work. So lint and typecheck run natively in CI;
smoke and packaging do not.

## Style

Match the surrounding code. Comments explain *why*, not what — most existing
comments mark a decision or a trap, and that is the bar. British spelling in
user-facing text.

## Testing

New pure logic in `src/shared/` or `src/renderer/src/lib/` ships with unit tests
in the same PR. `npm run test` is Vitest over `src/renderer/src/lib/*.test.ts`.

Prefer moving logic *out* of components and into `lib/` so it can be unit-tested.
`menuPlacement.ts` and `palette.ts` are the pattern: a component left thin enough
to have nothing worth asserting is the goal, not a gap.

New or changed UI ships with a smoke shot, and a smoke shot must assert —
expected selectors, and text where it matters. A shot that only captures an image
proves nothing: an absent feature photographs perfectly well.

Two tiers only, unit and smoke. No component or end-to-end runner.

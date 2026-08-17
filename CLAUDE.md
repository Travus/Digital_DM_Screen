# Working on this project

Rules for an AI assistant picking this up cold. Most of these are bugs that have
already been paid for once.

**A PR that invalidates a paragraph in this file updates that paragraph.**
Documentation is not a separate task queued behind the work.

Rationale lives next to the code it governs. Where a rule here has a fuller
explanation in a comment, this file states the rule and the comment carries the
argument — so if you are about to change something, read the code's own notes
first. Humans setting up should read CONTRIBUTING.md instead of this file.

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
docker compose run --rm build npm run check     # format + lint + typecheck + test
docker compose run --rm build npm run build     # typecheck + bundle
docker compose run --rm smoke                   # headless render check
```

This is about *this machine*. CI installs Node and builds natively, one runner
per platform — see CI below.

**Verify UI changes by looking at them.** `docker compose run --rm smoke`
screenshots the built app into `release/smoke/*.png`. Read those images. This has
caught bugs typechecking could not: a panel not filling its container, a font
hijacking digits, a list that silently ignored clicks. Assertions cover what is
on screen; whether it *looks right* is still eyes only.

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
- `src/renderer/src/components/MarkupText.tsx`, `MarkupTextarea.tsx` and
  `markupKeys.ts` — the shared bold/italic surfaces behind Table and Notes.
- `src/main/imageStore.ts` — the files the Image module is allowed to display,
  and the ids the `dmscreen-image://` handler serves them under.

The layout is an n-ary tree: a `split` holds any number of children in a row or
column, with `sizes` as flex weights; a `panel` leaf points at an entry in
`doc.panels`. All tree operations are pure functions in `src/shared/layout.ts`.

## State

**Panel state is sparse.** `doc.panels[id].state` holds only what the user has
changed; module defaults are merged over it at render time. Anything reading
*another* panel's state must merge over that module's declared defaults — see
`defaultPartyFields()` and `lib/partyLink.ts`. Reading `state.fields` directly is
how the initiative/party sync silently did nothing for every party panel whose
columns had never been opened.

**`defaultState()` must be stable.** It builds the merge base, so minting fresh
ids each call instantly staleness anything that persisted one. `PanelFrame`
caches defaults per mounted module in a **ref**, not `useMemo`, which React may
discard. Module defaults use literal ids (`'tbl_complications'`, not `uid()`).

**The lock covers the names, and is enforced in the store.** `renameLayout` and
`setPanelTitle` refuse while `doc.locked`, beside the guards the tree operations
already carry — a check written into a component is one every later route in has
to remember, and there are four ways to a rename.

**A locked rename field must refuse to *open*, not just to commit.** Guarding
`setPanelTitle` alone leaves a field that focuses, accepts a new name and drops
it on blur, which reads as the app losing the edit rather than declining it —
so `setRenamingNode` refuses too. Only in the opening direction: closing has to
keep working, or locking while a field is already up strands it on screen.

## Moving panels

A panel changes places with the one beside it — dragged onto it, or swapped with an arrow chord — and is resized from the keyboard as well as from the splitter.

**A swap trades `panelId`s, never nodes.** A node id names a *place*: it is what `activeNodeId` and `maximizedNodeId` hold, what the pane's flex weight belongs to, and what React keys the subtree on. Moving the contents instead keeps a swap from re-tiling anything, so two panes of different sizes exchange modules and neither changes shape.

**The selection follows the module.** `swapWithNode` hands `activeNodeId` to the panel the module landed in, so the same key pressed twice carries one panel across the screen rather than bouncing it between one pair of panes.

**"The panel to the right" is a question about the screen, and is answered geometrically.** `panelBoxes` lays the tree out in fractions of the window and `neighbourPanels` takes the nearest box across the edge that also overlaps on the other axis. Walking up the tree answers a different question: in `column[row[a, b], row[c, d]]` the nearest ancestor running downwards is the outer column, whose next child is the whole second row — and choosing between *its* panels is the geometry again. Ties go to the largest shared edge, then to the topmost or leftmost, so a panel facing a stack always picks the same member of it.

**Rearranging is refused while a panel is fullscreen**, in the store and not only in the catalogue. One pane fills the window, so a swap and a resize alike land entirely off screen and the only sign either happened is the layout going unsaved. A drag cannot reach a second panel there either, so this is the keyboard agreeing with the mouse.

**The keyboard resize has no pixels, so its floor is a share.** The splitter stops at 90 px; `resizePanelShare` stops at a twentieth of the split it sits in. The boundary it moves is the innermost one on that axis — the handle the DM would have grabbed — and the one *before* the panel when the panel is last, or "wider" would mean "wider, unless you are on the right". It returns the same root when nothing moved and the store compares identity before mutating, so a key held at the limit does not go on dirtying the layout and restarting the autosave.

**A panel drag is an HTML5 drag with a MIME type of its own.** Pointer events are already spoken for inside the modules — panning an image, drawing a block selection across table cells — so a gesture that crosses into one of those has to be a different kind of event rather than the same kind arbitrated by hand. `application/x-dmscreen-panel` is what tells a panel drop from a file drop, and `dataTransfer.types` is the only thing readable during `dragover`, which is what lets the highlight and the drop ask one question. Nothing goes on `text/plain`: a textarea would insert it.

**The header is the grip, and stops being one while its rename field is open.** A draggable ancestor takes the pointer that would have selected text in the input. Locked, it stops being one too — the same rule the splitter grips follow.

**The ⋯ panel menu carries the four swaps, and Flip and Even Out came off it to make room.** That menu hangs off the panel a DM is looking at, so it is worth spending on what gets reached for mid-session. Both of the commands it lost keep their rows on the native Panel menu and in the palette, which is also where the four resize commands stay — the divider is already right there to drag.

## Rendering

**Never put an emoji font in the body font stack.** Noto Color Emoji also covers
digits and the space character, so it hijacks ordinary text. Emoji fonts are
scoped to `.emoji`, `.panel-icon` and `.picker-icon` only. Putting them after the
generic fallback is not enough; it must be scoped.

**A panel clips anything laid out inside it.** `.panel` is `overflow: hidden`, so
an absolutely positioned popover is cut off at the panel edge. Anything
overhanging a panel is `position: fixed` and placed from JS — `placeMenu()` for
the panel menu, `ConditionPopover` inline for cross-reference cards. That works
only because no ancestor of a panel sets `transform`, `filter` or `contain`, any
of which would become the containing block and reinstate the clipping.

Escaping the clip means nothing keeps a popover inside the *window* either, so
placement flips and clamps for itself. A smoke shot only proves this if the panel
is too small to hold the popover.

**Anything overlaying a panel has to leave the DOM, not just fade.** The
fullscreen hint is parked over the bottom of the panel it belongs to — the dice
history is under it — so it fades and then unmounts. Fading alone is half a fix:
an element at `opacity: 0` still takes every click aimed at what is behind it.
The timers in `App.tsx` and the transition in `styles.css` are two halves of one
duration and have to agree.

## Rich text

Bold and italic in Table cells and Notes. `lib/markup.ts` is the one parser and
`lib/grid.ts` the one clipboard format; both are pure and unit-tested.

**Markdown markers are the stored form, never HTML.** A cell holds `**bold**`.
That keeps a `.dmscreen` readable, lets a cell survive being copied into any
other program as text, and is what lets the Notes editor stay a real `<textarea>`
— native undo, spellcheck, IME and caret all come free, and none of them survives
a contentEditable rewrite.

**Markers are matched as runs, not characters.** One star is italic, two bold,
three both, and a run closes only on a run of its own width. Scanning character
by character, a single `*` closes against the first half of a `**` and
`***both***` orphans its third star. An unpaired run stays literal, so `2 * 3` is
arithmetic.

**`parseMarkup` returns spans covering every character**, each flagged as marker
or content, because the surfaces need different halves at different times.

**Markers are shown only while the field they are in has focus.** That is one
rule, and both modules follow it. The constraint that forces markers to stay —
the mirror lying under a live caret, where anything that stops occupying width
slides the rest of the line out from under it — binds exactly while there is a
caret aimed at a character, and not otherwise. Unfocused, the markers go and the
text reads as finished. A table cell reaches this with CSS (`:focus +
.cell-render`), Notes with a `focused` state, because a mirror's *content*
changes rather than its visibility.

**The Notes editor is a mirror, and its metrics are load-bearing.** A styled
`<div>` sits under a textarea whose own text is transparent. Every property
deciding where a glyph lands has to match: font, size, line height, padding,
border width, letter spacing, tab size, wrapping. Both halves take the caller's
class (`.notes-area`) so those are declared once, and `styles.css` adds only the
differences. The mirror has no scrollbar; it is dragged along by hand.

**Those overrides are scoped under `.markup-editor` on purpose.** The caller's
class is a plain one too, so a bare `.markup-input` ties with `.notes-area` on
specificity and loses to whichever `styles.css` declares later — which is exactly
how the textarea kept opaque text and hid the mirror entirely. Do not flatten
those selectors.

Only cells that actually carry a marker get the overlay — `hasMarkup` is a hint,
and a false positive costs a no-op layer.

**Row shading and the selection tint are different CSS properties on purpose.**
Shading sets `background-color`; the block-selection tint is a flat
`background-image` gradient layered over it. They composed as one property
before, and the shading rule both outranked the selection rule on specificity and
reset its image via the `background` shorthand — so every shaded row swallowed
the highlight and looked unselected. Keep them on separate properties rather than
racing their selectors.

**Tab and Enter move between cells, and both grow the table.** Enter steps down a
column, Tab across a row and on to the next; running off the bottom appends a row
rather than doing nothing, because the last cell is where a table is always being
extended from. The row's remove button is `tabIndex={-1}` — it sits between the
last cell of one row and the first of the next in DOM order, so leaving it in the
ring would put it in the middle of every row transition. Shift+arrows extend a
block, which is what keeps copying a column reachable without a mouse.

**The cell to focus goes through a ref, not a direct call.** Both keys may land
on a row that does not exist yet, and the input cannot be focused until the
render that creates it. The layout effect leaves the request standing when the
cell is not there — adding a row and moving the selection are two updates, and
nothing guarantees they land in one render, so clearing it on the first would
drop the focus on the floor.

**Selection is restored by hand after a toggle.** `toggleMark` inserts characters
before the caret, so React re-rendering with the new value would leave the
selection wherever the old offsets land — usually the end. `useMarkupKeys` parks
the new range in a ref and applies it in a layout effect, the first moment the
DOM holds the text those offsets are measured against.

**Clipboard blocks are TSV**, because that is what a spreadsheet reads and
writes. Pasting grows the table rather than clipping: the shape of a copied block
is what the DM meant, and dropping the overhang loses data with nothing on screen
to say so. A cell can never hold a newline, so `parseGrid` folds one carried in by
a quoted field into a space rather than letting one row silently become two.

## Images

The Image module shows one file per panel — a map, a handout, a portrait.

**The layout stores a path, never the bytes.** Base64 in panel state would ride
the session autosave, which serialises the *whole* document 700 ms after any
change and pretty-prints it, so a 3 MB map would be re-encoded and rewritten on
every keystroke in an unrelated Notes panel. The cost of a path is that it does
not travel, which the panel says out loud rather than showing a broken image —
the same bargain `DataPackRef` already makes.

**The renderer never reads a file; main serves one.** `img-src` does not list
`file:`, and the page origin differs between dev and a packaged build, so `'self'`
covers nothing. Main registers `dmscreen-image://` and streams the bytes back.
The scheme name and the URL shape live in `shared/types.ts` — one place, for the
reason accelerators have one.

**`registerSchemesAsPrivileged` runs before `app.whenReady()`**, as a bare
statement at module scope. Chromium reads that registry once during startup, and
a scheme registered after it is still handled but is no longer *secure* — the
page then refuses the image as insecure content, with nothing in the handler to
show for it.

**The handler serves a registered id and nothing else.** `imageStore.ts` is the
guest list, and `registerImage` refuses anything that is not an image by
extension. Panel state is hand-editable JSON that can name any file on the disk,
so without the list any string reaching an `<img src>` would name a readable one
— which is the file access `sandbox: true` exists to withhold. The
`Content-Type` is set from the extension rather than passed through, because a
`file:` fetch guesses and a guess of `text/plain` is a blank panel.

**A file that is there and will not decode is its own state.** `exists` is a
path check and cannot see a truncated download or a `.png` that is something
else. `onError` catches those, and the panel says "could not be read" rather
than "go and find it", which would be the wrong instruction.

**Gesture state is committed when the gesture settles, not while it runs.**
Every write to panel state goes through the store's `mutate`, which marks the
layout unsaved and restarts the autosave debounce — at pointer rate that is the
whole document rewritten several times a second for a drag that has not finished.
The live view is mirrored in component state and lands in the panel 250 ms after
the last event, and on unmount, so a panel closed mid-drag keeps its frame.

**Scale 1 means "fits the panel", not "actual pixels".** The image is drawn with
`object-fit: contain` and then transformed, so every stored zoom is relative to
that box. Resizing the panel therefore does not change what the DM is looking at,
and pan limits fall out of it: a contained image has nowhere to go, so a drag at
scale 1 does nothing without a rule saying so. `lib/imageView.ts` is the whole of
that arithmetic and is unit-tested.

**Wheel zoom is on the element's own listener.** React registers its root wheel
listener as passive, so `preventDefault` on a synthetic wheel event does nothing
and the panel would zoom and scroll at once.

**Dropping a file on the window used to throw the app away.** Chromium's default
is to navigate to the dropped file, which discards a layout that was never saved.
`will-navigate` is refused in `createWindow`; the module's own drop handler is
the half that catches the drops meant for it. A dropped file's path comes from
`webUtils.getPathForFile` — Electron 32 removed `File.path`.

## Keybindings

`src/shared/actions.ts` is the catalogue: one entry per command with its default
accelerator, and **the only place a binding is written**. `src/main/menu.ts`
reads accelerators from it, and so does the renderer for every caption. Any
second copy becomes a caption that lies.

**Overrides are sparse, and `??` is the wrong merge.** `keybindings.json` holds
only what the user changed, but `null` there means *deliberately unbound*, which
is not the same as absent. `resolveKeymap` tests presence with `hasOwnProperty`.

**A bad accelerator costs you the whole menu.** `Menu.buildFromTemplate` throws on
a malformed string, and the menu is the only route to the shortcuts editor that
would undo it. `sanitiseKeymap` is therefore total — it collects warnings and
drops bad entries rather than raising. `menu.ts` re-checks before building.

**Record from `event.code`, not `event.key`.** With Shift held, `key` reports the
*shifted* character, so `CmdOrCtrl+Shift+\` would record as `CmdOrCtrl+Shift+|`
and never match. `code` also keeps a chord put on a non-US layout.

**The macOS Edit roles are load-bearing.** `Cmd+C/V/X/A/Z` work in text fields
only because the OS routes them through the menu; shadowing one kills copy and
paste app-wide. Reserved in all three spellings of the primary modifier.

**Electron's other roles hold keys too, and the keymap cannot see them.**
`reload` is `CmdOrCtrl+R`, `minimize` is `CmdOrCtrl+M`, and the zoom, devtools
and fullscreen roles hold theirs; none is a catalogue action, so `findConflict`
passes a binding the role then eats. They give the stroke up instead — the same
bargain `rendererSingles` already makes one rung up. A role **cannot** be told to
drop its accelerator, so `shellItem` in `menuTemplate.ts` turns it into a plain
row calling `shellActions`, and `menu.ts` performs what the role would have.
`ROLE_ACCELERATORS` is copied from Electron's `menu-item-roles.ts`; compare
through `formatAccelerator`, because a role writes `Alt+Command+I` where a
recording writes `CmdOrCtrl+Alt+I`. Both strokes of a sequence count, since a
role fires with a prefix pending.

**Nothing changes for a keymap that wants none of those keys**, which is nearly
every keymap — the rows stay roles. On macOS, freeing `Cmd+M` means writing out
`role: 'windowMenu'`, which costs the OS's own window handling, so that one is
expanded only when the stroke is actually claimed.

**Escape belongs to the renderer.** A menu accelerator for Escape swallows the key
app-wide, including inside text fields. It is handled by a `keydown` listener in
`App.tsx` — a five-rung chain (cancel a pending chord, close the palette, the
shortcuts dialog, the about dialog, leave fullscreen), only the last of which is
a catalogue action. Do not move it onto the keymap: "dismiss whatever is topmost"
is contextual and a keymap entry cannot express it.

**Only *bare* Escape is reserved**, and both `App.tsx` listeners share one
`isBareEscape` test to stay agreed on that — the dismiss chain ignores a modified
Escape, and the chord dispatcher stops skipping it. Guard only one of them and
`CmdOrCtrl+K CmdOrCtrl+Escape` validates, shows in the editor, and never fires.

**`Ctrl+B` and `Ctrl+I` are text editing, and the menu must not take them.** The
Table and Notes modules read them as bold and italic, and a menu accelerator
beats the renderer — so binding either to a command makes that formatting
unreachable in every text field, not merely inconvenient. This is why
`data:importPack` moved off `CmdOrCtrl+I`. Neither stroke is *reserved*: the tmux
preset uses `Ctrl+B` as its chord leader, and a keymap the user picked
deliberately is allowed to spend it.

**`Ctrl+X` is reserved on macOS too**, where Cut is `Cmd+X` and it would in fact
be free. Deliberately blunt: freeing it only on Darwin makes one
`keybindings.json` behave differently per platform.

**Alt is the arrow modifier, because the other two are text editing.** Ctrl+arrow moves by word and Shift+arrow extends a selection, on every platform, and a menu accelerator beats the renderer — so either would take that out of the Notes editor and every table cell rather than merely inconveniencing it, the way `CmdOrCtrl+I` would have taken italic. The four swaps are `CmdOrCtrl+Alt+arrow`; the four resizes add Shift, which reads as the finer version of the same gesture. Neither family is *reserved*: a keymap the user picked is allowed to spend them.

### Two-stroke sequences

A binding is one stroke or two, space-separated: `"CmdOrCtrl+K CmdOrCtrl+S"`.

**Dispatch is split, and the split is forced.** An Electron accelerator is
single-stroke only. Single-stroke bindings stay menu accelerators; sequences run
through `advanceChord` in `lib/chords.ts`. Do not move everything to the renderer
to "simplify" it — the menu would then show no accelerators at all, and
`registerAccelerator: false` is **macOS-only**, so there is no way back.

**A menu accelerator beats the renderer, so the menu gives the stroke up.**
`rendererSingles`: any single-stroke binding whose stroke is also used by a
sequence loses its accelerator permanently and is dispatched by `advanceChord`.
Both sides compute that set from the same keymap, so they cannot disagree.

**The native accelerator column shows what the menu will fire, and nothing else**
— so a sequence, and a stroke handed to the renderer, leave it blank. Writing
them into the label was tried and reverted: two treatments in one menu reads as a
bug. The ⋯ panel menu and the shortcuts editor render sequences properly.

**Only the opening stroke is contested.** A second stroke may reuse a stroke bound
on its own, because a pending prefix says which was meant. A *first* stroke cannot
— pressing it would have to mean both "run that" and "wait, a sequence is
starting". `findConflict` returns `prefix-taken`/`prefix-blocks` for that and
nothing else. This is what makes the VS Code, Zed and Sublime keymaps expressible.

**Only the first stroke needs a modifier; the second may be bare.** That is the
feature — `C-w v` finishes on a plain key. It stays safe because a sequence can
only *begin* on a stroke typing cannot produce: a modified stroke, or one of the
`safeWithoutModifier` keys — F-keys and Escape — that type no character. The
Escape half is what lets Zed's `Shift+Escape` zoom bind; only *bare* Escape is
reserved.

**Emacs cannot have its own prefix.** `C-x` is Cut, handled by Chromium in any
editable field on Windows and Linux whatever the menu does.

### Presets

`src/shared/presets.ts` holds the borrowed keymaps. Each is a **sparse** override
map applied wholesale — replacing every override, never merging. Merging is how
you get a prefix that still fires something on its own, which nothing can resolve.

**Every binding is sourced from the tool, not remembered.** A preset wearing a
tool's name and guessing at its bindings is worse than not shipping it.

**A preset must not contradict itself.** Vim's window commands sit behind
`Ctrl+W`, which ships bound to Close Panel, so the preset must claim that too or
the menu owns the prefix and no sequence starts. A test resolves each preset and
runs every binding through `findConflict`.

**A preset whose tool moves a key per platform carries a `darwin` arm.** Cursor
is why: its chord leader left `Ctrl+K` for `Ctrl+M` on Windows and Linux and
`Cmd+R` on macOS, and one chord string cannot say that — `CmdOrCtrl` swaps the
modifier, never the key. The arm is a **complete replacement** applied instead of
`bindings`, never merged over them: a delta arm would leave the other platform's
leader live beside its own. `presetBindings` is the only reader, so every surface
agrees on which arm a platform gets. What lands in the keymap is still ordinary
chords — a `keybindings.json` copied across platforms keeps working, it just
keeps the leader of the machine that wrote it.

**Two presets must differ from each other, not just from the defaults.** The test
that claimed this only ever compared each preset against the shipped keymap,
which a duplicate passes. An editor forked from one already listed inherits every
binding it does not deliberately move, so that is the pair the gap was hiding.

### The action palette

`Cmd/Ctrl+Shift+P`. `lib/palette.ts` decides what it shows;
`components/ActionPalette.tsx` is the window around that.

**It is the catalogue, rendered.** Rows are `ACTIONS` with the live binding beside
each, so a command added to `actions.ts` appears with no further wiring and its
key cannot become a caption that lies.

**`ActionDef.unavailable` returns the reason, not a boolean.** A menu can carry a
row that quietly does nothing; the palette is the discovery surface, so "Close
panel" on a locked layout has to say it is off *and why*. `!locked && hasPanel`
cannot say which half failed, so the predicate returns the text — a lowercase
fragment, because every consumer prefixes it. **Do not add a `disabledReason`
beside it**: two things that must agree, with nothing enforcing it, is how the
accelerators came to lie before they collapsed into one catalogue.

**Unavailable rows grey and sink; they are never dropped.** A row that disappears
takes its own explanation with it, and half a list reads as a broken palette. They
sort to the bottom so the cursor's first Enter lands on something that runs, they
are landed on rather than skipped by the arrows, and activating one shows the
reason instead of firing. `sink()` in `palette.ts` leaves the top half alone, so
catalogue order — and the fuzzy pass's ranking — survives there, and **sorts the
tail by name**: that half is not scanned in order, it is looked one row up in.

**The ⋯ panel menu greys the same rows**, from the same predicates via
`actionUnavailable`, with the reason as a `title` tooltip: a menu row has nowhere
to put a message. Its rows keep their positions rather than sinking — a menu whose
length changes with the state is one you have to read every time — and a greyed
row does not close the menu, which would take the tooltip with it. `aria-disabled`
rather than `disabled`, because Chromium suppresses the tooltip on a disabled
control.

**Quit is in the catalogue, `fixed`.** `fixed` means "a key some other layer owns
app-wide" and carries the reason as its value. Quit's item is built from the
keymap like every other, so that the palette, the editor and the menu cannot
disagree about its key.

**Quit is also the one place that rule does not hold, and the tests say so.**
`CmdOrCtrl+Q` is on the reserved list, so `isValidBinding` rejects it and the
menu item ends up bare — `role: 'quit'` then supplies the same key unprompted, so
the three surfaces agree by coincidence. Nothing is broken and nothing to fix
blind: `menuTemplate.test.ts` pins it, and undoing it means teaching the
accelerator column that an action's *own* reserved chord is not a reason to drop
it.

## Search

`lib/search.ts` is the one matcher, shared by the reference lists and the module
picker. Exact-first: the typo-tolerant pass runs *only* when the exact substring
pass finds nothing, so a search that works today can never start returning extra
rows.

**Reference lists search names only.** Body text meant "incapacitated" returned
every condition that merely mentions it.

## Data packs

Shipped reference data is **SRD only** — that is what makes the repo licensable
(MIT for code, CC BY 4.0 for the text). Everything else loads at runtime from a
`.dmpack.json` living outside this repo.

- **`resolve()` in `data/resolve.ts` is the whole merge, and is total**: it
  collects problems into `warnings` and never throws. The only UI for removing a
  bad pack is the native menu, so a renderer that died on load would leave no way
  out.
- **Containers extend, entries don't.** An `AbilityGroup` or `RuleSection` whose
  id matches one already loaded merges its contents in — that is how a pack adds
  one manoeuvre without restating twenty-two. So **container ids are never
  namespaced**, and `defaultState()` names them by literal.
- **Entry ids are namespaced `source:id`.** Two sources defining `mm-careful`
  would otherwise share a favourites key and a React key. `migrateIds()` reads
  pre-namespace state as `bundled:`.
- **Conditions collide on *name*, not id.** The name is what the cross-reference
  popover scans prose for and what the initiative tracker persists.
- **The snapshot crosses to the renderer synchronously**, via the one `sendSync`
  channel in an otherwise all-`handle` bridge.
- **Data lives in `dataStore`, not `useAppStore`** — everything in the latter
  funnels through `mutate()`, which sets `dirty`. Loading a pack must not mark a
  layout unsaved.

**An empty condition list used to hang the renderer.** The cross-reference scanner
built `/\b(a|b|c)\b/gi` from condition names; with none that becomes `/\b()\b/gi`,
which matches the empty string without advancing `lastIndex`. `buildPattern()`
returns null for an empty list, and the loop nudges `lastIndex` past any
zero-length match. The `conditions-empty` smoke shot guards it — it would time out
at 60 s, not fail quietly.

**Distinguish "hidden" from "not loaded".** Both leave a reference module empty,
but "re-enable it in this panel's settings" is wrong when the cause is a switch in
the Data menu. Every reference module checks the unfiltered set first.

## Rules data

Everything under `src/renderer/src/data/` is game reference text, **2014-edition**
D&D. Verify against a source rather than writing from memory — several errors were
found that way (Mithral/Adamantine object AC, fragile vs resilient object HP, a
fabricated improvised-damage example, a missing clause in Dodge).

- `https://www.dnd5eapi.co/api/2014/...` is the easiest check — `conditions`,
  `rule-sections`, `spells`. SRD only.
- `2014.5e.tools` returns 403 to direct fetches.
- Non-SRD content needs a web search, as does "was this reprinted anywhere".

`meta` leads with the book, then qualifiers, separated by ` · `, never
parenthesised — see the header comment in `data/abilities.ts`.

## Packaging and distribution

**The portable exe locks itself while running.** If `release/…-portable.exe` is
open, `dist:win` fails with a bare "Error - aborting creation process" from NSIS.
Worse, the Linux targets and the NSIS installer may build fine first, leaving a
half-fresh `release/` where the portable silently stays at its old build under an
unchanged filename. Gate the build on the check rather than printing it:

```powershell
if (Get-Process 'Digital DM Screen*' -EA SilentlyContinue) { "close the app first" }
else { docker compose run --rm build npm run dist:all }
```

**Closing it is pre-authorised** — Travus asked for it to be force-closed rather
than prompted every time.

**Don't key build-completion checks on a filename existing.** A stale artifact
looks identical to a fresh one. Key on the process exiting, or compare timestamps.

**The Linux icon must be a set, not one png.** electron-builder does not resize a
lone png — it installs that file into `hicolor/<its own size>/apps/`, and hicolor
defines no `1024x1024` directory, so the lookup finds nothing. `linux.icon` points
at `build/icons/`; `scripts/gen-icons.sh` renders it from `icon.svg`.
`build/icon.png` stays 1024 because Windows converts it to `.ico`.

**Don't set `Categories` or `Comment` under `linux.desktop.entry`.** The entry is
merged first, then both are overwritten unconditionally — `Categories` from
`linux.category`, `Comment` from `description`. The deb's own description goes to
fpm directly as a second `--description` in `deb.fpm`; fpm keeps the last. That
override is positional, so if electron-builder ever stops pushing `options.fpm`
last, the description silently reverts. `dpkg-deb -I` says which one won.

**A deb description is one paragraph, or it grows dots.** The control format marks
a blank line with ` .`, and nothing turns that back into a paragraph break — every
break arrives as a stray `.` on its own line. Hand-wrapping is free; breaks cost.
The metainfo keeps its paragraphs, because the tools that read it understand them.

**The Linux install screen reads the control file and nothing else.** Opening a
`.deb` in GNOME Software shows the package name, the control Description and
`Homepage`, and no icon, because nothing is unpacked yet. An icon there is not
something the package can supply. The AppStream metainfo in `build/` is for after
the install; its `<launchable>` must match the installed `.desktop` filename,
which electron-builder names after `linux.executableName`.

**The metainfo must parse on an old AppStream as well as a new one.** A tag newer
than the parser is not an error — it is an *info* saying `unknown-tag`, and the
value is silently dropped. That is how `<developer>` (1.0 syntax) left the author
name off older machines while validating perfectly on 24.04, so the file carries
both spellings. The Linux build job asserts the name survives on `ubuntu:24.04`
and `ubuntu:22.04`; presence in the deb is not the failure mode. Use `appstreamcli
dump <id>`, not `get`, which prints a fixed summary and would hide this.

**macOS must be built on macOS.** Measured against electron-builder 26.15.3 in the
Wine container: `--mac dmg` fails on `sips process failed ENOENT`, and `--mac zip`
*appears to succeed* while dereferencing the framework's symlinks, giving a
structurally invalid bundle. `dist:mac:host` guards both.

The supported build runs on the native arm64 `macos-15` runner, ad-hoc signed with
`build/entitlements.mac.adhoc.plist`, and is launch-tested as a packaged `.app`
before its DMG is uploaded. A downloaded copy needs a one-time `xattr -dr
com.apple.quarantine`; managed Macs may refuse it. **Do not represent this as
normal public distribution** — that needs a paid Developer ID and notarization.
Keep the ad-hoc exception out of the normal `dist:mac` path.

macOS also needs an application menu and an Edit menu at runtime or `Cmd+C/V/X/A/Z`
are dead in text fields. Since `window-all-closed` is a no-op on Darwin, a
prevented close during Cmd+Q must resume `app.quit()` after confirmation; merely
closing the window strands the process windowless. Keep close-window and quit-app
paths distinct.

## The smoke harness

`scripts/smoke.mjs` drives the built app. Each shot may:

- `layout` — seed a session from a `.dmscreen` file, or `null` for empty
- `mutate(doc)` — adjust that layout for states clicking can't reach
- `data` / `keys` — seed `datapacks.json` / `keybindings.json` in userData
- `menu` — fire a `MenuAction` before anything is clicked
- `press` — one synthetic `keydown`, e.g. `{ code: 'KeyB', ctrlKey: true }`
- `click` — newline-separated CSS selectors, clicked *and* focused in sequence
- `type` — `{ selector, text }`, for UI whose interesting state is a *query*
- `select` — `{ selector, start, end }`, for behaviour that acts on selected text
- `wheel` — `{ selector, deltaY, offsetX, offsetY }`, one notch over an element
- `drag` — `{ from, to, hold }`, one element dropped onto another
- `steps` — those six as an ordered list, for a shot that needs two of a kind
- `settle` — extra dwell before capture
- `expect` — **required**: a bare array of selectors that must be present, or the
  long form taking `found`, `missing` and `text`

**The shorthand fields are sugar for `steps`, desugared in the driver.** There is
one executor in `src/main/index.ts` and one list for it to read, so the two
spellings cannot come to mean different things — `menu`, `click`, `press`, `type`,
`select`, `wheel`, `hover` are one step each in that fixed order, which is what
most shots want.
Declaring both is refused rather than merged: a shot writing `steps` has an order
in mind, and prepending a shorthand field to it would put a click somewhere
nobody wrote. Steps also take `wait` for a mid-sequence dwell.

**The fixed order is why `steps` exists.** `type` always ran after `press`, so
"narrow a list, then walk it" could not be written, and neither could any state
two inputs deep — the palette showing a greyed row's reason and then a fresh
query typed over it. Reach for `steps` when the behaviour *is* the transition.

**A `drag` carries one `DataTransfer` through the whole sequence**, so the
handlers do the work rather than being mimed: the source's `dragstart` writes the
panel id into it and the target's `drop` reads it back. A constructed
`DataTransfer` stays readable, unlike the protected one a live drag hands to
`dragover`. `hold` stops after the dragover, because the drop indicator exists
only between those two events — run the drop and there is nothing left to
photograph.

**`wheel` is off-centre on purpose.** A zoom aimed at the pointer and one taken
from the middle draw the same picture when the pointer *is* the middle, so a shot
that does not pass an offset proves only that the number changed. It also reaches
what a button cannot: the element's own non-passive listener, which is the half
that stops the panel scrolling while it zooms.

**Some UI needs a file on disk, and those fixtures live in `examples/`.**
`smoke-map.png` is the Image module's map. `smoke-broken.png` is named like an
image and is not one, which is the only way to reach the decode failure —
`exists` is a path check and passes it happily.

**A shot without `expect` is a shot that cannot fail**, so the harness refuses one
before the spawn. The check runs in the renderer and is reported over stdout as
`[smoke:expect]`; the driver decides. `found` requires a non-zero box, because a
`display: none` match is the same false green as photographing an absent feature —
and a `display: contents` wrapper has no box either (`.bigdice-pair`), so assert
through a child.

The capture still happens when an expectation fails. **The screenshot is the
diagnostic, not the verdict.**

**An expectation is retried for three seconds before it counts as failed.** Each
step dwells a fixed 400–500 ms, which is generous for a React state update and
stops being generous when four shots share four cores. A UI that is merely late
arrives on a later poll; one that is actually broken still fails, having cost the
run three seconds it only ever spends on red. The whole spec must pass in *one*
evaluation — accumulating passes across polls would let `found` and `missing` hold
at different instants, which is a state the app may never have been in.

`menu` exists because a native menu is not reachable by CSS selector, and the
About and Keyboard Shortcuts dialogs open from nowhere else. `press` is there for
the same reason one rung down: the half-typed state of a sequence is reached by a
key, and there is no control to select.

**`press` dispatches at `document.activeElement`, not at `window`.** A real
keydown starts at the focused element and bubbles, so an app-wide `window`
listener — the chord dispatcher, the Escape chain — hears it either way, while a
React `onKeyDown` on the focused control only hears it this way: React listens at
the root, which is *below* `window` and never on the path of an event whose target
is `window`. Dispatching at `window` reached the app-wide listeners and nothing
else, which put the action palette's own arrow keys beyond the harness entirely.

`type` writes through the **native value setter**, not `el.value`. React keeps a
tracker on the node holding the last value it wrote; a plain assignment leaves the
tracker agreeing with the DOM, so React discards the change event as a no-op. The
prototype that setter comes off is **read from the element**: calling an input's
setter on a textarea throws `Illegal invocation`, which put every textarea out of
the harness's reach.

**`select` exists because a synthetic `Ctrl+A` selects nothing.** A dispatched
KeyboardEvent performs no default action, and `type` leaves the caret at the end,
so nothing acting on a selection — Ctrl+B and Ctrl+I over a word — could be
driven at all. It sets the range directly.

**Build before you smoke, or you are photographing the last build.** It launches
`out/`, not `src/`.

**The capture is retried, and an empty image is a failure.** `capturePage()`
rejects with `UnknownVizError` when Chromium's compositor has no frame sink ready
— a cold-start problem that has killed the *first* shot of a CI run while the
other 45 passed. Asking again beats lengthening a wait every shot pays. The empty
check is there because nothing downstream would catch a blank PNG: expectations
run in the renderer and pass whatever the capture returned.

### Shots run in parallel

Four at a time by default — `min(4, cpus)`, sized for the CI runner. The suite is
nearly all dwell rather than work, so this is the difference between ~115 s and
~45 s. `SMOKE_CONCURRENCY=1` is the old sequential behaviour exactly, and is the
first thing to reach for against a failure you suspect is load rather than code.

**A fixed dwell is what breaks under parallelism, so there is no longer one.** The
harness used to wait a flat 1800 ms for the session restore. A constant cannot be
right on two machines, and it fails in the worst shape available: an expired dwell
does not time out, it drives an app still showing its pre-restore state and fails
an expectation, which reads as a broken feature rather than a slow one.
`waitForReady` polls for `data-ready` — set by an effect in `App.tsx` once the
restore has committed, so it cannot appear before the render it stands for — then
awaits `document.fonts.ready` and two frames, because the DOM being right is not
yet the window being painted. **Do not reintroduce a constant here.** Adding one
to "give it a moment" is how this becomes flaky again.

**Each shot gets its own userData directory.** Every shot seeds `session.json`,
`datapacks.json` and `keybindings.json` before it starts, so on a shared directory
they would seed over each other and photograph a neighbour's layout.
`XDG_CONFIG_HOME` is set in each child's spawn env rather than inherited, which is
the whole of the isolation.

**Each worker slot gets its own X display range.** `xvfb-run -a` finds a free
display by scanning for `/tmp/.X<n>-lock` and then claiming it, with no lock
between the two, so two shots starting together choose the same number and one of
their servers dies. Passing `-a -n <base>` per slot makes the scans disjoint —
which removes the race rather than narrowing it — while keeping `-a` so a slot can
still step over a display some earlier crash left locked.

**Electron runs with `--disable-dev-shm-usage`.** Docker gives a container 64 MB of
`/dev/shm`. One Chromium fits; four do not, and the one that finds it full dies as
`render process gone: crashed`, naming neither shared memory nor the neighbour
that took it. Moving that allocation to `/tmp` costs nothing measurable and means
the suite does not depend on how its container was started.

**A timed-out shot is killed as a process group.** Killing `xvfb-run` on its own
orphans the Xvfb and the Electron beneath it, and a hung shot's leftovers would go
on competing for the cores every later shot needs — one timeout would then read as
a suite-wide collapse.

**A single-stroke accelerator cannot be smoke-tested by `press`.** Electron fires
it before the page sees the key, so a synthetic `keydown` is correctly ignored by
`advanceChord`. Use `menu:`. To check an accelerator really registers, build the
template and read `Menu.buildFromTemplate([...]).items[0].accelerator` back.

Picker cards carry `data-module-id` and palette rows `data-action-id`, because
labels are user-facing prose and the palette reorders as you type.

## Testing

New pure logic ships with unit tests in the same PR. `npm run test` is Vitest over
every `*.test.ts` in `src/`, beside the file it covers — `src/shared/`,
`src/renderer/src/lib/`, `src/renderer/src/data/` and `src/main/` all carry some.
There is no vitest config; the default glob is what finds them.

Prefer moving logic *out* of components — and out of anything holding an Electron
handle — so it can be unit-tested. `menuPlacement.ts`, `palette.ts` and
`menuTemplate.ts` are the pattern: the last builds the whole application menu as
data, taking `platform` and `appName` as arguments, so `menu.ts` is left with the
two lines that hand it to Electron and every macOS branch is checkable off a Mac.
A file left thin enough to have nothing worth asserting is the goal, not a gap.

New or changed UI ships with a smoke shot, and a smoke shot must assert.

Two tiers only, unit and smoke. No component or end-to-end runner.

## CI

Five workflows, and **CI runs natively — no Docker at all**. `ci.yml` (check, then
render, then installers), `release.yml`, `audit.yml`, and two called by the
others: `render-check.yml` and `build-installers.yml`.

**Each installer is built on the system it targets** — Windows on
`windows-latest`, Linux on `ubuntu-latest`, macOS on `macos-15`.

**Packaging lives in `ci.yml` rather than its own workflow**, because a render
check can only gate it from inside the same run. It has no `paths` filter, which
is what makes it requirable: a skipped check never reports, so a filtered workflow
can never be a required status check.

**It has no base-branch filter either, and that is the same rule.** `branches:`
under `pull_request` matches the *base*, so `[main]` silently excludes every
stacked PR — nothing runs, the required checks never report, and the only way to
land it is to bypass the ruleset. `audit.yml` keeps its filters on purpose: it is
advisory and gates nothing.

**A `workflow_call` renames the check to `<caller job> / <called job>`**, and the
two-part name cannot be flattened. Moving a job into a reusable workflow means
updating the ruleset in the same breath, or every PR blocks on a check that will
never report. The required set is `check`, `smoke / smoke`, `build / linux`,
`build / windows`, `build / macos-arm64`.

Rulesets are read with GET and written with **PUT** — a PATCH returns 404, which
reads like a permissions problem and is not one.

**The hook rules in `eslint.config.mjs` are named one by one on purpose.**
`eslint-plugin-react-hooks` also ships the React Compiler rules, and which preset
carries them has moved between releases. `react-hooks/refs` forbids writing a ref
during render, which is exactly what `PanelFrame` does deliberately.

**Prettier does not touch `*.md`.** It trims inside inline code spans, which
rewrote this file's own `` ` · ` `` separator convention to `` `·` `` — in the
line documenting that separator.

**The audit report writes to a file rather than piping.** `npm audit` exits
non-zero on any finding, and a pipe reports only the last command's status. The
summary script is a formatter; the gate is a separate `--audit-level=high` step.

**Never pipe a long output into `grep -q`.** An Actions step runs under
`pipefail`, and `grep -q` exits on its first match — the writer upstream then
dies on a write error and *that* becomes the pipeline's status. A match early in
a long stream therefore fails the step, and the `||` branch reports the thing as
missing. `dpkg-deb -c | grep -q` said the hicolor icons were absent from a deb
that contained them. Capture once, then search with `<<<`.

**The release tag goes on after the merge**, not via `npm version` — its own tag
points at the pre-merge commit, which a squash merge leaves off `main`.

**A tag-triggered run uses the workflow as it was at that tag.** A bug in
`release.yml` cannot be fixed by pushing to `main` and re-running. Recovering
means re-cutting the tag, which the tag ruleset blocks by design.

**`release.yml` calls the same workflows `ci.yml` does**, so a release takes a
build path every PR already exercised. What is unique to it — the tag check and
`gh release create` — gets no PR coverage and is unverified until it matters.

## Pinned dependencies

Deliberate, with reasons; see `//pinned` in `package.json`. Electron itself should
stay current: it ships Chromium to the user, so an out-of-support Electron means
shipping unpatched browser CVEs.

## Style

Match the surrounding code. Comments explain *why*, not what — most existing
comments mark a decision or a trap, and that is the bar. British spelling in
user-facing text.

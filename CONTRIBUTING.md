# Contributing

A tiling digital DM screen for tabletop RPGs — Electron, React and TypeScript.
This file is for people. `CLAUDE.md` is a rules file for AI coding assistants;
you do not need to read it, though it is where the accumulated traps live.

## Getting set up

The whole toolchain runs in Docker, so nothing needs installing beyond Docker
itself. You can also just install Node 24 and run the scripts directly — the
Docker setup exists because the primary maintainer keeps Node off their machine,
not because anything here depends on it.

```sh
docker compose run --rm build npm install     # first time, and after dependency changes
docker compose run --rm build npm run check   # format + lint + typecheck + test
docker compose run --rm build npm run build   # typecheck + bundle
docker compose run --rm smoke                 # headless render check
```

`node_modules` lives in a named volume so Linux-only binaries never land in a
Windows checkout. `release/` is a bind mount, so anything built appears in the
tree.

In CI, `docker compose run` needs `-T` — the `build` service sets
`stdin_open`/`tty` and dies without a terminal. CI does not actually use Docker
any more, but the flag is still worth knowing for any script you write.

## Running it

```sh
docker compose run --rm --service-ports build npm run dev
```

## Building installers

**CI builds what users install.** A local `dist:*` is a development convenience.
If you want a real installer for a branch, dispatch the workflow instead:

```sh
gh workflow run ci.yml --ref <branch>
```

Artifacts appear on the run, labelled with the PR number if the branch has one
open. Locally:

| Command | Produces | Where it runs |
| --- | --- | --- |
| `npm run dist:linux` | AppImage + deb | Docker, any host |
| `npm run dist:win` | NSIS installer + portable exe | Docker, any host (via Wine) |
| `npm run dist:mac` | DMG | **macOS only** |
| `npm run dist:dir` | unpacked directory, no installer | anywhere — fastest |

Docker covers Linux and Windows from any host, including a Mac. macOS targets
cannot be cross-built at all and are guarded by `dist:mac:host`: the DMG step
needs `sips`, and the zip target silently produces a structurally invalid bundle.
The Wine path is unverified under Apple Silicon emulation — if you try it, say
what happened rather than assuming.

**On Windows, close the app before building.** A running portable exe locks
itself and NSIS fails with a bare "Error - aborting creation process". The Linux
targets may succeed first, leaving a half-fresh `release/`.

## Testing

Two tiers, and no others.

**Unit tests** — Vitest over `src/renderer/src/lib/*.test.ts`. Pure functions
with inputs and outputs. New logic in `src/shared/` or `src/renderer/src/lib/`
ships with tests in the same PR.

```sh
docker compose run --rm build npm run test
docker compose run --rm build npm run test:watch
```

Prefer moving logic *out* of components and into `lib/` so it can be tested here.
`menuPlacement.ts` and `palette.ts` are the pattern — the placement maths and the
palette's row selection both live outside their components. A component left thin
enough to have nothing worth asserting is the goal, not a gap.

**Smoke shots** — `scripts/smoke.mjs` launches the built app on a virtual display,
drives it, asserts against the real DOM and screenshots the result into
`release/smoke/`. New or changed UI ships with a shot.

```sh
docker compose run --rm build npm run build   # smoke launches out/, not src/
docker compose run --rm smoke
```

Every shot must declare `expect`, or the harness refuses it — a shot that cannot
fail is worse than no shot, because an absent feature photographs exactly as
cleanly as a present one. A bare array is a list of selectors that must be
present and visible:

```js
{ name: 'timers', layout: null, click: '…', expect: ['.tracker-grid', '.timer'] }
```

The long form takes `found`, `missing` and `text`:

```js
expect: { found: ['.card'], missing: ['.empty'], text: ['Paralyzed'] }
```

The screenshots are diagnostics for a failure, not the verification itself.
Assertions say a thing is on screen; whether it *looks* right — spacing, fonts,
clipping — still needs your eyes.

There is no component or end-to-end test runner, deliberately. jsdom cannot see
the layout and overflow bugs that the smoke harness exists to catch, and the
smoke harness already fills the end-to-end slot.

## Adding a module

One file in `src/renderer/src/modules/`, registered in `registry.ts`. Persistence,
the picker, fullscreen and the settings drawer all come from the host, so there is
nothing else to wire.

Two things to get right, both of which have caused real bugs:

- **`defaultState()` must be stable** — it is called repeatedly to build a merge
  base, so use literal ids (`'tbl_complications'`), never `uid()`.
- **Panel state is sparse.** Only what the user changed is stored; your defaults
  are merged over it. Anything reading *another* panel's state has to merge over
  that module's defaults too.

## Reference data

Everything shipped under `src/renderer/src/data/` is **SRD only**. That is what
lets the repo carry MIT for code and CC BY 4.0 for the text — please do not add
anything else, however small. Non-SRD content belongs in a `.dmpack.json` data
pack loaded at runtime, which lives outside this repo.

It is 2014-edition D&D. Verify against a source rather than memory;
`https://www.dnd5eapi.co/api/2014/...` is the easiest check.

## Pull requests

- One imperative line as the subject, no body, no trailers.
- British spelling in anything user-facing.
- Comments explain *why*, not what.
- `npm run check` must pass, and CI must be green — `check`, `smoke / smoke` and
  the three `build / *` jobs are required.
- If your change makes a paragraph in `CLAUDE.md` untrue, update it in the same
  PR. Documentation is not a follow-up task.

## Verifying a Linux package by hand

The `.deb` carries AppStream metainfo and a hicolor icon set, and both are
silently droppable — a bad `<launchable>` or a missing size produces a package
that installs fine and shows up as a nameless, iconless entry. CI checks they are
present. To check they actually *parse*, unpack over a throwaway Ubuntu:

```sh
docker run --rm -v "${PWD}/release:/r" ubuntu:24.04 bash -c \
  'apt-get update -qq && apt-get install -y -qq appstream &&
   dpkg-deb -x /r/Digital-DM-Screen-*-amd64.deb / &&
   appstreamcli dump dev.travus.dmscreen'
```

Expect `Name: Digital DM Screen` and `Icon: digital-dm-screen` — the icon is what
proves the `<launchable>` matched the installed `.desktop` file. Check `ubuntu:20.04`
too: it ships AppStream 0.12, where a newer tag is an *info*, not an error, and the
value is silently dropped. Use `dump` rather than `get`, which prints a fixed
summary and hides exactly that.

## macOS builds

Built on a native `macos-15` runner and **ad-hoc signed**, which means a
downloaded copy needs a one-time:

```sh
xattr -dr com.apple.quarantine "/Applications/Digital DM Screen.app"
```

Managed Macs may refuse it entirely. This is a personal build, not normal public
distribution — that would need a paid Apple Developer ID and notarization.

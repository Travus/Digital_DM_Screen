# Contributing

A tiling digital DM screen for tabletop RPGs. Built on Electron, React and TypeScript.

## Getting set up

The whole toolchain runs in Docker, so nothing needs installing beyond Docker itself. You can also just install Node 24 and run the scripts directly.

```sh
docker compose run --rm build npm install     # first time, and after dependency changes
docker compose run --rm build npm run check   # format + lint + typecheck + test
docker compose run --rm build npm run build   # typecheck + bundle
docker compose run --rm smoke                 # headless render check
```

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

Artifacts appear on the run, labelled with the PR number if the branch has one open. Locally:

| Command | Produces | Where it runs |
| --- | --- | --- |
| `npm run dist:linux` | AppImage + deb | Docker, any host |
| `npm run dist:win` | NSIS installer + portable exe | Docker, any host (via Wine) |
| `npm run dist:mac` | DMG | **macOS only** |
| `npm run dist:dir` | unpacked directory, no installer | anywhere, fastest |

Docker covers Linux and Windows from any host, including a Mac. macOS targets cannot be cross-built at all and are guarded by `dist:mac:host`: the DMG step needs `sips`, and the zip target silently produces a structurally invalid bundle. The Wine path is unverified under Apple Silicon emulation.

**On Windows, close the app before building.** A running portable exe locks itself and NSIS fails with a bare "Error - aborting creation process". The Linux targets may succeed first, leaving a half-fresh `release/`.

## Testing

Two tiers, and no others.

**Unit tests**: Vitest over every `*.test.ts` under `src/`, which lives beside the file it covers. Pure functions with inputs and outputs. New logic ships with tests in the same PR.

```sh
docker compose run --rm build npm run test
docker compose run --rm build npm run test:watch
```

Prefer moving logic *out* of components — and out of anything holding an Electron handle — so it can be tested here. `menuPlacement.ts`, `palette.ts` and `menuTemplate.ts` are the pattern: the placement maths, the palette's row selection and the whole application menu all live outside the thing that renders them, so `menu.ts` is two lines and every macOS branch of that menu is checkable without a Mac. A file left thin enough to have nothing worth asserting is the goal.

**Smoke shots** — `scripts/smoke.mjs` launches the built app on a virtual display, drives it, asserts against the real DOM and screenshots the result into `release/smoke/`. New or changed UI ships with a shot.

```sh
docker compose run --rm build npm run build   # smoke launches out/, not src/
docker compose run --rm smoke
```

Every shot must declare `expect`, or the harness refuses it. A shot that cannot fail is worse than no shot, because an absent feature photographs exactly as cleanly as a present one. A bare array is a list of selectors that must be present and visible:

```js
{ name: 'timers', layout: null, click: '…', expect: ['.tracker-grid', '.timer'] }
```

The long form takes `found`, `missing` and `text`:

```js
expect: { found: ['.card'], missing: ['.empty'], text: ['Paralyzed'] }
```

A shot drives the UI with `menu`, `click`, `press` and `type`, which run in that fixed order. When the behaviour under test *is* a transition — two inputs deep, or two of one kind — write them out instead:

```js
steps: [
  { menu: 'app:palette' },
  { type: { selector: '.palette-input', text: 'panel' } },
  { press: { key: 'End' } },
  { press: { key: 'Enter' } }
]
```

The screenshots are diagnostics for a failure, not the verification itself. Assertions say a thing is on screen; whether it *looks* right, has correct spacing, fonts, and doesn't clip still needs manual verification.

There is no component or end-to-end test runner, deliberately, and the pressure that keeps it unnecessary is worth naming: logic gets pushed out into pure functions until what remains in a component is thin enough for the smoke harness to reach from outside. When something resists — when a decision only makes sense inside the render — that is usually the signal to move it out, not the signal to add a runner. jsdom also cannot see the layout and overflow bugs the smoke harness exists to catch, and that harness already fills the end-to-end slot.

## Adding a module

One file in `src/renderer/src/modules/`, registered in `registry.ts`. Persistence, the picker, fullscreen and the settings drawer all come from the host, so there is nothing else to wire.

Two things to get right, both of which have caused real bugs:

- **`defaultState()` must be stable.** It is called repeatedly to build a merge base, so use literal ids (`'tbl_complications'`), never `uid()`.
- **Panel state is sparse.** Only what the user changed is stored; your defaults are merged over it. Anything reading *another* panel's state has to merge over that module's defaults too.

## Reference data

Everything shipped under `src/renderer/src/data/` is **SRD only**. That is what lets the repo carry MIT for code and CC BY 4.0 for the text. Do not add anything that is not in the SRD. Non-SRD content belongs in a `.dmpack.json` data pack loaded at runtime, which lives outside this repo.

The shipped data is for 2014-edition D&D.

## Pull requests

- British spelling in anything user-facing.
- Comments explain *why*, not what.
- `npm run check` must pass, and CI must be green. `check`, `smoke / smoke` and the three `build / *` jobs are required.
- If your change makes a paragraph in `CLAUDE.md` untrue, update it in the same PR. Documentation is not a follow-up task.

## macOS builds

Built on a native `macos-15` runner and **ad-hoc signed**, which means a downloaded copy needs a one-time:

```sh
xattr -dr com.apple.quarantine "/Applications/Digital DM Screen.app"
```

Managed Macs may refuse it entirely. This is a personal build, not normal public distribution, that would need a paid Apple Developer ID and notarization.

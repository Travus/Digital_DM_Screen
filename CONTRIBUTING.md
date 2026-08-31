# Contributing

A tiling digital DM screen for tabletop RPGs. Built on Electron, React and TypeScript.

## Getting set up

The whole toolchain runs in Docker, so you install nothing beyond Docker itself. You can also install Node 24, the version the Docker image pins, and run the same scripts directly.

```sh
docker compose run --rm build npm install     # first time, and after dependency changes
docker compose run --rm build npm run check   # format + lint + typecheck + test
docker compose run --rm build npm run build   # typecheck + bundle
docker compose run --rm smoke                 # headless render check
```

## Running it

`npm run dev` opens a real window, so it needs a display and cannot run in the container. It is the one part of the workflow that wants Node on the host (or a Linux box with X). Everything headless runs in Docker: install, check, packaging, and the smoke harness when you need to see the built app draw.

## Testing

Two tiers:

**Unit tests**: Vitest runs every `*.test.ts` under `src/`, beside the file it covers. Pure functions with inputs and outputs. New logic should ship with tests in the same PR.

```sh
docker compose run --rm build npm run test
docker compose run --rm build npm run test:watch
```

Prefer moving logic *out* of components, and out of anything that holds an Electron handle, so it can be tested here. `menuPlacement.ts`, `palette.ts` and `menuTemplate.ts` are good examples of this pattern. The placement maths, the palette's row selection and the whole application menu all live outside the thing that renders them, so `menu.ts` is two lines and every macOS branch of that menu is checkable without a Mac. A file left thin enough to have nothing worth asserting is the goal.

**Smoke shots**: `scripts/smoke.mjs` launches the built app on a virtual display, drives it, asserts against the real DOM, and screenshots the result into `release/smoke/`. New or changed UI should ship with a smoke shot.

```sh
docker compose run --rm build npm run build   # smoke launches out/, not src/
docker compose run --rm smoke
```

Shots run four at a time, which puts the suite around 45 seconds rather than two minutes. Each one gets its own userData directory and its own virtual display, so they cannot see each other. If a shot fails and you suspect load rather than code, run them one at a time.

```sh
docker compose run --rm -e SMOKE_CONCURRENCY=1 smoke
```

Every shot must declare `expect`, or the harness refuses it. A shot that cannot fail is worse than no shot, as this only gives a false sense of security. A bare array is a list of selectors that must be present and visible:

```js
{ name: 'timers', layout: null, click: '…', expect: ['.tracker-grid', '.timer'] }
```

The long form takes `found`, `missing` and `text`:

```js
expect: { found: ['.card'], missing: ['.empty'], text: ['Paralyzed'] }
```

It also takes `metrics`, which asks whether two elements are laid out alike rather than whether something is on screen. Every property listed must read the same on both — a computed style by its CSS name, or `clientWidth`, `clientHeight`, `scrollWidth` or `scrollHeight` for the box itself. Reach for it when a thing can be present, visible, correct-looking and still wrong, which is what the Notes mirror is when it slides out from under the caret it sits below:

```js
expect: {
  found: ['.markup-mirror'],
  metrics: [{ a: '.markup-mirror', b: '.markup-input', props: ['line-height', 'clientWidth'] }]
}
```

A shot drives the UI with `menu`, `click`, `press`, `type`, `select`, `wheel` and `hover`, which run in that fixed order. When the behaviour under test *is* a transition, two inputs deep or two of one kind, write them out as `steps` instead: an ordered list of the same actions plus `wait`:

```js
steps: [
  { menu: 'app:palette' },
  { type: { selector: '.palette-input', text: 'panel' } },
  { press: { key: 'End' } },
  { press: { key: 'Enter' } }
]
```

Beyond the input steps, a shot can seed and reach state the clicks cannot. `layout` seeds a session from a `.dmscreen` file, and `mutate` adjusts it. `writable` gives a saving shot its own copy to save to. `data` and `keys` seed data packs and keybindings. `drag` drops one element on another, and `window` points the whole shot, or a single step, at a second window. The existing shots in `scripts/smoke.mjs` use all of these and carry comments where a field does something subtle. Use these as examples or templates.

The screenshots are diagnostics for a failure, not the verification itself. Assertions say a thing is on screen. Whether it *looks* right, with correct spacing and fonts and no clipping, still needs eyes on the images.

There is no component or end-to-end test runner, deliberately. Logic gets pushed out into pure functions until what remains in a component is thin enough for the smoke harness to reach from outside. When a decision only makes sense inside the render, that is usually the signal to move it out rather than to add a runner. jsdom also cannot see the layout and overflow bugs the smoke harness exists to catch, and that harness already fills the end-to-end slot.

## Adding a module

One file in `src/renderer/src/modules/`, registered in `registry.ts`. Persistence, the picker, fullscreen and the settings drawer all come from the host, so there is nothing else to wire.

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

Two things to keep in mind:

- **`defaultState()` must be stable.** It is called repeatedly to build a merge base, so use literal ids (`'tbl_complications'`), never `uid()`.
- **Panel state is sparse.** Only what the user changed is stored, and your defaults are merged over it. Anything that reads *another* panel's state has to merge over that module's defaults too.

## Reference data

Everything shipped under `src/renderer/src/data/` is **SRD only**. That is what lets the repo carry MIT for code and CC BY 4.0 for the text. Do not add anything that is not in the SRD. Non-SRD content belongs in a `.dmpack.json` data pack loaded at runtime, which lives outside this repo.

The shipped data is for 2014-edition D&D.

## Style

British spelling in anything a user sees. Comments explain *why*, not what.

## Building installers

**CI builds what users install.** A local `dist:*` is a development convenience. If you want a real installer for a branch, dispatch the workflow instead:

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

**On Windows, close the app before you build.** A running portable exe locks itself, and NSIS fails with a bare "Error - aborting creation process". The Linux targets may succeed first, which leaves a half-fresh `release/`.

**macOS is the exception.** `dist:mac` runs on macOS only and refuses anywhere else, because a cross-built Mac bundle is structurally invalid even when the build appears to succeed. CI builds the real one on a native `macos-15` runner and signs it ad-hoc, so a downloaded copy needs a one-time `xattr -dr com.apple.quarantine "/Applications/Digital DM Screen.app"`. Managed Macs may refuse it entirely. This is a personal build, not normal public distribution, which would need a paid Apple Developer ID and notarization.

## CI

Three workflows run on their own:

| Workflow | When it runs |
|---|---|
| `ci.yml` | every pull request, and every push to `main` |
| `audit.yml` | weekly, on demand, and on pull requests that touch the lockfile |
| `release.yml` | when you push a `v*.*.*` tag |

`ci.yml` runs three jobs in order, and each waits for the one before it: `check` (format, lint, typecheck, tests), then `smoke`, then the installers. A change that fails to render never reaches the packaging step.

Two more workflows exist, and nothing triggers them directly. `render-check.yml` runs the smoke shots and uploads the screenshots. `build-installers.yml` builds one installer per platform. Both `ci.yml` and `release.yml` call them, so a release takes the same build path as every pull request.

The required checks are `check`, `smoke / smoke`, `build / linux`, `build / windows` and `build / macos-arm64`.

**CI uses no Docker.** Every installer is built on the system it targets: Windows on `windows-latest`, Linux on `ubuntu-latest`, and macOS on the native arm64 `macos-15` runner that a valid app bundle needs. The Docker toolchain is only for local development.

Installers built for a pull request carry its number: `Digital-DM-Screen-0.3.0-PR-17-amd64.deb`. A PR build has the same version as the release it will become, so without the label nothing in the filename tells the two apart once both are in your downloads folder. The installed package still reports the plain version. Only the file is labelled.

### Dependency audits

`audit.yml` runs both of these weekly, and on any pull request that touches the lockfile. Run them yourself when you bump a dependency, before you open the pull request.

```sh
docker compose run --rm build node scripts/audit-deps.mjs
docker compose run --rm build sh -c 'npm audit --json > audit.json || true; node scripts/audit-summary.mjs < audit.json'
```

`audit-deps.mjs` exits non-zero if anything resolves outside registry.npmjs.org, if a package has no integrity hash, or if the set of packages allowed to run install scripts has changed. The third check is the one to care about. A dependency bump that quietly grows a `postinstall` is what a supply-chain attack looks like, and it never shows up in a diff of `package.json`.

## Releasing

A release is a version bump merged into `main`, then a tag pushed at the merge commit.

1. On a branch, bump the version. Pick `major`, `minor` or `patch`.

   ```sh
   docker compose run --rm -T build npm version <major|minor|patch> --no-git-tag-version
   ```

2. Commit the bump, open a pull request, and merge it once CI is green.
3. Check out `main` and pull, so the tag lands on the merge commit.
4. Tag that commit with the version now in `package.json`, and push the tag.

   ```sh
   git tag -a v<version> -m "v<version>"
   git push origin v<version>
   ```

`npm version` runs with `--no-git-tag-version` on purpose. Its own tag points at the pre-merge commit, and a squash merge leaves that commit off `main` entirely.

CI checks the tag against `package.json` and `package-lock.json` before it builds anything. It then renders, builds all five installers, and opens a **draft** release with them attached. Nothing is public until you publish it.

### Release notes

The draft arrives with generated notes, which are a list of pull request titles. Replace them.

Release notes should:
- Leave out anything a user cannot observe: CI changes, build tooling, refactors, tests, and dependency bumps.
- Sort features by how much they matter. Headline features get paragraphs, smaller ones get less.
- Delete the Removals heading when nothing went away. Do not write "none" under it.
- Describe what a feature lets a DM do at the table, not how it was built. The release notes are for end-users.



The template:

```markdown
## New Features

**<Feature>.**
<Feature description.>

## Removals

- <Only when something went away. Delete this heading otherwise.>

## Bug Fixes

- <What was wrong, in terms a user would have noticed.>

## Artifact Info

| File | For |
| --- | --- |
| `Digital-DM-Screen-<version>-x64-setup.exe` | Windows installer |
| `Digital-DM-Screen-<version>-x64-portable.exe` | Windows, no install |
| `Digital-DM-Screen-<version>.AppImage` | Linux, no install |
| `Digital-DM-Screen-<version>-amd64.deb` | Debian and Ubuntu |
| `Digital-DM-Screen-<version>-arm64.dmg` | macOS on Apple silicon |

The Mac build is ad-hoc signed. Copy the app to Applications, then clear quarantine once with `xattr -dr com.apple.quarantine "/Applications/Digital DM Screen.app"`.
```

/**
 * Headless smoke check. Seeds a session from a layout file, launches the built
 * app on a virtual display, screenshots it, and fails loudly on a renderer
 * crash or console error.
 *
 *   docker compose run --rm smoke
 *
 * Screenshots land in ./release/smoke/.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'release', 'smoke')
const configHome = join(root, 'release', 'smoke', 'config')

// Must match the "name" field in package.json — that is what app.getName()
// returns for an unpackaged run, and it decides the userData directory.
const userData = join(configHome, 'digital-dm-screen')

const starter = join(root, 'examples', 'starter.dmscreen')
const fixturePack = join(root, 'examples', 'smoke-pack.dmpack.json')

const shots = [
  { name: 'starter', layout: starter },
  { name: 'empty', layout: null },
  // Drives one control through the real UI before capturing.
  { name: 'maximized', layout: starter, click: '.panel .icon-btn[title^="Fullscreen"]' },
  { name: 'light-theme', layout: starter, click: '.topbar .icon-btn[title*="light theme"]' },
  // `:has` picks the party panel specifically — it is the one with a resizable
  // table. Fullscreen it first so the settings drawer has room to show fully.
  {
    name: 'party-settings',
    layout: starter,
    click: [
      '.panel:has(.table.resizable) .icon-btn[title^="Fullscreen"]',
      '.panel:has(.table.resizable) .icon-btn[title="Panel settings"]'
    ].join('\n')
  },
  // Regression: selecting the second starter table used to do nothing, because
  // the module's defaults were rebuilt (with fresh ids) on every render.
  {
    name: 'tables-second-tab',
    layout: null,
    click: ['.picker-card[data-module-id="tables"]', '.tabs .tab:nth-of-type(2)'].join('\n')
  },
  // Party panel fullscreened: row actions pinned right, numbers centred.
  {
    name: 'party-wide',
    layout: starter,
    click: '.panel:has(.table.resizable) .icon-btn[title^="Fullscreen"]'
  },
  // Searching auto-expands every match; can't be reached by clicking, so seed it.
  // The query must hit a condition *name* — the list deliberately does not search
  // body text. This shot previously seeded "saving throw", which no name contains,
  // so it had been quietly capturing the empty state instead.
  {
    name: 'conditions-search',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.state.query = 'ned'
    }
  },
  // The typo-tolerant fallback: "paralzyed" transposes two letters and matches
  // nothing exactly, so this shot goes red if the fuzzy path ever stops working.
  {
    name: 'conditions-search-fuzzy',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.state.query = 'paralzyed'
    }
  },
  {
    name: 'timers',
    layout: null,
    click: ['.picker-card[data-module-id="timers"]', '.timer .btn.primary'].join('\n'),
    // Dwell so the capture shows the clock has actually moved, not just started.
    settle: 3000
  },
  // Add a countdown, then focus its readout to show it editing in place.
  {
    name: 'timer-editing',
    layout: null,
    click: [
      '.picker-card[data-module-id="timers"]',
      '.toolbar .btn:nth-of-type(2)',
      '.tracker-grid .timer:nth-of-type(2) .timer-readout.editable'
    ].join('\n')
  },
  // The panel menu unlocked, where the rows that have a shortcut show it.
  {
    name: 'panel-menu',
    layout: starter,
    click: '.panel .icon-btn[title="Panel menu"]'
  },
  // The same menu on a panel too short to hold it: every row has to be visible,
  // spilling over the panel below. The shot above never showed this — it opens
  // the menu on the full-height left panel, which has room for it either way.
  {
    name: 'panel-menu-short',
    layout: starter,
    mutate: (doc) => {
      doc.root.children[1].sizes = [0.16, 0.84]
    },
    click: '.panel:has(.table.resizable) .icon-btn[title="Panel menu"]'
  },
  // And near the foot of the window, where it has to open upwards instead.
  {
    name: 'panel-menu-flipped',
    layout: starter,
    mutate: (doc) => {
      doc.root.children[1].sizes = [0.84, 0.16]
    },
    click: '.split.column > .pane:last-child .icon-btn[title="Panel menu"]'
  },
  // The top bar says nothing until hovered; settle has to outlast the delay.
  {
    name: 'topbar-hint',
    layout: starter,
    hover: '.topbar-actions .hint-anchor .btn.primary',
    settle: 900
  },
  // Locked layout: splitter grips gone, structural menu items gone.
  {
    name: 'locked',
    layout: starter,
    click: [
      '.topbar .icon-btn[title*="Lock the layout"]',
      '.panel .icon-btn[title="Panel menu"]'
    ].join('\n')
  },
  // Hovering a condition named inside another condition's text pops it out.
  {
    name: 'condition-popover',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.state.query = 'paralyzed'
    },
    click: '.condition-ref'
  },
  {
    name: 'abilities',
    layout: null,
    click: [
      '.picker-card[data-module-id="abilities"]',
      '.tabs .tab:nth-of-type(1)',
      '.card .star'
    ].join('\n')
  },
  {
    name: 'diseases',
    layout: null,
    click: ['.picker-card[data-module-id="diseases"]', '.card .star'].join('\n')
  },
  // The second tab — proves tab switching, and shows the source labelling.
  {
    name: 'abilities-cd',
    layout: null,
    click: ['.picker-card[data-module-id="abilities"]', '.tabs .tab:nth-of-type(2)'].join('\n')
  },
  {
    name: 'names',
    layout: null,
    click: [
      '.picker-card[data-module-id="names"]',
      '.toolbar .btn.primary',
      '.btn[title*="quirk"]',
      '.npc-card .btn.primary'
    ].join('\n')
  },

  /* -------------------------------------------------------------- shortcuts */

  // The editor, on defaults: every row shows the chord the menu carries, and
  // "Leave panel fullscreen" shows as fixed rather than simply missing.
  {
    name: 'shortcuts-editor',
    layout: starter,
    menu: 'app:shortcuts'
  },
  // Mid-capture. Also the shot that would catch the recording state failing to
  // announce itself, which matters because it is swallowing every keypress.
  {
    name: 'shortcuts-recording',
    layout: starter,
    menu: 'app:shortcuts',
    click: '.shortcut-row:nth-of-type(3) .shortcut-key'
  },
  // The point of the whole change: one entry in keybindings.json, and the ⋯
  // menu row says the new chord. Before this PR the row read from a literal
  // table that knew nothing about the menu's accelerators, so it would have gone
  // on saying Ctrl+W here.
  {
    name: 'shortcuts-rebound',
    layout: starter,
    keys: { 'panel:close': 'CmdOrCtrl+Alt+K', 'panel:splitRight': null },
    click: '.panel .icon-btn[title="Panel menu"]'
  },
  // Two-stroke sequences, tmux-style: a modified prefix and a bare finish. The ⋯
  // menu has to print both halves, which is the whole visible difference between
  // a sequence working and a sequence being silently truncated to its prefix.
  {
    name: 'shortcuts-chords',
    layout: starter,
    keys: { 'panel:splitRight': 'CmdOrCtrl+B 5', 'panel:splitDown': 'CmdOrCtrl+B 2' },
    click: '.panel .icon-btn[title="Panel menu"]'
  },
  // Half-typed. The indicator has to be visible and say what it is waiting for —
  // the app is swallowing the next keystroke, and silence there reads as a
  // dropped key rather than a deliberate state.
  {
    name: 'chord-pending',
    layout: starter,
    keys: { 'panel:splitRight': 'CmdOrCtrl+B 5' },
    press: { code: 'KeyB', ctrlKey: true }
  },
  // Every modifier on both strokes — a legal binding, and the one that used to
  // wrap "Split right" onto two lines because the label was the only thing in
  // the row allowed to give. The label must stay on one line here.
  {
    name: 'shortcuts-long-binding',
    layout: starter,
    keys: {
      'panel:splitRight': 'Super+CmdOrCtrl+Alt+Shift+J Super+CmdOrCtrl+Alt+Shift+4'
    },
    click: '.panel .icon-btn[title="Panel menu"]'
  },
  // The preset list, which is also the shot that would catch a preset going
  // missing or a blurb overflowing its row.
  {
    name: 'shortcuts-presets',
    layout: starter,
    menu: 'app:shortcuts'
  },
  // The VS Code keymap applied. Split Down and Keyboard Shortcuts both read as
  // sequences, and Save keeps Ctrl+S even though the sequence ends on it — the
  // arrangement that was impossible before the renderer learned to arbitrate.
  {
    name: 'shortcuts-vscode',
    layout: starter,
    keys: {
      'panel:splitDown': 'CmdOrCtrl+K CmdOrCtrl+\\',
      'app:shortcuts': 'CmdOrCtrl+K CmdOrCtrl+S'
    },
    menu: 'app:shortcuts'
  },

  /* ----------------------------------------------------------------- big dice */

  // Fresh from the picker: a d20, unthrown, prompting to be clicked.
  {
    name: 'bigdice',
    layout: null,
    click: '.picker-card[data-module-id="bigdice"]'
  },
  // A real click on the die, dwelt past the tumble so the shot catches a settled
  // result rather than a mid-animation frame. The value is random by nature —
  // what this proves is that the throw path works end to end.
  {
    name: 'bigdice-thrown',
    layout: null,
    click: ['.picker-card[data-module-id="bigdice"]', '.bigdice-stage'].join('\n'),
    settle: 1400
  },
  // Seeded rather than rolled, because a natural 20 cannot be arranged by
  // clicking. Shows the flourish and the history strip together.
  {
    name: 'bigdice-nat20',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.state = {
        sides: 20,
        value: 20,
        history: [
          { id: 'throw_a', sides: 20, value: 20 },
          { id: 'throw_b', sides: 20, value: 7 },
          { id: 'throw_c', sides: 20, value: 13 }
        ]
      }
    }
  },
  // Percentile renders as the two ten-sided dice it physically is, so this is
  // the shot that would catch it collapsing back to one. Seeded at 100 — the one
  // throw in a hundred that shows 00 and 0, and the only three-digit total the
  // history strip ever has to hold.
  {
    name: 'bigdice-percentile',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.state = {
        sides: 100,
        value: 100,
        history: [
          { id: 'throw_p', sides: 100, value: 100 },
          { id: 'throw_q', sides: 100, value: 7 },
          { id: 'throw_r', sides: 100, value: 62 }
        ]
      }
    }
  },
  // The two numbers that came closest to overflowing their faces, at two very
  // different panel sizes: a d12 showing 12 and a d4 showing 4. Both sit inside
  // an inner face, so this is what would catch either one clipping again.
  {
    name: 'bigdice-tight-faces',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = { sides: 4, value: 4, history: [] }
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.state = { sides: 12, value: 12, history: [] }
    }
  },

  /* --------------------------------------------------------------- data packs */

  // The important one. With no conditions loaded, the cross-reference scanner
  // used to build an empty-alternation regex and hang the renderer — every card
  // in the app renders through it, so this shot would time out rather than fail
  // quietly. Keep it.
  {
    name: 'conditions-empty',
    layout: starter,
    data: {
      refs: [],
      enabled: { conditions: false, rules: false, abilities: false, diseases: false }
    }
  },
  // Says "no data loaded" and points at the Data menu, rather than blaming the
  // panel's own settings, which have nothing to fix.
  {
    name: 'abilities-empty',
    layout: null,
    data: { refs: [], enabled: { abilities: false } },
    click: '.picker-card[data-module-id="abilities"]'
  },
  // Both pack behaviours in one frame: the tab bar shows "Fixture Tricks", a tab
  // the pack created, while Metamagic shows the pack's entry merged in among the
  // bundled ones rather than replacing them.
  {
    name: 'pack-loaded',
    layout: null,
    data: { refs: [{ id: 'smoke-fixture', name: 'Smoke Fixture', path: fixturePack }] },
    click: ['.picker-card[data-module-id="abilities"]', '.tabs .tab:nth-of-type(1)'].join('\n')
  },
  // A pack whose file has moved. The app must still render, and say so.
  {
    name: 'pack-broken',
    layout: starter,
    data: { refs: [{ id: 'gone', name: 'Missing Pack', path: '/nonexistent/gone.dmpack.json' }] },
    click: '.topbar .btn[title="Recent layouts"]'
  }
]

async function seedSession(layoutPath, mutate, data, keys) {
  await rm(userData, { recursive: true, force: true })
  await mkdir(userData, { recursive: true })

  // Packs and the bundled-content switches live in userData, so a shot can set
  // up any data state without needing the menu.
  if (data) {
    await writeFile(join(userData, 'datapacks.json'), JSON.stringify(data, null, 2))
  }

  // Keybinding overrides live there too, and sparsely — one entry is a whole
  // rebinding, which is what makes a "did the label follow the key" shot cheap.
  if (keys) {
    await writeFile(join(userData, 'keybindings.json'), JSON.stringify(keys, null, 2))
  }

  if (!layoutPath) return
  const doc = JSON.parse(await readFile(layoutPath, 'utf8'))
  // Lets a shot start from a state that can't be reached by clicking alone.
  mutate?.(doc)
  await writeFile(
    join(userData, 'session.json'),
    JSON.stringify({ doc, filePath: layoutPath, dirty: false }, null, 2)
  )
  await writeFile(
    join(userData, 'recents.json'),
    JSON.stringify(
      [{ path: layoutPath, name: doc.name, openedAt: new Date().toISOString() }],
      null,
      2
    )
  )
}

function run(shotPath, click, settle, hover, menu, press) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'xvfb-run',
      [
        '-a',
        '--server-args=-screen 0 1600x1000x24',
        'node_modules/.bin/electron',
        '--no-sandbox',
        '.'
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: configHome,
          DMSCREEN_SMOKE_SHOT: shotPath,
          ...(menu ? { DMSCREEN_SMOKE_MENU: menu } : {}),
          ...(click ? { DMSCREEN_SMOKE_CLICK: click } : {}),
          ...(press ? { DMSCREEN_SMOKE_PRESS: JSON.stringify(press) } : {}),
          ...(hover ? { DMSCREEN_SMOKE_HOVER: hover } : {}),
          ...(settle ? { DMSCREEN_SMOKE_SETTLE: String(settle) } : {}),
          ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Timed out.\n${output}`))
    }, 60_000)

    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`Electron exited with ${code}.\n${output}`))
      resolvePromise(output)
    })
  })
}

await mkdir(outDir, { recursive: true })

let failed = false
for (const shot of shots) {
  const shotPath = join(outDir, `${shot.name}.png`)
  await rm(shotPath, { force: true })
  await seedSession(shot.layout, shot.mutate, shot.data, shot.keys)

  process.stdout.write(`▸ ${shot.name} … `)
  try {
    const output = await run(shotPath, shot.click, shot.settle, shot.hover, shot.menu, shot.press)

    if (!existsSync(shotPath)) throw new Error(`no screenshot written.\n${output}`)

    // The renderer forwards console errors to stdout via the main process.
    const problems = output
      .split('\n')
      .filter((line) => /\[renderer:(error)\]|Uncaught|ERR_FILE_NOT_FOUND/.test(line))
    if (problems.length) throw new Error(`renderer reported problems:\n${problems.join('\n')}`)

    console.log(`ok → ${shotPath}`)
  } catch (error) {
    failed = true
    console.log('FAILED')
    console.error(String(error.message ?? error))
  }
}

process.exit(failed ? 1 : 0)

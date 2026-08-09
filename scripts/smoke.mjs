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
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'release', 'smoke')
const configRoot = join(root, 'release', 'smoke', 'config')

/**
 * Where one shot's userData lives.
 *
 * Per shot, because shots run several at a time and every one of them seeds
 * `session.json`, `datapacks.json` and `keybindings.json` before it starts —
 * sharing one directory, they would seed over each other and photograph a
 * neighbour's layout. `XDG_CONFIG_HOME` is set in each child's spawn env rather
 * than inherited, so a directory per shot is the whole of the isolation.
 *
 * The last segment must match the "name" field in package.json — that is what
 * app.getName() returns for an unpackaged run, and it decides the userData path.
 */
function userDataFor(name) {
  return join(configRoot, name, 'digital-dm-screen')
}

const starter = join(root, 'examples', 'starter.dmscreen')
const fixturePack = join(root, 'examples', 'smoke-pack.dmpack.json')

const shots = [
  {
    name: 'starter',
    layout: starter,
    expect: ['.panel', '.split', '.table.resizable', '.splitter-grip']
  },
  { name: 'empty', layout: null, expect: ['.picker', '.picker-card'] },
  // Drives one control through the real UI before capturing.
  {
    name: 'maximized',
    layout: starter,
    click: '.panel .icon-btn[title^="Fullscreen"]',
    expect: ['.app.has-maximized', '.restore-hint']
  },
  // The hint above, dwelt past its own timer. Seeded with the dice history
  // because that strip is what the hint was found sitting on top of, so the
  // capture shows the thing it used to cover. `missing` rather than a check on
  // opacity: a faded hint still takes the clicks meant for the row beneath it,
  // so leaving the DOM is the fix and being invisible is only half of it.
  {
    name: 'maximized-hint-fades',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.state = {
        sides: 20,
        value: 14,
        history: [
          { id: 'throw_a', sides: 20, value: 14 },
          { id: 'throw_b', sides: 20, value: 3 },
          { id: 'throw_c', sides: 20, value: 19 }
        ]
      }
    },
    click: '.panel:has(.bigdice) .icon-btn[title^="Fullscreen"]',
    settle: 5000,
    expect: { found: ['.app.has-maximized', '.bigdice-past'], missing: ['.restore-hint'] }
  },
  {
    name: 'light-theme',
    layout: starter,
    click: '.topbar .icon-btn[title*="light theme"]',
    // `applyTheme` writes the choice to the root element's dataset, so this is
    // the one assertion that says the click reached the store rather than just
    // repainting something.
    expect: ['html[data-theme="light"]', '.panel']
  },
  // `:has` picks the party panel specifically — it is the one with a resizable
  // table. Fullscreen it first so the settings drawer has room to show fully.
  {
    name: 'party-settings',
    layout: starter,
    click: [
      '.panel:has(.table.resizable) .icon-btn[title^="Fullscreen"]',
      '.panel:has(.table.resizable) .icon-btn[title="Panel settings"]'
    ].join('\n'),
    expect: ['.panel-settings', '.panel-settings-head', '.settings-section']
  },
  // Regression: selecting the second starter table used to do nothing, because
  // the module's defaults were rebuilt (with fresh ids) on every render.
  {
    name: 'tables-second-tab',
    layout: null,
    click: ['.picker-card[data-module-id="tables"]', '.tabs .tab:nth-of-type(2)'].join('\n'),
    // The regression was that clicking the second tab did nothing, so the
    // assertion has to be that *that* tab is the active one — `.tab.active`
    // alone would be just as true of the first.
    expect: ['.tabs .tab:nth-of-type(2).active']
  },
  // Party panel fullscreened: row actions pinned right, numbers centred.
  {
    name: 'party-wide',
    layout: starter,
    click: '.panel:has(.table.resizable) .icon-btn[title^="Fullscreen"]',
    expect: ['.app.has-maximized', '.table.resizable', '.col-actions']
  },
  // Searching auto-expands every match; can't be reached by clicking, so seed it.
  // The query must hit a condition *name* — the list deliberately does not search
  // body text. This shot previously seeded "saving throw", which no name contains,
  // so it had been quietly capturing the empty state instead. The `missing` line
  // is what makes that unrepeatable.
  {
    name: 'conditions-search',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.state.query = 'ned'
    },
    expect: { found: ['.card'], missing: ['.empty'], text: ['Stunned'] }
  },
  // The typo-tolerant fallback: "paralzyed" transposes two letters and matches
  // nothing exactly, so this shot goes red if the fuzzy path ever stops working.
  {
    name: 'conditions-search-fuzzy',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.state.query = 'paralzyed'
    },
    expect: { found: ['.card'], missing: ['.empty'], text: ['Paralyzed'] }
  },
  {
    name: 'timers',
    layout: null,
    click: ['.picker-card[data-module-id="timers"]', '.timer .btn.primary'].join('\n'),
    // Dwell so the capture shows the clock has actually moved, not just started.
    settle: 3000,
    expect: ['.tracker-grid', '.timer', '.timer-readout']
  },
  // Add a countdown, then focus its readout to show it editing in place.
  {
    name: 'timer-editing',
    layout: null,
    click: [
      '.picker-card[data-module-id="timers"]',
      '.toolbar .btn:nth-of-type(2)',
      '.tracker-grid .timer:nth-of-type(2) .timer-readout.editable'
    ].join('\n'),
    expect: ['.tracker-grid .timer:nth-of-type(2)', '.timer-readout.editable']
  },
  // The panel menu unlocked, where the rows that have a shortcut show it.
  {
    name: 'panel-menu',
    layout: starter,
    click: '.panel .icon-btn[title="Panel menu"]',
    expect: { found: ['.menu', '.menu-item'], text: ['Close panel'] }
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
    click: '.panel:has(.table.resizable) .icon-btn[title="Panel menu"]',
    // "Close panel" is the last row, and the one that used to be clipped off by
    // the panel's own overflow. Asserting the text is what proves the menu is
    // not merely present but complete.
    expect: { found: ['.menu', '.menu-item'], text: ['Close panel'] }
  },
  // The one panel in a fresh window, which is inside no split. Flip and Even Out
  // used to be absent here; they are now rows carrying the reason in a tooltip,
  // so the menu is the same shape whatever the layout is.
  {
    name: 'panel-menu-lone',
    layout: null,
    click: '.panel .icon-btn[title="Panel menu"]',
    // The tooltip is the row's whole explanation, so its text is asserted from
    // the attribute — `innerText` never sees it.
    expect: {
      found: ['.menu', '.menu-item.disabled[title*="not inside a split"]'],
      text: ['Flip surrounding split']
    }
  },
  // And near the foot of the window, where it has to open upwards instead.
  {
    name: 'panel-menu-flipped',
    layout: starter,
    mutate: (doc) => {
      doc.root.children[1].sizes = [0.84, 0.16]
    },
    click: '.split.column > .pane:last-child .icon-btn[title="Panel menu"]',
    expect: { found: ['.menu', '.menu-item'], text: ['Close panel'] }
  },
  // The top bar says nothing until hovered; settle has to outlast the delay.
  {
    name: 'topbar-hint',
    layout: starter,
    hover: '.topbar-actions .hint-anchor .btn.primary',
    settle: 900,
    expect: ['.hint']
  },
  // Locked layout: splitter grips gone, structural menu items greyed in place.
  {
    name: 'locked',
    layout: starter,
    click: [
      '.topbar .icon-btn[title*="Lock the layout"]',
      '.panel .icon-btn[title="Panel menu"]'
    ].join('\n'),
    // The grips going and the rows staying are both the shot. A menu that keeps
    // its length is the point of greying rather than dropping, so "Close panel"
    // present and disabled is what proves it.
    expect: {
      found: ['.menu', '.lock-icon', '.menu-item.disabled.danger'],
      missing: ['.splitter-grip']
    }
  },
  // Renaming the layout. The assertion is only that the field replaced the
  // button; that its text arrives *selected* is a looks-right question, so the
  // capture is what carries it — the same division as every other shot here.
  {
    name: 'rename-layout',
    layout: starter,
    menu: 'layout:rename',
    expect: { found: ['.layout-name-input'], missing: ['.layout-name'] }
  },
  // And a panel's, which opens on the fallback target — `panel_init`, the first
  // panel in the tree, since nothing has been clicked to make another active.
  {
    name: 'rename-panel',
    layout: starter,
    menu: 'panel:rename',
    // No `missing` counterpart to the layout shot above: the other two panels
    // keep their title buttons, which is the point of renaming one of three.
    expect: ['.panel-title-input']
  },
  // Locked, neither field opens at all. Refusing the *commit* alone would look
  // identical up to the point the name was silently dropped on blur, so what is
  // asserted is that nothing opened: the buttons are still buttons.
  {
    name: 'rename-locked-refused',
    layout: starter,
    mutate: (doc) => {
      doc.locked = true
    },
    steps: [{ menu: 'layout:rename' }, { menu: 'panel:rename' }],
    expect: {
      found: ['.layout-name', '.panel-title'],
      missing: ['.layout-name-input', '.panel-title-input']
    }
  },
  // The same lock in the ⋯ menu, where both rows that change a name grey out
  // together. The title is seeded because "Reset panel name" only exists on a
  // panel that has one, and it is the row most easily missed — it changes the
  // name without going near the rename field.
  {
    name: 'rename-locked-menu',
    layout: starter,
    mutate: (doc) => {
      doc.locked = true
      doc.panels.panel_init.title = 'Turn order'
    },
    click: '.panel .icon-btn[title="Panel menu"]',
    // Selected by id, not by tooltip: both rows are off for the same reason now,
    // and `[title*=…]` stopped being able to tell them apart.
    expect: {
      found: [
        '.menu-item[data-menu-item="rename"].disabled[title*="the layout is locked"]',
        '.menu-item[data-menu-item="reset-name"].disabled'
      ],
      text: ['Rename panel', 'Reset panel name']
    }
  },
  // Hovering a condition named inside another condition's text pops it out.
  {
    name: 'condition-popover',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.state.query = 'paralyzed'
    },
    click: '.condition-ref',
    expect: ['.condition-ref', '.condition-pop', '.condition-pop-title']
  },
  {
    name: 'abilities',
    layout: null,
    click: [
      '.picker-card[data-module-id="abilities"]',
      '.tabs .tab:nth-of-type(1)',
      '.card .star'
    ].join('\n'),
    expect: { found: ['.card', '.card-title', '.star'], missing: ['.empty'] }
  },
  {
    name: 'diseases',
    layout: null,
    click: ['.picker-card[data-module-id="diseases"]', '.card .star'].join('\n'),
    expect: { found: ['.card', '.card-title', '.star'], missing: ['.empty'] }
  },
  // The second tab — proves tab switching, and shows the source labelling.
  {
    name: 'abilities-cd',
    layout: null,
    click: ['.picker-card[data-module-id="abilities"]', '.tabs .tab:nth-of-type(2)'].join('\n'),
    // `.card-meta` is the source label, and SRD is what all shipped content
    // reads — so this is also the shot that would catch the labelling vanishing.
    expect: { found: ['.card', '.card-meta'], text: ['SRD'] }
  },
  {
    name: 'names',
    layout: null,
    click: [
      '.picker-card[data-module-id="names"]',
      '.toolbar .btn.primary',
      '.btn[title*="quirk"]',
      '.npc-card .btn.primary'
    ].join('\n'),
    expect: ['.npc-card', '.npc-name', '.npc-line']
  },

  /* -------------------------------------------------------------- shortcuts */

  // The editor, on defaults: every row shows the chord the menu carries, and
  // "Leave panel fullscreen" shows as fixed rather than simply missing.
  {
    name: 'shortcuts-editor',
    layout: starter,
    menu: 'app:shortcuts',
    expect: {
      found: ['.shortcuts-modal', '.shortcut-row', '.shortcut-key'],
      // Shown as fixed rather than simply missing — the row vanishing entirely
      // is the regression this guards.
      text: ['Leave panel fullscreen']
    }
  },
  // Mid-capture. Also the shot that would catch the recording state failing to
  // announce itself, which matters because it is swallowing every keypress.
  {
    name: 'shortcuts-recording',
    layout: starter,
    menu: 'app:shortcuts',
    click: '.shortcut-row:nth-of-type(3) .shortcut-key',
    // The recording class *and* the prompt: the state is swallowing every
    // keypress, so a row that has entered it silently is the failure mode.
    expect: { found: ['.shortcut-key.recording'], text: ['Press keys…'] }
  },
  // The point of the whole change: one entry in keybindings.json, and the ⋯
  // menu row says the new chord. Before this PR the row read from a literal
  // table that knew nothing about the menu's accelerators, so it would have gone
  // on saying Ctrl+W here.
  {
    name: 'shortcuts-rebound',
    layout: starter,
    keys: { 'panel:close': 'CmdOrCtrl+Alt+K', 'panel:splitRight': null },
    click: '.panel .icon-btn[title="Panel menu"]',
    // The rebound key must be the one the row prints. Before the catalogue
    // collapsed the two copies of the accelerators, this row went on saying
    // Ctrl+W — which is exactly what a caption that lies looks like.
    expect: { found: ['.menu'], text: ['Ctrl+Alt+K'] }
  },
  // Two-stroke sequences, tmux-style: a modified prefix and a bare finish. The ⋯
  // menu has to print both halves, which is the whole visible difference between
  // a sequence working and a sequence being silently truncated to its prefix.
  {
    name: 'shortcuts-chords',
    layout: starter,
    keys: { 'panel:splitRight': 'CmdOrCtrl+B 5', 'panel:splitDown': 'CmdOrCtrl+B 2' },
    click: '.panel .icon-btn[title="Panel menu"]',
    // Both halves, because a sequence silently truncated to its prefix still
    // renders a perfectly plausible row.
    expect: { found: ['.menu'], text: ['Ctrl+B 5', 'Ctrl+B 2'] }
  },
  // Half-typed. The indicator has to be visible and say what it is waiting for —
  // the app is swallowing the next keystroke, and silence there reads as a
  // dropped key rather than a deliberate state.
  {
    name: 'chord-pending',
    layout: starter,
    keys: { 'panel:splitRight': 'CmdOrCtrl+B 5' },
    press: { code: 'KeyB', ctrlKey: true },
    expect: { found: ['.chord-pending'], text: ['Ctrl+B'] }
  },
  // A modified Escape is a bindable chord, not the dismiss key, so it must leave
  // fullscreen alone. `key` is set as well as `code` because the dismiss chain
  // reads `event.key` — a shot sending only `code` would pass without ever
  // reaching the branch it claims to test.
  {
    name: 'escape-modified-ignored',
    layout: starter,
    click: '.panel .icon-btn[title^="Fullscreen"]',
    press: { key: 'Escape', code: 'Escape', ctrlKey: true },
    expect: ['.app.has-maximized', '.restore-hint']
  },
  // The control for the shot above: bare Escape still dismisses. Without this,
  // a handler that ignored *every* Escape would pass the one above.
  {
    name: 'escape-bare-dismisses',
    layout: starter,
    click: '.panel .icon-btn[title^="Fullscreen"]',
    press: { key: 'Escape', code: 'Escape' },
    expect: { found: ['.panel'], missing: ['.app.has-maximized', '.restore-hint'] }
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
    click: '.panel .icon-btn[title="Panel menu"]',
    // Whether the label stayed on one line is still eyes-only; that both are
    // present at all is not.
    expect: { found: ['.menu'], text: ['Split right'] }
  },
  // The preset list, which is also the shot that would catch a preset going
  // missing or a blurb overflowing its row.
  {
    name: 'shortcuts-presets',
    layout: starter,
    menu: 'app:shortcuts',
    // Named, so a preset going missing fails here rather than looking like a
    // slightly shorter list.
    expect: {
      found: ['.preset-row', '.preset'],
      text: ['Default', 'VS Code', 'Zed', 'Sublime Text', 'JetBrains', 'Vim', 'tmux', 'None']
    }
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
    menu: 'app:shortcuts',
    // Ctrl+S survives alongside a sequence that ends on it — the arrangement
    // that was impossible before the renderer learned to arbitrate.
    expect: {
      found: ['.shortcuts-modal', '.shortcut-row'],
      text: ['Ctrl+K Ctrl+\\', 'Ctrl+K Ctrl+S', 'Ctrl+S']
    }
  },

  /* ----------------------------------------------------------- action palette */

  // Every command the current layout can run, each with the key that also
  // reaches it — and most of them with none, which is the point of having it.
  {
    name: 'action-palette',
    layout: starter,
    menu: 'app:palette',
    expect: ['.palette', '.palette-input', '.palette-list', '.palette-item', '.palette-category']
  },
  // Filtering, which is the whole interaction and cannot be reached by clicking.
  // The query has to hit real rows: an empty palette photographs exactly like a
  // broken one, which is the trap `conditions-search` sat in.
  {
    name: 'action-palette-search',
    layout: starter,
    menu: 'app:palette',
    type: { selector: '.palette-input', text: 'panel' },
    expect: { found: ['.palette-item'], missing: ['.empty'] }
  },
  // Locked. Splitting, closing and flipping are still listed, greyed and sunk to
  // the bottom, which is what a full list plus an obvious "not now" looks like.
  {
    name: 'action-palette-locked',
    layout: starter,
    mutate: (doc) => {
      doc.locked = true
    },
    menu: 'app:palette',
    // Narrowed to the Panel category, which is where the lock bites: without a
    // query the live rows fill the window and every greyed one is below the
    // fold, so the shot would photograph an ordinary palette. This puts both
    // kinds in one frame, which is the only way the greying is eyes-checkable.
    type: { selector: '.palette-input', text: 'panel' },
    // Present *and* greyed, both asserted: either half alone is the old
    // behaviour. Nothing under the list, because nothing has been activated —
    // standing text explaining rows that already explain themselves is what
    // this replaced.
    expect: {
      found: ['.palette-item.disabled[data-action-id="panel:close"]'],
      missing: ['.palette .note']
    }
  },
  // Activating a greyed row. Nothing happening is the wrong answer to a
  // deliberate Enter, so the palette stays open and says which guard is on.
  {
    name: 'action-palette-unavailable',
    layout: starter,
    mutate: (doc) => {
      doc.locked = true
    },
    menu: 'app:palette',
    click: '.palette-item.disabled[data-action-id="panel:close"]',
    // The palette surviving the click is as load-bearing as the message: a
    // greyed row must not close the window it is being explained in.
    expect: {
      found: ['.palette', '.palette-reason'],
      text: ['the layout is locked']
    }
  },
  // The cursor on a greyed row. Landing on them rather than skipping them is the
  // argued-for behaviour, and End is the cheapest proof: the unavailable rows
  // sink, so the last row is one of them whenever any exist. A cursor that
  // skipped them would stop short and leave `.active` on a live row.
  //
  // Narrowed first so both kinds are in frame — which is also why this needs an
  // ordered list. The old fixed order ran every `press` before every `type`, so
  // "narrow the list, then walk it" could not be written at all.
  {
    name: 'action-palette-cursor-on-greyed',
    layout: starter,
    mutate: (doc) => {
      doc.locked = true
    },
    steps: [
      { menu: 'app:palette' },
      { type: { selector: '.palette-input', text: 'panel' } },
      { press: { key: 'End' } }
    ],
    expect: ['.palette-item.disabled.active']
  },
  // Enter on that row. `action-palette-unavailable` proves a *click* on a greyed
  // row explains itself; both routes go through one `activate()`, and this is
  // the half that says so from the keyboard.
  {
    name: 'action-palette-enter-on-greyed',
    layout: starter,
    mutate: (doc) => {
      doc.locked = true
    },
    steps: [
      { menu: 'app:palette' },
      { type: { selector: '.palette-input', text: 'panel' } },
      { press: { key: 'End' } },
      { press: { key: 'Enter' } }
    ],
    // Still open is the assertion. Enter on a greyed row running the command
    // would close it, and Enter doing nothing at all would leave no reason.
    expect: { found: ['.palette', '.palette-reason'], text: ['is unavailable'] }
  },
  // A new query drops the reason. It answers one question about one row, and a
  // message still sitting under a list the user has since retyped is worse than
  // no message — it reads as describing the results now on screen.
  //
  // The second query deliberately still matches the blocked row. Narrowing to
  // something that filters it away would pass on the lookup that resolves the
  // message against the live list, and never reach the reset that is what
  // actually runs here.
  {
    name: 'action-palette-reason-cleared',
    layout: starter,
    mutate: (doc) => {
      doc.locked = true
    },
    steps: [
      { menu: 'app:palette' },
      { type: { selector: '.palette-input', text: 'panel' } },
      { click: '.palette-item.disabled[data-action-id="panel:close"]' },
      { type: { selector: '.palette-input', text: 'close' } }
    ],
    // The row is what proves the retype landed *and* that the reason went
    // despite its subject still being listed. Without it this would pass just as
    // well on a palette that had closed.
    expect: {
      found: ['.palette-item.disabled[data-action-id="panel:close"]'],
      missing: ['.palette-reason']
    }
  },
  // Running one. Every other palette shot proves it renders; this is the only one
  // that proves it does anything, and it picks a command with no keybinding at
  // all — being the only route to those is the whole argument for having it.
  // A green frame here is the palette gone and the app in light theme.
  {
    name: 'action-palette-run',
    layout: starter,
    menu: 'app:palette',
    click: '.palette-item[data-action-id="view:toggleTheme"]',
    // The only shot proving the palette *does* anything: the command ran, so
    // the theme flipped and the palette closed behind it.
    expect: { found: ['html[data-theme="light"]'], missing: ['.palette'] }
  },

  /* ----------------------------------------------------------------- big dice */

  // Fresh from the picker: a d20, unthrown, prompting to be clicked.
  {
    name: 'bigdice',
    layout: null,
    click: '.picker-card[data-module-id="bigdice"]',
    // `.bigdice-readout` is the container and is always present; the prompt and
    // the total are the two things that swap inside it.
    expect: {
      found: ['.bigdice', '.bigdice-stage', '.bigdice-prompt'],
      missing: ['.bigdice-total']
    }
  },
  // A real click on the die, dwelt past the tumble so the shot catches a settled
  // result rather than a mid-animation frame. The value is random by nature —
  // what this proves is that the throw path works end to end.
  {
    name: 'bigdice-thrown',
    layout: null,
    click: ['.picker-card[data-module-id="bigdice"]', '.bigdice-stage'].join('\n'),
    settle: 1400,
    // The value is random; that the throw path ran at all is not. The prompt
    // going away is what says a result landed.
    expect: { found: ['.bigdice-readout'], missing: ['.bigdice-prompt'] }
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
    },
    expect: { found: ['.bigdice-flourish', '.bigdice-history', '.bigdice-past'], text: ['20'] }
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
    },
    // Percentile must still render as the two physical dice it is, rather than
    // collapsing back to one. Asserted through a child: `.bigdice-pair` is
    // `display: contents` so the dice can join the stage's flex layout, which
    // leaves the wrapper itself with no box to be visible in.
    expect: {
      found: ['.bigdice-pair .die', '.bigdice-total', '.bigdice-history'],
      text: ['100']
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
    },
    // Whether either number clips its face is eyes-only; that both dice
    // rendered with a face at all is not.
    expect: { found: ['.die-face', '.bigdice-readout'], text: ['12', '4'] }
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
    },
    // Reaching the assertion at all is most of the point — the hang this guards
    // never got as far as rendering anything.
    expect: { found: ['.empty'], missing: ['.card'] }
  },
  // Says "no data loaded" and points at the Data menu, rather than blaming the
  // panel's own settings, which have nothing to fix.
  {
    name: 'abilities-empty',
    layout: null,
    data: { refs: [], enabled: { abilities: false } },
    click: '.picker-card[data-module-id="abilities"]',
    // "Not loaded" and "hidden in this panel" both leave the list empty, and
    // pointing at the panel's own settings is actively wrong here.
    expect: { found: ['.empty'], missing: ['.card'], text: ['Data menu'] }
  },
  // Both pack behaviours in one frame: the tab bar shows "Fixture Tricks", a tab
  // the pack created, while Metamagic shows the pack's entry merged in among the
  // bundled ones rather than replacing them.
  {
    name: 'pack-loaded',
    layout: null,
    data: { refs: [{ id: 'smoke-fixture', name: 'Smoke Fixture', path: fixturePack }] },
    click: ['.picker-card[data-module-id="abilities"]', '.tabs .tab:nth-of-type(1)'].join('\n'),
    // Both pack behaviours: a tab the pack created, and the pack's entry merged
    // in among the bundled ones rather than replacing them — so Metamagic being
    // present is as load-bearing as the new tab.
    expect: { found: ['.tabs .tab', '.card'], text: ['Fixture Tricks', 'Metamagic'] }
  },
  // A pack whose file has moved. The app must still render, and say so.
  {
    name: 'pack-broken',
    layout: starter,
    data: { refs: [{ id: 'gone', name: 'Missing Pack', path: '/nonexistent/gone.dmpack.json' }] },
    click: '.topbar .btn[title="Recent layouts"]',
    // `resolve()` is total, so the app renders — and has to say so rather than
    // failing silently to a normal-looking screen.
    expect: ['.panel', '.data-status', '.data-status-warn']
  }
]

async function seedSession(name, layoutPath, mutate, data, keys) {
  const userData = userDataFor(name)
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

/**
 * A shot's `expect` is either a bare list of selectors — the common case, "these
 * must be on screen" — or an object with `found`, `missing` and `text`.
 *
 * Every shot must declare one. A shot with nothing to assert is a shot that
 * cannot fail, and this harness spent a long time full of those: an absent
 * feature photographs exactly as cleanly as a present one.
 */
function normaliseExpect(expect, name) {
  if (!expect) throw new Error(`shot "${name}" declares no expect`)
  const spec = Array.isArray(expect) ? { found: expect } : expect
  const total = (spec.found?.length ?? 0) + (spec.missing?.length ?? 0) + (spec.text?.length ?? 0)
  if (!total) throw new Error(`shot "${name}" declares an empty expect`)
  return spec
}

/** The actions a step may carry. Exactly one, which is what makes it ordered. */
const STEP_KINDS = ['menu', 'click', 'press', 'type', 'hover', 'wait']

/**
 * What a shot does before its screenshot, as one ordered list.
 *
 * Most shots want one menu command, or a run of clicks, and say so with the
 * shorthand fields — `menu`, `click`, `press`, `type`, `hover` — which are sugar
 * for one step each in that fixed order. A shot needing two of a kind, or needing
 * them interleaved, declares `steps` instead.
 *
 * **The shorthand is desugared here, not executed separately.** There is one
 * executor in `src/main/index.ts` and one thing for it to read, so the two
 * spellings cannot come to mean different things — the fixed order is a default,
 * not a second mechanism.
 *
 * Declaring both is refused rather than merged: a shot that says `steps` has an
 * order in mind, and quietly prepending a shorthand field to it would put a
 * click somewhere the author did not write.
 */
function normaliseSteps(shot, name) {
  const shorthand = STEP_KINDS.filter((kind) => kind !== 'wait' && shot[kind] !== undefined)

  if (shot.steps) {
    if (!Array.isArray(shot.steps) || shot.steps.length === 0) {
      throw new Error(`shot "${name}" declares an empty steps list`)
    }
    if (shorthand.length) {
      throw new Error(`shot "${name}" declares steps and also ${shorthand.join(', ')}`)
    }
    for (const [index, step] of shot.steps.entries()) {
      const set = STEP_KINDS.filter((kind) => step[kind] !== undefined)
      const unknown = Object.keys(step).filter((key) => !STEP_KINDS.includes(key))
      if (unknown.length) {
        throw new Error(
          `shot "${name}" step ${index + 1} has no such action: ${unknown.join(', ')}`
        )
      }
      if (set.length !== 1) {
        throw new Error(
          `shot "${name}" step ${index + 1} sets ${set.length} actions, expected exactly 1`
        )
      }
    }
    return shot.steps
  }

  return [
    ...(shot.menu ? [{ menu: shot.menu }] : []),
    // Newline-separated, which predates `steps` and stays: a run of clicks is
    // the commonest sequence there is, and one string reads better than five
    // objects.
    ...(shot.click ?? '')
      .split('\n')
      .map((selector) => selector.trim())
      .filter(Boolean)
      .map((click) => ({ click })),
    ...(shot.press ? [{ press: shot.press }] : []),
    ...(shot.type ? [{ type: shot.type }] : []),
    ...(shot.hover ? [{ hover: shot.hover }] : [])
  ]
}

const SHOT_TIMEOUT_MS = 60_000

/**
 * Every child still running, so an interrupted run does not strand them.
 *
 * `detached` puts each shot in its own process group, which is what makes the
 * timeout path able to take Xvfb down with Electron — but it also stops Ctrl-C
 * reaching them, so the group has to be killed deliberately here too.
 */
const live = new Set()

function killTree(child) {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // Already gone, or never got a group of its own. Either way the direct kill
    // is the whole remaining obligation.
    child.kill('SIGKILL')
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of live) killTree(child)
    process.exit(1)
  })
}

/**
 * The X display a worker slot uses, as a starting point rather than a fixture.
 *
 * `xvfb-run -a` finds a free display by scanning for `/tmp/.X<n>-lock` and then
 * starting a server on the first gap — a check and a claim with no lock between
 * them, so two shots starting together both see the same gap and one of their
 * servers dies. Handing each slot its own base makes the scans disjoint, which
 * removes the race rather than narrowing its window, and keeping `-a` leaves
 * each slot able to step over a display some earlier crash left locked.
 *
 * The stride only has to exceed the number of displays one slot could ever burn
 * through in a run.
 */
const DISPLAY_BASE = 99
const DISPLAY_STRIDE = 10

function run(shotPath, shot, name, slot) {
  // Before the spawn, so a malformed shot fails on its own terms rather than as
  // a mystery inside a 60-second Electron launch.
  const expectations = JSON.stringify(normaliseExpect(shot.expect, name))
  const steps = JSON.stringify(normaliseSteps(shot, name))
  const { settle } = shot

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'xvfb-run',
      [
        '-a',
        '-n',
        String(DISPLAY_BASE + slot * DISPLAY_STRIDE),
        '--server-args=-screen 0 1600x1000x24',
        'node_modules/.bin/electron',
        '--no-sandbox',
        // Chromium puts its renderer's shared memory in /dev/shm, which Docker
        // gives a container 64 MB of. One Electron fits; four do not, and the
        // one that finds it full dies as `render process gone: crashed` —
        // naming neither shared memory nor the neighbour that took it. This
        // moves that allocation to /tmp instead of asking every caller to pass
        // --shm-size, so the suite does not depend on how its container was
        // started. It cost nothing measurable: /tmp here is the container's own
        // layer, not a bind mount.
        '--disable-dev-shm-usage',
        '.'
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: join(configRoot, name),
          DMSCREEN_SMOKE_SHOT: shotPath,
          DMSCREEN_SMOKE_STEPS: steps,
          ...(settle ? { DMSCREEN_SMOKE_SETTLE: String(settle) } : {}),
          DMSCREEN_SMOKE_EXPECT: expectations,
          ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      }
    )
    live.add(child)

    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))

    const timer = setTimeout(() => {
      // The group, not the child. Killing xvfb-run alone orphans the Xvfb and
      // the Electron under it, and a hung shot's leftovers would go on competing
      // for the cores every later shot in the run needs — one timeout would read
      // as a suite-wide collapse.
      killTree(child)
      reject(new Error(`Timed out.\n${output}`))
    }, SHOT_TIMEOUT_MS)

    child.on('exit', (code) => {
      clearTimeout(timer)
      live.delete(child)
      if (code !== 0) return reject(new Error(`Electron exited with ${code}.\n${output}`))
      resolvePromise(output)
    })
  })
}

/**
 * One shot, start to verdict. Returns the failure text, or null for a pass.
 *
 * Nothing here touches state another shot can see: the seed goes to this shot's
 * own userData and the capture to its own file, which is what lets the pool
 * below run several at once.
 */
async function runShot(shot, slot) {
  const shotPath = join(outDir, `${shot.name}.png`)
  await rm(shotPath, { force: true })
  await seedSession(shot.name, shot.layout, shot.mutate, shot.data, shot.keys)

  try {
    const output = await run(shotPath, shot, shot.name, slot)

    if (!existsSync(shotPath)) return `no screenshot written.\n${output}`

    // The renderer forwards console errors to stdout via the main process.
    const problems = output
      .split('\n')
      .filter((line) => /\[renderer:(error)\]|Uncaught|ERR_FILE_NOT_FOUND/.test(line))
    if (problems.length) return `renderer reported problems:\n${problems.join('\n')}`

    // The shot rendered without complaint but is not showing what it claims to.
    // Still written to disk — look at it.
    const unmet = output.split('\n').filter((line) => line.includes('[smoke:expect]'))
    if (unmet.length) return `not showing what it claims:\n${unmet.join('\n')}`

    return null
  } catch (error) {
    return String(error.message ?? error)
  }
}

/**
 * How many shots run at once.
 *
 * A shot is one Electron and one Xvfb that spend nearly all of their life
 * asleep — a startup burst, then dwell — so what bounds this is how many cold
 * starts can overlap, not anything steady-state. Four is what the CI runner has,
 * and the runner is the machine that has to stay honest; a bigger box gains
 * little, because past this the suite is waiting on dwells no amount of parallel
 * makes shorter.
 *
 * Overridable for bisecting a suspected load-related failure: SMOKE_CONCURRENCY=1
 * is the old sequential behaviour exactly.
 */
function resolveConcurrency() {
  const override = Number(process.env['SMOKE_CONCURRENCY'])
  if (Number.isInteger(override) && override > 0) return Math.min(override, shots.length)
  return Math.max(1, Math.min(4, cpus().length, shots.length))
}

// Stale userData from an earlier run, including any shot since renamed. Once,
// here, rather than per shot: a worker clearing this mid-run would be deleting
// directories its neighbours are using.
await rm(configRoot, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const concurrency = resolveConcurrency()
console.log(`Running ${shots.length} shots, ${concurrency} at a time.\n`)

const failures = new Map()
let nextShot = 0

/**
 * A worker takes the next unclaimed shot until there are none left, so a slow
 * shot costs its own slot and not the ones beside it.
 *
 * The slot number is the worker's identity for the whole run, which is what the
 * X display base is drawn from.
 */
async function worker(slot) {
  for (;;) {
    const index = nextShot++
    if (index >= shots.length) return
    const shot = shots[index]

    const failure = await runShot(shot, slot)
    if (failure) failures.set(shot.name, failure)
    // One write per line, so lines from different workers cannot interleave.
    // Completion order, not declaration order — the summary below restores that.
    console.log(`${failure ? '✗' : '▸'} ${shot.name}${failure ? ' FAILED' : ''}`)
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, slot) => worker(slot)))

// Reported at the end and in declaration order: with the run interleaved, a
// failure printed where it happened would be somewhere in the middle of the
// output, under whichever other shots happened to finish alongside it.
if (failures.size) {
  console.error(`\n${failures.size} of ${shots.length} shots failed:\n`)
  for (const shot of shots) {
    const failure = failures.get(shot.name)
    if (failure) console.error(`✗ ${shot.name}: ${failure}\n`)
  }
} else {
  console.log(`\nAll ${shots.length} shots passed → ${outDir}`)
}

// Set rather than `process.exit()`, which does not wait for a piped stdout to
// drain — and CI pipes it. The summary above is the last thing written and would
// be the first thing truncated, which is the one line a red run is read for.
// Dropping the signal handlers is what then lets the process end on its own.
process.exitCode = failures.size ? 1 : 0
process.removeAllListeners('SIGINT')
process.removeAllListeners('SIGTERM')

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
/**
 * A map for the Image module. Absolute, because that is what the module stores
 * and what main registers — and it is resolved here, in the driver, since
 * `mutate` runs before the child is spawned.
 */
const fixtureMap = join(root, 'examples', 'smoke-map.png')
/** Named like an image, and not one. The half a path check cannot see. */
const fixtureBrokenMap = join(root, 'examples', 'smoke-broken.png')

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
    // The header giving up its grip belongs here too: the lock freezes the
    // arrangement, and dragging a panel onto another rearranges it.
    expect: {
      found: [
        '.menu',
        '.lock-icon',
        '.menu-item.disabled.danger',
        '.panel-head[draggable="false"]'
      ],
      missing: ['.splitter-grip']
    }
  },
  // Dragging one panel onto another to swap them. The starter is initiative on
  // the left, party top-right; after the drop they have changed places, which is
  // what both halves of the assertion say — one alone would also pass on a
  // module that had been duplicated rather than swapped.
  {
    name: 'panel-drag-swap',
    layout: starter,
    drag: { from: '.panel:has(.round-pill) .panel-head', to: '.panel:has(.table.resizable)' },
    expect: [
      '.split.row > .pane:first-child .table.resizable',
      '.split.column > .pane:first-child .round-pill'
    ]
  },
  // The same drag, stopped between `dragover` and `drop`, which is the only
  // moment the indicator exists. Both ends are on screen at once: the panel
  // being carried dims, the one under the pointer takes the ring.
  {
    name: 'panel-drag-over',
    layout: starter,
    drag: {
      from: '.panel:has(.round-pill) .panel-head',
      to: '.panel:has(.table.resizable)',
      hold: true
    },
    expect: ['.panel.dragging:has(.round-pill)', '.panel.drop-target:has(.table.resizable)']
  },
  // The keyboard half, twice over: right, then down. The second press is the
  // point — the selection follows the module it moved, so a repeated key carries
  // one panel across the screen instead of swapping the same pair back.
  {
    name: 'panel-swap-keys',
    layout: starter,
    steps: [{ menu: 'panel:swapRight' }, { menu: 'panel:swapDown' }],
    expect: [
      '.split.row > .pane:first-child .table.resizable',
      '.split.column > .pane:last-child .round-pill'
    ]
  },
  // Resizing from the keyboard. The starter's left pane is seeded at 0.56 and
  // each press moves a twentieth, so two of them put it past 0.6 — asserted as a
  // prefix of the inline weight, since the exact digits are a renormalised
  // float. The seeded value going is the other half: without it a pane that
  // never moved would match nothing and say nothing.
  {
    name: 'panel-resize-keys',
    layout: starter,
    steps: [{ menu: 'panel:wider' }, { menu: 'panel:wider' }],
    expect: {
      found: ['.split.row > .pane:first-child[style*="flex-grow: 0.6"]'],
      missing: ['.split.row > .pane:first-child[style*="flex-grow: 0.56"]']
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
  // The preset list.
  {
    name: 'shortcuts-presets',
    layout: starter,
    menu: 'app:shortcuts',
    // Named, so a preset going missing fails here rather than looking like a
    // slightly shorter list.
    expect: {
      found: ['.preset-row', '.preset'],
      text: [
        'Default',
        'VS Code',
        'Cursor',
        'Zed',
        'Sublime Text',
        'JetBrains',
        'Vim',
        'tmux',
        'None'
      ]
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
  // A keymap that wants a key one of Electron's own roles holds. Reload ships on
  // Ctrl+R, which nothing in the catalogue knows about, so the menu has to hand
  // the stroke over instead of registering it twice. Also the shot that catches
  // the row it builds by hand being malformed — `buildFromTemplate` throws on
  // one, and a throw there is an app with no menu, so no way back to the editor.
  {
    name: 'shortcuts-role-stroke',
    layout: starter,
    keys: { 'layout:save': 'CmdOrCtrl+R' },
    menu: 'app:shortcuts',
    expect: {
      found: ['.shortcuts-modal', '.shortcut-row'],
      text: ['Ctrl+R']
    }
  },
  // A preset applied through its own button rather than by seeding the bindings
  // it is supposed to produce — the shot that covers the preset list actually
  // being wired to the keymap, which seeding a keybindings.json cannot show.
  {
    name: 'shortcuts-preset-applied',
    layout: starter,
    steps: [{ menu: 'app:shortcuts' }, { click: '.preset[data-preset-id="vscode"]' }],
    expect: {
      found: ['.shortcuts-modal', '.shortcut-row'],
      // Ctrl+S is still Save, alongside a sequence that ends on it.
      text: ['Ctrl+K Ctrl+\\', 'Ctrl+K Ctrl+S', 'Ctrl+S']
    }
  },
  // The Cursor preset applied through its button — the shot that would catch the
  // two forks collapsing into one keymap (Cursor's leader is Ctrl+M where VS
  // Code's is Ctrl+K), and that the platform picked its arm: this harness runs
  // on Linux, so what shows here must come from the Ctrl+M arm, not the darwin
  // one. The darwin arm itself is pinned by unit tests, since no shot runs on a
  // Mac.
  {
    name: 'shortcuts-cursor',
    layout: starter,
    steps: [{ menu: 'app:shortcuts' }, { click: '.preset[data-preset-id="cursor"]' }],
    expect: {
      found: ['.shortcuts-modal', '.shortcut-row'],
      // Ctrl+S is still Save, alongside a sequence that ends on it.
      text: ['Ctrl+M Ctrl+\\', 'Ctrl+M Ctrl+S', 'Ctrl+S']
    }
  },
  // The Zed preset applied through its button. Shift+Escape on Fullscreen Panel
  // is the row that could not exist before Escape joined the keys that bind
  // without a real modifier — and rendering it is also proof the accelerator
  // survives the menu build, which throws on one it cannot register.
  {
    name: 'shortcuts-zed',
    layout: starter,
    steps: [{ menu: 'app:shortcuts' }, { click: '.preset[data-preset-id="zed"]' }],
    expect: {
      found: ['.shortcuts-modal', '.shortcut-row'],
      text: ['Ctrl+K Down', 'Ctrl+K Ctrl+S', 'Shift+Escape']
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
  // A one-panel layout, where every swap and every resize is off for a reason
  // that names the missing side rather than saying "not now". The row is clicked
  // by id rather than reached with Enter: the greyed rows sink and then sort by
  // name, so the cursor's first row is "above" and the reason would be too.
  {
    name: 'action-palette-no-neighbour',
    layout: null,
    steps: [
      { menu: 'app:palette' },
      { type: { selector: '.palette-input', text: 'swap' } },
      { click: '.palette-item.disabled[data-action-id="panel:swapLeft"]' }
    ],
    expect: {
      found: ['.palette-item.disabled[data-action-id="panel:swapLeft"]', '.palette-reason'],
      text: ['there is no panel to the left']
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
  },
  // The Table module straight from the picker: header row and shading are both
  // on by default, so this is also the shot that says the defaults arrived.
  {
    name: 'table-module',
    layout: null,
    click: '.picker-card[data-module-id="table"]',
    expect: ['.data-table.shaded', '.data-table thead', '.data-table .th-input']
  },
  // Formatting rendered in cells. The markers must be gone from the visible
  // text while the state still holds them — `missing` on `.mk-mark` is what
  // separates "renders bold" from "renders bold and leaves the stars behind",
  // which look identical in a screenshot of a wide-enough column.
  {
    name: 'table-markup',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'table'
      doc.panels.panel_ref.state = {
        columns: [
          { id: 'col_a', label: 'Name', width: 160, align: 'left' },
          { id: 'col_b', label: 'Owed', width: 110, align: 'right' }
        ],
        rows: [
          { id: 'row_1', cells: { col_a: '**Sera Voll**', col_b: '*120 gp*' } },
          { id: 'row_2', cells: { col_a: 'Brother Anselm', col_b: '0 gp' } }
        ]
      }
    },
    expect: {
      found: ['.data-table', '.cell-markup.rich .cell-render .mk-b', '.cell-render .mk-i'],
      // A cell drops its markers; only the Notes mirror keeps them.
      missing: ['.cell-render .mk-mark'],
      text: ['Sera Voll', '120 gp']
    }
  },
  // Header row off. The thead goes entirely rather than emptying, so the first
  // data row is against the top of the panel.
  {
    name: 'table-no-header',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'table'
      doc.panels.panel_ref.settings = { headerRow: false, shadedRows: false, compact: false }
    },
    expect: { found: ['.data-table', '.data-table tbody'], missing: ['.data-table thead'] }
  },
  // Column config in the settings drawer, which is the only route to renaming or
  // realigning a column once the header row is off. Fullscreened first so the
  // drawer has room, the same way `party-settings` does it.
  {
    name: 'table-settings',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'table'
      doc.panels.panel_ref.settings = { headerRow: false, shadedRows: true, compact: false }
    },
    click: [
      '.panel:has(.data-table) .icon-btn[title^="Fullscreen"]',
      '.panel:has(.data-table) .icon-btn[title="Panel settings"]'
    ].join('\n'),
    expect: {
      found: ['.panel-settings', '.panel-settings .field-row .input'],
      text: ['Header row', 'Shade alternate rows', 'Columns']
    }
  },
  // The Notes mirror with the caret in it. Both halves have to be visible at
  // once: `.mk-b` says the overlay rendered, `.mk-mark` says the markers are
  // there holding their width — drop them while focused and every later
  // character on the line slides out from under the caret. The click is what
  // makes this the focused case; `notes-markup-blurred` is the other one.
  {
    name: 'notes-markup',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'notes'
      doc.panels.panel_ref.state = {
        text: 'The **duke** is *lying* about the crypt.\nAsk **Sera** what she saw.'
      }
    },
    click: '.markup-input',
    expect: {
      found: ['.markup-editor', '.markup-mirror .mk-b', '.markup-mirror .mk-i', '.mk-mark'],
      text: ['duke', 'lying']
    }
  },
  // Ctrl+B over a selection, driven through the real textarea rather than seeded.
  // This is the only shot that exercises `useMarkupKeys` — the selection restore
  // in particular, which nothing else would catch until a DM lost their caret
  // mid-sentence. `press` dispatches at the focused element, so the React
  // onKeyDown on the textarea is on the path.
  {
    name: 'notes-bold-key',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'notes'
      doc.panels.panel_ref.state = { text: 'the duke lies' }
    },
    steps: [
      // "duke" is characters 4 to 8 of "the duke lies".
      { select: { selector: '.markup-input', start: 4, end: 8 } },
      { press: { code: 'KeyB', key: 'b', ctrlKey: true } }
    ],
    // Only the selected word goes bold, so the mirror shows a bold run with
    // plain text either side of it — and the markers it gained.
    expect: { found: ['.markup-mirror .mk-b', '.markup-mirror .mk-mark'], text: ['duke', 'lies'] }
  },
  // Notes with nothing focused. The markers go, the formatting stays: the mirror
  // only owes the caret a matching character count while there *is* a caret in
  // it. `missing` on `.mk-mark` is the whole assertion — `notes-markup` above is
  // the same note focused, and the pair is what pins the difference.
  {
    name: 'notes-markup-blurred',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'notes'
      doc.panels.panel_ref.state = { text: 'The **duke** is *lying* about the crypt.' }
    },
    expect: {
      found: ['.markup-mirror .mk-b', '.markup-mirror .mk-i'],
      missing: ['.mk-mark'],
      text: ['duke', 'lying']
    }
  },
  // Tab out of the last cell of the last row. The table has to grow — a key that
  // does nothing at the one place a table is always extended from reads as
  // broken — and the caret has to land in the row that did not exist when the
  // key was pressed, which is the whole reason focus goes through a ref.
  {
    name: 'table-tab-grows',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'table'
      doc.panels.panel_ref.state = {
        columns: [
          { id: 'col_a', label: 'Name', width: 140, align: 'left' },
          { id: 'col_b', label: 'Value', width: 110, align: 'left' }
        ],
        rows: [{ id: 'row_1', cells: { col_a: 'only', col_b: 'row' } }]
      }
    },
    steps: [{ click: '[data-cell="0:1"]' }, { press: { code: 'Tab', key: 'Tab' } }],
    // Row 1 exists and is focused. Asserting on the focus is what separates
    // "grew a row" from "grew a row and lost the caret".
    expect: ['[data-cell="1:0"]', '[data-cell="1:0"]:focus']
  },
  // Enter steps down a column rather than off the end of the row.
  {
    name: 'table-enter-steps-down',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'table'
      doc.panels.panel_ref.state = {
        columns: [
          { id: 'col_a', label: 'Name', width: 140, align: 'left' },
          { id: 'col_b', label: 'Value', width: 110, align: 'left' }
        ],
        rows: [
          { id: 'row_1', cells: { col_a: 'first' } },
          { id: 'row_2', cells: { col_a: 'second' } }
        ]
      }
    },
    steps: [{ click: '[data-cell="0:0"]' }, { press: { code: 'Enter', key: 'Enter' } }],
    // Same column, next row — not the next cell across, which is Tab's job.
    expect: ['[data-cell="1:0"]:focus']
  },
  // The selection tint over a shaded row. Shading and the highlight used to be
  // the same property, so the shaded rule simply won and every even row looked
  // unselected. Seeded as a block across both rows: one shaded, one not, in one
  // frame, which is the only way the fix is eyes-checkable.
  {
    name: 'table-selection-shaded',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'table'
      doc.panels.panel_ref.settings = { headerRow: true, shadedRows: true, compact: false }
      doc.panels.panel_ref.state = {
        columns: [
          { id: 'col_a', label: 'Name', width: 140, align: 'left' },
          { id: 'col_b', label: 'Value', width: 110, align: 'left' }
        ],
        rows: [
          { id: 'row_1', cells: { col_a: 'first', col_b: '1' } },
          { id: 'row_2', cells: { col_a: 'second', col_b: '2' } }
        ]
      }
    },
    // Shift+ArrowDown from row 0 puts a two-cell block across both rows, so one
    // picked cell is shaded and one is not — which is the comparison.
    steps: [
      { click: '[data-cell="0:0"]' },
      { press: { code: 'ArrowDown', key: 'ArrowDown', shiftKey: true } }
    ],
    expect: [
      '.data-table.shaded',
      '.data-table tbody tr:nth-child(1) td.cell-picked',
      '.data-table tbody tr:nth-child(2) td.cell-picked'
    ]
  },
  // The Image module with nothing chosen. The file dialog is native and out of
  // the harness's reach, so this is as far as clicking gets — every shot below
  // seeds the path instead.
  {
    name: 'image-empty',
    layout: null,
    click: '.picker-card[data-module-id="image"]',
    expect: { found: ['.image-drop', '.image-drop .btn.primary'], text: ['Drop an image here'] }
  },
  // The whole delivery path, end to end: main registers the seeded path, serves
  // it over `dmscreen-image://`, and Chromium decodes it. `data-loaded` is what
  // makes that an assertion rather than a hope — the `<img>` is laid out at
  // panel size whether or not a single byte arrived, so asserting on the
  // element would pass against a handler that only ever returned 404. A CSP
  // that refused the scheme would fail this shot on the console error as well.
  {
    name: 'image-fitted',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'image'
      doc.panels.panel_ref.state = { path: fixtureMap, scale: 1, offsetX: 0, offsetY: 0 }
    },
    expect: {
      found: ['.image-viewport[data-loaded]', '.image-canvas'],
      missing: ['.image-viewport.zoomed'],
      text: ['100%']
    }
  },
  // Zoom and pan restored from panel state, which is the half a reload has to
  // get right. Fullscreened so the map has room to be visibly off-centre —
  // scale 2 in a small panel clamps the pan back to nearly nothing, and the
  // shot would then look identical to the fitted one.
  {
    name: 'image-zoomed',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'image'
      doc.panels.panel_ref.state = { path: fixtureMap, scale: 2.5, offsetX: 120, offsetY: -40 }
    },
    click: '.panel:has(.image-viewport) .icon-btn[title^="Fullscreen"]',
    expect: {
      found: ['.image-viewport.zoomed[data-loaded]', '.image-canvas'],
      text: ['250%']
    }
  },
  // Zoom driven through the wheel, which is the path the buttons do not cover:
  // the listener has to be the element's own and non-passive, and the zoom is
  // aimed at the pointer rather than at the centre. Off-centre by 150px, so the
  // map moves under the cursor rather than merely getting bigger — from the
  // middle an aimed zoom and a centred one are the same picture.
  //
  // Fullscreened first for the room, and the assertion is the readout: it is
  // rendered from the same clamped view the transform is, so a number on screen
  // says the wheel reached `apply` and came back inside its limits.
  {
    name: 'image-wheel-zoom',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'image'
      doc.panels.panel_ref.state = { path: fixtureMap, scale: 1, offsetX: 0, offsetY: 0 }
    },
    steps: [
      { click: '.panel:has(.image-viewport) .icon-btn[title^="Fullscreen"]' },
      { wheel: { selector: '.image-viewport', deltaY: -600, offsetX: 150, offsetY: 0 } }
    ],
    expect: {
      found: ['.image-viewport.zoomed[data-loaded]'],
      // 1.0015 ** 600, rounded. A fixed number rather than "not 100%", so a
      // change to the wheel step has to be deliberate.
      text: ['246%']
    }
  },
  // A layout whose image has moved, which is the cost of storing a path and the
  // one state that has to explain itself. The path is on screen because it is
  // the whole of what the DM needs to find the file again.
  {
    name: 'image-missing',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'image'
      doc.panels.panel_ref.state = {
        path: '/maps/no-such-keep.png',
        scale: 1,
        offsetX: 0,
        offsetY: 0
      }
    },
    expect: {
      found: ['.image-missing', '.image-drop .note.mono'],
      missing: ['.image-viewport'],
      text: ['/maps/no-such-keep.png', 'Locate']
    }
  },
  // The file is there and Chromium still will not decode it. Reached through
  // `onError`, which is the only signal for it — main serves the bytes happily,
  // so nothing before the decode knows anything is wrong. Distinguished from
  // the shot above because "go and find it" is the wrong instruction here.
  {
    name: 'image-unreadable',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'image'
      doc.panels.panel_ref.state = { path: fixtureBrokenMap, scale: 1, offsetX: 0, offsetY: 0 }
    },
    expect: {
      found: ['.image-missing'],
      missing: ['.image-viewport'],
      text: ['could not be read', 'Choose another']
    }
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
const STEP_KINDS = ['menu', 'click', 'press', 'type', 'select', 'wheel', 'drag', 'hover', 'wait']

/**
 * What a shot does before its screenshot, as one ordered list.
 *
 * Most shots want one menu command, or a run of clicks, and say so with the
 * shorthand fields — `menu`, `click`, `press`, `type`, `select`, `wheel`,
 * `drag`, `hover` — which are sugar for one step each in that fixed order. A
 * shot needing two of a kind, or needing them interleaved, declares `steps`
 * instead.
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
    ...(shot.select ? [{ select: shot.select }] : []),
    ...(shot.wheel ? [{ wheel: shot.wheel }] : []),
    ...(shot.drag ? [{ drag: shot.drag }] : []),
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

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
/**
 * Two windows, and the only version 2 layout in the repo — every other shot
 * seeds `starter.dmscreen`, which is version 1 and therefore exercises the
 * migration instead. Initiative sits on one screen and the party panel it reads
 * from on the other, which is the cross-window case.
 */
const twoScreens = join(root, 'examples', 'two-screens.dmscreen')
/**
 * The rest live in `scripts/fixtures/` rather than beside the layouts above.
 * `examples/` is documentation a user is pointed at, and a deliberately broken
 * PNG is an example of nothing — while a layout there is one whether or not the
 * harness also seeds it.
 */
const fixturePack = join(root, 'scripts', 'fixtures', 'pack.dmpack.json')
/**
 * A map for the Image module. Absolute, because that is what the module stores
 * and what main registers — and it is resolved here, in the driver, since
 * `mutate` runs before the child is spawned.
 */
const fixtureMap = join(root, 'scripts', 'fixtures', 'map.png')
/** Named like an image, and not one. The half a path check cannot see. */
const fixtureBrokenMap = join(root, 'scripts', 'fixtures', 'broken.png')

/**
 * A note long enough for the Notes mirror to drift out from under its caret.
 *
 * The bug it pins was a per-line error of a couple of pixels, so a one-line note
 * showed nothing and every notes shot here was one. Numbered lines are what make
 * a screenshot of it readable — the selection is the textarea's and the text is
 * the mirror's, so a drift shows up as a highlight sitting on the wrong number.
 * The long lines are there to make each highlight wide enough to see.
 */
const driftingNote = Array.from({ length: 16 }, (_, index) => {
  const line = `Line ${index + 1}`
  return index % 5 === 4 ? `${line} — long, so the highlight on it is easy to see.` : line
}).join('\n')

/**
 * One paragraph, no newlines, wider and taller than the panel.
 *
 * The other half of the same disagreement: with no gutter reserved, the textarea
 * scrolls and loses 10px to the bar while the mirror keeps them, and the two
 * wrap in different places from the first overflowing line on.
 */
const wrappingNote = 'A long unbroken sentence that has to wrap inside the panel. '.repeat(24)

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
  /*
   * The two halves of the unsaved flag, which the document living in main is
   * the whole of this change to.
   *
   * They are a pair on purpose. `missing: ['.dirty-dot']` below would pass just
   * as happily against a lock command that never marked anything unsaved, so
   * this shot is what pins that the same single step does put the dot on screen.
   * Read alone, either one proves nothing.
   */
  {
    name: 'layout-dirty',
    layout: starter,
    menu: 'layout:toggleLock',
    expect: {
      found: ['.dirty-dot', '.topbar .icon-btn.on[title^="Layout locked"]']
    }
  },
  // And back off again, through the path that now runs entirely in main: the
  // renderer asks, main writes the file it already holds, clears the flag and
  // says so. The lock staying on is what says the document that reached the
  // disk is the edited one rather than the copy main started with.
  {
    name: 'layout-save',
    layout: starter,
    writable: true,
    steps: [{ menu: 'layout:toggleLock' }, { menu: 'layout:save' }, { wait: 600 }],
    expect: {
      found: ['.topbar .icon-btn.on[title^="Layout locked"]'],
      missing: ['.dirty-dot']
    }
  },

  /* ------------------------------------------------------------- windows */

  // One window, and still a dropdown. It used to be a bare "+ Add Window"
  // button until a second screen existed, which made the control change what
  // kind of control it was — so this pins that it does not.
  {
    name: 'windows-menu-alone',
    layout: starter,
    click: '.windows-btn[data-windows="menu"]',
    expect: {
      found: ['.windows-menu', '.window-row', '.windows-menu [data-windows="add"]'],
      text: ['Main window', '+ New Window']
    }
  },
  // Adding one from the bottom of that list.
  {
    name: 'windows-added',
    layout: starter,
    steps: [
      { click: '.windows-btn[data-windows="menu"]' },
      { click: '.windows-menu [data-windows="add"]' },
      { wait: 900 },
      { click: '.windows-btn[data-windows="menu"]' }
    ],
    expect: {
      found: ['.window-row.current', '.windows-menu'],
      text: ['Main window', 'Window 2']
    }
  },
  // The list on a two-screen layout: both rows, the current one marked, and the
  // per-row controls that rename and delete.
  {
    name: 'windows-menu',
    layout: twoScreens,
    click: '.windows-btn[data-windows="menu"]',
    expect: {
      found: [
        '.windows-menu',
        '.window-row.current[data-window-id="win_main"]',
        '.window-row[data-window-id="win_player"]',
        '.window-row[data-window-id="win_player"] .window-remove',
        '.window-row[data-window-id="win_main"] .window-rename'
      ],
      // The primary keeps no bin: a layout has to have one window, and closing
      // that one is quitting rather than deleting.
      missing: ['.window-row[data-window-id="win_main"] .window-remove'],
      text: ['Main window', 'Player screen', '+ New Window']
    }
  },
  // Renaming, which was unreachable while the name carried a double-click: its
  // first click closed the menu, so the second never landed.
  {
    name: 'windows-rename',
    layout: twoScreens,
    steps: [
      { click: '.windows-btn[data-windows="menu"]' },
      { click: '.window-row[data-window-id="win_player"] .window-rename' }
    ],
    expect: {
      found: ['.window-row[data-window-id="win_player"] .window-name-input'],
      missing: ['.window-row[data-window-id="win_player"] .window-name']
    }
  },
  // The bin, which deletes outright and does not ask.
  {
    name: 'windows-deleted',
    layout: twoScreens,
    steps: [
      { click: '.windows-btn[data-windows="menu"]' },
      { click: '.window-row[data-window-id="win_player"] .window-remove' },
      { wait: 900 }
    ],
    expect: {
      found: ['.windows-btn[data-windows="menu"]'],
      missing: ['.window-row[data-window-id="win_player"]']
    }
  },
  // The second screen, photographed. Its bar carries the switcher and nothing
  // else — no New, Open, Save or Save As, which is the point of a window the
  // players can see.
  {
    name: 'windows-secondary',
    layout: twoScreens,
    window: 2,
    expect: {
      found: [
        '.topbar.secondary',
        '.window-label[data-window-id="win_player"]',
        '.table.resizable'
      ],
      missing: ['.topbar-actions', '.layout-name'],
      text: ['Player screen']
    }
  },
  // The secondary window's own name is a rename field, not a label. Reaching it
  // only through the switcher made the name beside it look like decoration.
  {
    name: 'windows-secondary-rename',
    layout: twoScreens,
    window: 2,
    click: '.window-label',
    expect: {
      found: ['.window-label-input'],
      missing: ['.window-label']
    }
  },
  // The switcher is on the secondary window too, and knows which screen it is
  // on — the row for this window is the one marked current.
  {
    name: 'windows-secondary-menu',
    layout: twoScreens,
    window: 2,
    click: '.windows-btn[data-windows="menu"]',
    expect: {
      found: ['.window-row.current[data-window-id="win_player"]'],
      text: ['Main window', 'Player screen']
    }
  },
  // A window closed rather than deleted keeps its panels and its row. Seeded,
  // because closing is what the window's own frame does and a native title bar
  // is out of the harness's reach.
  {
    name: 'windows-closed-listed',
    layout: twoScreens,
    mutate: (doc) => {
      doc.windows[1].open = false
    },
    click: '.windows-btn[data-windows="menu"]',
    expect: {
      found: ['.window-row.closed[data-window-id="win_player"]', '.menu-heading'],
      // "CLOSED", not "Closed": the heading is uppercased in CSS, and the text
      // check reads `innerText`, which reports the text as rendered.
      text: ['CLOSED', 'Player screen']
    }
  },
  /*
   * Dragging a panel from one screen onto the other, which is most of what a
   * second screen is for.
   *
   * The two halves run in their own windows, and the payload is left empty —
   * a DataTransfer belongs to the renderer that made it and cannot be handed to
   * a second one. That is the same reason the app records the drag in main at
   * `dragstart` rather than trusting the payload to cross, so this drives the
   * path a real cross-window drop actually takes.
   *
   * The party panel starts on the players' screen and the initiative tracker on
   * the main one; after the drop they have traded places, which is what the two
   * assertions say.
   */
  {
    name: 'windows-drag-across',
    layout: twoScreens,
    steps: [
      {
        drag: {
          fromWindow: 2,
          from: '.panel:has(.table.resizable) .panel-head',
          to: '.panel:has(.round-pill)'
        }
      },
      { wait: 900 }
    ],
    expect: {
      // The main window now shows the party panel where initiative was.
      found: ['.panel:has(.table.resizable)'],
      missing: ['.panel:has(.round-pill)']
    }
  },
  /*
   * The cross-window link. Initiative is on the main screen and the party panel
   * it reads AC and HP from is on the other, so this shot fails if a window only
   * ever sees its own panels.
   */
  {
    name: 'windows-party-link',
    layout: twoScreens,
    expect: {
      // The badge is rendered only for a combatant whose linked party panel was
      // actually found, so it is the assertion: a window that could see nothing
      // but its own panels would draw the row without it.
      //
      // Not a `text` check on the numbers. Those live in inputs, and the
      // harness reads `document.body.innerText`, which does not include the
      // value of a form control.
      found: ['.combatant.pc .link-badge']
    }
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
  /*
   * A countdown that has run out. Seeded rather than waited for: a `startedAt` of
   * 1 is the epoch, so an enormous elapsed time against a one-minute duration
   * lands in the same state as a fuse that burned down while you watched, and
   * costs the suite no dwell at all.
   *
   * That works because the shot declares no `savedAt`. The restore only stops a
   * running timer when the session says when the app was last alive, and without
   * one it leaves the clocks alone — which is the whole reason this shot still
   * reaches the finished state at all. Seeding a stamp here, or stamping one for
   * every shot, would quietly turn both of these into something else.
   *
   * The button is the whole point. Pause on a clock that has stopped moving does
   * nothing you can see, and it used to strand the timer: finished and paused
   * disabled Start, so the only way back was the arrow in the header. `text`
   * pins Reset, and `missing` pins the loose "Time." that used to sit beside it.
   */
  {
    name: 'timer-finished',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'timers'
      doc.panels.panel_ref.state = {
        timers: [
          {
            id: 'tm_fuse',
            label: 'Burning fuse',
            mode: 'down',
            durationMs: 60_000,
            accumulatedMs: 0,
            startedAt: 1
          }
        ]
      }
    },
    expect: {
      found: ['.timer.finished', '.timer .meter-fill.low'],
      text: ['Reset', 'Counts down'],
      missing: ['.note.warn']
    }
  },
  // The other half, and the one that says Reset means what it is called. Pressing
  // it has to put the full minute back rather than zero the clock, so the meter
  // returning to a full `ok` bar is the assertion. `.timer.finished` is exactly
  // "a countdown reading 0", which makes its absence the same claim again.
  {
    name: 'timer-finished-reset',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'timers'
      doc.panels.panel_ref.state = {
        timers: [
          {
            id: 'tm_fuse',
            label: 'Burning fuse',
            mode: 'down',
            durationMs: 60_000,
            accumulatedMs: 0,
            startedAt: 1
          }
        ]
      }
    },
    click: '.timer .btn',
    expect: {
      found: ['.timer-readout.editable', '.timer .meter-fill.ok[style*="width: 100%"]'],
      text: ['Start'],
      missing: ['.timer.finished']
    }
  },
  /*
   * A timer that was running when the app closed.
   *
   * `startedAt` and `savedAt` are both fixed, thirty seconds apart, against a
   * one-minute countdown — so the restore has exactly half the clock left to bank
   * and the meter lands on exactly 50%. A stamp taken at seed time would drift
   * with however long the build takes and could only be asserted loosely, which
   * is the difference between pinning the arithmetic and watching it run.
   *
   * The clock reads 00:30 in the shot, and none of the three text checks can see
   * that: a stopped readout is an `<input>`, and `innerText` does not include a
   * form control's value. So the meter is the assertion. `.timer.finished` means
   * exactly "a countdown reading 0", which is what this used to come back as
   * after a night with the app shut, so its absence is the bug itself.
   */
  {
    name: 'timer-paused-on-restore',
    layout: starter,
    savedAt: 1_030_000,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'timers'
      doc.panels.panel_ref.state = {
        timers: [
          {
            id: 'tm_fuse',
            label: 'Burning fuse',
            mode: 'down',
            durationMs: 60_000,
            accumulatedMs: 0,
            startedAt: 1_000_000
          }
        ]
      }
    },
    expect: {
      found: ['.timer-readout.editable', '.timer .meter-fill.ok[style*="width: 50%"]'],
      text: ['Start', 'Counts down'],
      missing: ['.timer.finished', '.timer-readout.running']
    }
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
  // The one panel in a fresh window, which has no neighbour on any side. The
  // four swap rows are present and greyed rather than absent, so the menu is the
  // same shape whatever the layout is.
  {
    name: 'panel-menu-lone',
    layout: null,
    click: '.panel .icon-btn[title="Panel menu"]',
    // The tooltip is the row's whole explanation, so its text is asserted from
    // the attribute — `innerText` never sees it.
    expect: {
      found: ['.menu', '.menu-item.disabled[title*="no panel to the left"]'],
      text: ['Swap with panel left']
    }
  },
  // A swap run from the ⋯ menu, which is its own route in: the row acts on the
  // panel the menu hangs off, where the key acts on whichever panel was last
  // touched. Initiative is on the left, so swapping right puts the party table
  // there and initiative in the top-right pane.
  {
    name: 'panel-menu-swap',
    layout: starter,
    click: [
      '.panel:has(.round-pill) .icon-btn[title="Panel menu"]',
      '.panel:has(.round-pill) .menu-item[data-menu-item="swap-right"]'
    ].join('\n'),
    expect: [
      '.split.row > .pane:first-child .table.resizable',
      '.split.column > .pane:first-child .round-pill'
    ]
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
      // Ctrl+S is still Save, alongside a sequence that ends on it. Ctrl+M Left
      // is VS Code's group move on Cursor's leader, so it also says the whole
      // arm moved rather than the three rows that were there before.
      text: ['Ctrl+M Ctrl+\\', 'Ctrl+M Ctrl+S', 'Ctrl+M Left', 'Ctrl+S']
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
      // Ctrl+K Shift+Left is Zed's own swap, on the same leader as its split —
      // the two sit one row apart, which is the pair that would collide if a
      // second stroke ever stopped being allowed to reuse a bound one.
      text: ['Ctrl+K Down', 'Ctrl+K Shift+Left', 'Ctrl+K Ctrl+S', 'Shift+Escape']
    }
  },
  // The tmux preset, which is the one whose bindings are written as keys rather
  // than as the characters tmux prints. `Ctrl+B Shift+5` is its split right: as
  // `Ctrl+B %` it rendered here just as happily and could never fire, because a
  // stroke is built from `event.code` and that key arrives as Shift+5. The
  // Alt+arrow rows are its pane resizing.
  {
    name: 'shortcuts-tmux',
    layout: starter,
    steps: [{ menu: 'app:shortcuts' }, { click: '.preset[data-preset-id="tmux"]' }],
    expect: {
      found: ['.shortcuts-modal', '.shortcut-row'],
      text: ['Ctrl+B Shift+5', "Ctrl+B Shift+'", 'Ctrl+B Alt+Right']
    }
  },
  // Vim's, where every window command hangs off Ctrl+W — including the four the
  // preset has to claim back from Close Panel, and the resize keys written as
  // the strokes that produce Vim's `<` and `>`.
  {
    name: 'shortcuts-vim',
    layout: starter,
    steps: [{ menu: 'app:shortcuts' }, { click: '.preset[data-preset-id="vim"]' }],
    expect: {
      found: ['.shortcuts-modal', '.shortcut-row'],
      text: ['Ctrl+W C', 'Ctrl+W Shift+H', 'Ctrl+W Shift+.']
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
  // The calculator. An empty layout on purpose: the answer wears the Dice
  // Roller's own `.roll` row, so a starter layout with a dice panel behind the
  // backdrop would satisfy every one of these selectors without the palette
  // having drawn anything.
  //
  // The list going away is half the assertion. `(12 + 3) * 7` matches no command
  // exactly, so without the gate the typo-tolerant pass would rank the whole
  // catalogue against it and bury the answer under a screenful of rows.
  {
    name: 'action-palette-math',
    layout: null,
    menu: 'app:palette',
    type: { selector: '.palette-input', text: '(12 + 3) * 7' },
    expect: {
      found: ['.palette-result', '.roll-total'],
      // No breakdown and no reroll: arithmetic gives the same answer every
      // time, and its breakdown is the expression already on the line above.
      missing: ['.palette-list', '.palette-reroll', '.roll-detail'],
      text: ['(12 + 3) * 7', '105']
    }
  },
  // Dice, which is the other half of the same box: a breakdown of what landed,
  // and a button to throw them again.
  {
    name: 'action-palette-dice',
    layout: null,
    menu: 'app:palette',
    type: { selector: '.palette-input', text: '4d6kh3' },
    expect: {
      found: ['.palette-result', '.roll-total', '.roll-detail', '.palette-reroll'],
      missing: ['.palette-list'],
      text: ['4d6kh3']
    }
  },
  // Rerolling. The number is random, so what this pins is the rest of it: the
  // button throws without closing the palette or losing the expression under it.
  {
    name: 'action-palette-reroll',
    layout: null,
    steps: [
      { menu: 'app:palette' },
      { type: { selector: '.palette-input', text: '10d10' } },
      { click: '.palette-reroll' }
    ],
    expect: { found: ['.palette', '.palette-result', '.roll-detail'], text: ['10d10'] }
  },
  // Half-typed. `2d6 +` is on its way to an expression and is not one yet, so it
  // says so rather than falling back to the command list — which is the state
  // every roll passes through on the way to being typed.
  {
    name: 'action-palette-half-typed',
    layout: null,
    menu: 'app:palette',
    type: { selector: '.palette-input', text: '2d6 +' },
    expect: {
      found: ['.palette .empty'],
      missing: ['.palette-list', '.palette-result'],
      text: ['does not work out to a number']
    }
  },

  /* --------------------------------------------------------------- dice roller */

  // The module the palette borrows its answer row from, rolling an expression
  // with brackets and a multiplication in it — which the flat list of signed
  // terms this parser replaced could not read at all.
  //
  // Enter rather than the Roll button, because the input has to be clicked to be
  // focused anyway and `press` fires at whatever holds the focus.
  {
    name: 'dice-roller',
    layout: null,
    steps: [
      { click: '.picker-card[data-module-id="dice"]' },
      { click: '.toolbar .input.grow' },
      { type: { selector: '.toolbar .input.grow', text: '(2d6 + 2) * 2' } },
      { press: { key: 'Enter' } }
    ],
    // No warning is half of it: the module shows the input as invalid on a
    // parse it could not finish, so a green frame here would still be red.
    expect: {
      found: ['.roll.latest', '.roll-total', '.roll-detail'],
      missing: ['.note.warn'],
      text: ['(2d6 + 2) * 2']
    }
  },

  /* ----------------------------------------------------------------- big dice */

  // Fresh from the picker: a d20 as a solid, unthrown, prompting to be clicked.
  // The one shot of the solid standing still, so it is also the one that would
  // catch the twenty faces failing to assemble into a die.
  {
    name: 'bigdice',
    layout: null,
    click: '.picker-card[data-module-id="bigdice"]',
    // `.bigdice-readout` is the container and is always present; the prompt and
    // the total are the two things that swap inside it. `.bigdice-face` is one
    // of twenty and proves the solid built at all — whether it reads as a die
    // rather than a heap of triangles is eyes only.
    expect: {
      found: [
        '.bigdice',
        '.bigdice-stage.solid',
        '.bigdice-scene',
        '.bigdice-face',
        '.bigdice-prompt'
      ],
      missing: ['.bigdice-total']
    }
  },
  // Three of the new solids at once, because each is a different shape derived a
  // different way and no table of numbers can say whether one came out looking
  // like a die. The d4 is the one to read closely: its number is printed three
  // times per face and read at the apex pointing at the camera, so a throw shows
  // as three copies of one number radiating from the middle.
  //
  // The d6 is the second: a cube square to the camera is a flat square, so it
  // alone rests a few degrees off axis. If this shot shows a plain square, the
  // tilt has gone.
  {
    name: 'bigdice-solids',
    layout: starter,
    mutate: (doc) => {
      const seat = (id, sides, value) => {
        doc.panels[id].moduleId = 'bigdice'
        doc.panels[id].state = { sides, value, history: [] }
        doc.panels[id].settings = { showHistory: false }
      }
      seat('panel_init', 4, 3)
      seat('panel_party', 6, 5)
      seat('panel_ref', 8, 7)
    },
    // Which solid is which is eyes only; that each built the shape it was asked
    // for is not — the kind is on the scene, so a d6 drawn as an octahedron
    // would still be a legible failure in the shot beside it.
    //
    // No `text` on the numbers. Every face of a solid carries its own number in
    // the DOM, so asserting "3" is somewhere on screen is satisfied by any d4
    // resting on anything. The same trap the nat20 shot below documents.
    expect: {
      found: ['.bigdice-scene.d4', '.bigdice-scene.d6', '.bigdice-scene.d8', '.bigdice-face']
    }
  },
  // A d6 actually thrown, photographed after it has settled.
  //
  // Not the same shot as `bigdice-solids`, which renders a seeded die that has
  // never moved. A die that has *animated* to a stop is a different thing to
  // photograph: every face's `filter` and `visibility` is rewritten sixty times
  // a second on the way there, and the artefact that made this shot necessary —
  // a ghost of a face's number left a few pixels off its own — only ever
  // appeared after a throw. The cube is where it showed, because its flat faces
  // and straight edges leave a stale layer nowhere to hide.
  {
    name: 'bigdice-d6-thrown',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = { sides: 6, value: 4, history: [] }
    },
    click: '.bigdice-stage',
    settle: 1700,
    expect: {
      found: ['.bigdice-scene.d6', '.bigdice-total'],
      missing: ['.bigdice-stage.tumbling', '.bigdice-rolling']
    }
  },
  // The dodecahedron, and the two shapes the d10 family is built from. The
  // pentagons are here because they are the one face the first attempt got
  // wrong — gathered from textbook coordinates they came out non-planar, and a
  // non-planar face draws as a fold with gaps at its edges.
  //
  // The percentile pair is the same trapezohedron twice with different numbers,
  // so this is also the shot that would catch the two dice coming out identical.
  {
    name: 'bigdice-solid-percentile',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = { sides: 12, value: 11, history: [] }
      doc.panels.panel_party.moduleId = 'bigdice'
      doc.panels.panel_party.state = { sides: 10, value: 10, history: [] }
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.state = { sides: 100, value: 62, history: [] }
    },
    // Both halves of the pair by name, and the stage knowing it holds two dice.
    // `62` is worth asserting where a face value would not be: no single face
    // carries it, so it can only have come from the readout adding the pair up.
    expect: {
      found: [
        '.bigdice-scene.d12',
        '.bigdice-scene.d10',
        '.bigdice-stage.paired .bigdice-scene.d10-tens',
        '.bigdice-stage.paired .bigdice-scene.d10-units'
      ],
      text: ['62']
    }
  },
  // Advantage: two solids, the lower one dimmed, shrunk and struck through, and
  // the readout showing only what was kept. Seeded because a pair of particular
  // values cannot be arranged by clicking.
  //
  // In the starter's big left panel on purpose. The discarded die is told apart
  // by size, colour and a line across it, and none of the three is legible in a
  // panel that leaves the pair a hundred pixels to share.
  {
    name: 'bigdice-advantage',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = {
        sides: 20,
        mode: 'advantage',
        value: 18,
        pair: [4, 18],
        history: [
          { id: 'throw_a', sides: 20, value: 18, pair: [4, 18], mode: 'advantage' },
          { id: 'throw_b', sides: 20, value: 6, pair: [6, 11], mode: 'disadvantage' },
          { id: 'throw_c', sides: 20, value: 13 }
        ]
      }
    },
    // Exactly one die discarded, and the kept value in the readout. The history
    // strip carries the dropped number beside the kept one, which is what makes
    // a pair one entry rather than two.
    expect: {
      found: [
        '.bigdice-stage.paired',
        '.bigdice-scene.discarded',
        '.bigdice-modes .chip.on[data-mode="advantage"]',
        '.bigdice-dropped'
      ],
      text: ['18', 'Advantage']
    }
  },
  // Disadvantage keeps the other die, and the critical call-out follows the one
  // it kept: a natural 20 thrown and then discarded is not a critical. The 20
  // here is the *dropped* die, so the readout must print 3 and no flourish —
  // which is the whole of the rule this module had to decide.
  {
    name: 'bigdice-disadvantage-nat20-dropped',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = {
        sides: 20,
        mode: 'disadvantage',
        value: 3,
        pair: [20, 3],
        history: []
      }
    },
    expect: {
      found: ['.bigdice-total', '.bigdice-scene.discarded'],
      missing: ['.bigdice-flourish', '.bigdice-stage.nat20', '.bigdice-beams'],
      text: ['3']
    }
  },
  // The other way round: the kept die is the natural 20, so the loser leaves
  // entirely and the winner takes the middle. `.solo` is what drives both, and
  // the shot is taken well past the transition so the die is photographed where
  // it arrives rather than on its way there.
  {
    name: 'bigdice-advantage-nat20-solo',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = {
        sides: 20,
        mode: 'advantage',
        value: 20,
        pair: [7, 20],
        history: []
      }
    },
    settle: 900,
    // The discarded die is still in the DOM — it is the flourish that leaves,
    // never the dice — so `missing` cannot say it has gone. That it is invisible
    // is eyes only; that the stage entered the state that sends it away is not.
    expect: {
      found: [
        '.bigdice-stage.solo.nat20',
        '.bigdice-scene.discarded',
        '.bigdice-flourish',
        '.bigdice-beams'
      ],
      missing: ['.bigdice-stage.twin', '.bigdice-shock', '.bigdice-total'],
      text: ['CRITICAL SUCCESS']
    }
  },
  // Two natural 20s, about one throw in four hundred. Neither die lost, so
  // neither is struck or dimmed: they lean together instead, and the shockwave
  // and the bigger call-out are what say this is not an ordinary critical.
  //
  // The rings are not in this shot and cannot be in any shot. Like the beams'
  // `.sweep`, they are gated on a throw made in *this* session, so a restored
  // panel shows the twin already arrived rather than replaying it on every
  // launch — and a pair of 20s cannot be rolled to order, so no click can reach
  // the state either. Whether the shockwave reads is eyes only.
  //
  // The shine is not gated that way and so is assertable: it is what a twin
  // *is*, not what its landing looked like. Which of the eight glints happens
  // to be mid-flash when the shutter opens is luck, but that they are on the
  // die at all is not.
  {
    name: 'bigdice-twin-nat20',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = {
        sides: 20,
        mode: 'advantage',
        value: 20,
        pair: [20, 20],
        history: [{ id: 'throw_t', sides: 20, value: 20, pair: [20, 20], mode: 'advantage' }]
      }
    },
    settle: 900,
    // No strike and nothing discarded is the load-bearing half: a pair that
    // agreed threw nothing away, and crossing one of two natural 20s out would
    // be the worst place in the module to get that wrong. The history entry
    // drops its second number for the same reason.
    expect: {
      found: [
        '.bigdice-stage.twin.matched.nat20',
        '.bigdice-flourish.twin',
        '.bigdice-beams',
        '.bigdice-scene[data-side="left"] .bigdice-glints i',
        '.bigdice-scene[data-side="right"] .bigdice-glints i'
      ],
      missing: ['.bigdice-scene.discarded', '.bigdice-stage.solo', '.bigdice-dropped'],
      text: ['DOUBLE CRITICAL']
    }
  },
  // An ordinary tie — two dice that agreed on a number nobody writes home
  // about. Nothing is discarded, so both are full size showing the same face,
  // and without the scatter they are one sprite stamped twice. No flourish:
  // this is the plainest result the pair modes can produce, and the shot is
  // here to prove the scatter is not something only the twin gets.
  {
    name: 'bigdice-tie',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = {
        sides: 20,
        mode: 'advantage',
        value: 13,
        pair: [13, 13],
        history: [{ id: 'throw_tie', sides: 20, value: 13, pair: [13, 13], mode: 'advantage' }]
      }
    },
    settle: 900,
    expect: {
      found: ['.bigdice-stage.matched', '.bigdice-total'],
      missing: [
        '.bigdice-stage.twin',
        '.bigdice-scene.discarded',
        '.bigdice-flourish',
        '.bigdice-dropped',
        // An ordinary tie is scattered, but it does not shine: the twin has to
        // keep something of its own or it stops being one throw in four hundred.
        '.bigdice-glints'
      ],
      text: ['13']
    }
  },
  // Two natural 1s, which take the same shape down the other set of rules.
  {
    name: 'bigdice-twin-nat1',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = {
        sides: 20,
        mode: 'disadvantage',
        value: 1,
        pair: [1, 1],
        history: []
      }
    },
    settle: 900,
    expect: {
      found: ['.bigdice-stage.twin.nat1', '.bigdice-flourish.twin.grim'],
      missing: ['.bigdice-scene.discarded', '.bigdice-stage.nat20'],
      text: ['DOUBLE DISASTER']
    }
  },
  // Mid-throw, caught deliberately: the one state no seeded layout can reach.
  //
  // This is the answer to "what do the effects do while the dice are in the
  // air": nothing is decided, so nothing is marked. No strike, no flourish —
  // not even the *previous* throw's, which used to sit there through the tumble
  // and read as a verdict on a roll still happening — and the readout is three
  // dots rather than the last number, which is the one thing here that could be
  // mistaken for the result.
  {
    name: 'bigdice-rolling',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.state = {
        sides: 20,
        mode: 'advantage',
        value: 20,
        pair: [20, 20],
        history: [{ id: 'throw_old', sides: 20, value: 20, pair: [20, 20], mode: 'advantage' }]
      }
    },
    click: '.bigdice-stage',
    // Well inside the 1400 ms throw, and after the first frames have moved the
    // dice off their resting orientation.
    settle: 500,
    expect: {
      found: ['.bigdice-stage.tumbling', '.bigdice-rolling', '.bigdice-scene'],
      missing: [
        '.bigdice-total',
        '.bigdice-flourish',
        '.bigdice-scene.discarded',
        '.bigdice-beams',
        '.bigdice-stage.twin',
        '.bigdice-stage.solo'
      ]
    }
  },
  // The same pair through the flat renderer, which has to answer advantage too:
  // a DM who turned the solids off still gets both dice, with the loser drawn
  // back and drained, in the terms that renderer is built in.
  {
    name: 'bigdice-flat-advantage',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.settings = { solid: false }
      doc.panels.panel_init.state = {
        sides: 20,
        mode: 'disadvantage',
        value: 5,
        pair: [5, 16],
        history: []
      }
    },
    expect: {
      found: ['.bigdice-pair .die.d20', '.die.discarded', '.bigdice-total'],
      missing: ['.bigdice-scene'],
      text: ['5', '16']
    }
  },
  // The same panel with the solid turned off, which is the whole of what that
  // setting does. Two renderers live in this module and only one of them is
  // reachable by clicking, so the other needs seeding.
  {
    name: 'bigdice-flat',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.settings = { solid: false }
      doc.panels.panel_ref.state = { sides: 20, value: 17, history: [] }
    },
    // The flat top-down die is back, and the solid is gone rather than merely
    // hidden behind it.
    expect: {
      found: ['.die.d20', '.die-face', '.bigdice-total'],
      missing: ['.bigdice-face', '.bigdice-scene'],
      text: ['17']
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
  // clicking. Shows the flourish, the beams and the history strip together.
  //
  // No `text` check on the number any more. All twenty faces carry their number
  // in the DOM at once, so `text: ['20']` passes whatever the die is showing —
  // it would have gone green against a die resting on a 3.
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
    // `missing` is the load-bearing half: this panel was restored, not thrown
    // in, so the beams have to be standing there already rather than sweeping
    // in as though the 20 had just happened.
    expect: {
      found: [
        '.bigdice-stage.nat20',
        '.bigdice-beams',
        '.bigdice-wash',
        '.bigdice-flourish',
        '.bigdice-history',
        '.bigdice-past'
      ],
      // The number goes on a critical: the die is showing it, and the call-out
      // is what the readout is for.
      missing: ['.bigdice-beams.sweep', '.bigdice-wash.sweep', '.bigdice-total'],
      text: ['CRITICAL SUCCESS']
    }
  },
  // The other half of the flourish, which is a different colour down a
  // different set of rules. Seeded for the same reason as the 20.
  {
    name: 'bigdice-nat1',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.state = { sides: 20, value: 1, history: [] }
    },
    expect: {
      found: ['.bigdice-stage.nat1', '.bigdice-beams', '.bigdice-flourish'],
      missing: ['.bigdice-stage.nat20', '.bigdice-total'],
      text: ['CRITICAL FAILURE']
    }
  },
  // Percentile through the flat renderer, where it has to stay the two
  // ten-sided dice it physically is rather than collapsing back to one. Seeded
  // at 100 — the one throw in a hundred that shows 00 and 0, and the only
  // three-digit total the history strip ever has to hold.
  //
  // `solid: false` is load-bearing now that every die has a solid: without it
  // this panel renders as the trapezohedron pair, which is a different shot
  // (`bigdice-solid-percentile`) asserting a different thing.
  {
    name: 'bigdice-percentile',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.settings = { solid: false }
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
    // Asserted through a child: `.bigdice-pair` is `display: contents` so the
    // dice can join the stage's flex layout, which leaves the wrapper itself
    // with no box to be visible in.
    expect: {
      found: ['.bigdice-pair .die', '.bigdice-total', '.bigdice-history'],
      text: ['100']
    }
  },
  // The two numbers that came closest to overflowing their faces, at two very
  // different panel sizes: a d12 showing 12 and a d4 showing 4. Both sit inside
  // an inner face of the flat die, so this is what would catch either one
  // clipping again — and it is the flat die's question alone, since a solid
  // prints its numbers on real faces sized from the geometry.
  {
    name: 'bigdice-tight-faces',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_init.moduleId = 'bigdice'
      doc.panels.panel_init.settings = { solid: false }
      doc.panels.panel_init.state = { sides: 4, value: 4, history: [] }
      doc.panels.panel_ref.moduleId = 'bigdice'
      doc.panels.panel_ref.settings = { solid: false }
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
  // A pack's name pools, with the bundled ones switched off. Before this the
  // switch was an off switch for the whole module — the panel said it had
  // nothing to draw from whatever else was loaded.
  //
  // The fixture pool is one prefix and one suffix with no middle, so the chip
  // reads `Fixturefolk` every run and the flesh-out lines are the pack's only
  // ones. Nothing here is random, which is what lets `text` assert on it.
  {
    name: 'pack-names',
    layout: null,
    data: {
      refs: [{ id: 'smoke-fixture', name: 'Smoke Fixture', path: fixturePack }],
      enabled: { names: false }
    },
    click: [
      '.picker-card[data-module-id="names"]',
      '.toolbar .btn.primary',
      '.chip-pair .chip.flesh'
    ].join('\n'),
    expect: {
      found: ['.chip.action', '.npc-card', '.npc-line'],
      // The empty state is the regression: a pool loaded from a pack has to
      // reach the panel, not merely survive the merge.
      missing: ['.empty'],
      text: ['Fixturefolk', 'invented for the smoke check', 'wants this shot to pass']
    }
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
  /*
   * The mirror and the textarea over it, measured against each other.
   *
   * This is the one thing the other assertions structurally cannot see. A mirror
   * that has drifted is present, visible and reads perfectly, so `found` and
   * `text` pass while the caret sits a line away from the glyph it is on — which
   * is exactly how a textarea taking `line-height: normal` from the UA sheet,
   * under a mirror inheriting 1.45 from `body`, went unnoticed.
   *
   * Fullscreen so the whole note is on screen, and selected so the screenshot
   * carries the evidence too: the highlights are the textarea's idea of where
   * the lines are and the numbers are the mirror's, so any drift is a bar on the
   * wrong row. `props` is every property that decides where a glyph lands.
   */
  {
    name: 'notes-mirror-metrics',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'notes'
      doc.panels.panel_ref.state = { text: driftingNote }
    },
    steps: [
      { click: '.panel:has(.notes-area) .icon-btn[title^="Fullscreen"]' },
      { select: { selector: '.markup-input', start: 0, end: driftingNote.length } }
    ],
    // Past the fullscreen hint's own timer, so it is not sitting over the note.
    settle: 5000,
    expect: {
      found: ['.app.has-maximized', '.markup-mirror', '.markup-input'],
      text: ['Line 16'],
      metrics: [
        {
          a: '.markup-mirror',
          b: '.markup-input',
          props: [
            'font-size',
            'line-height',
            'font-family',
            'font-weight',
            'letter-spacing',
            'tab-size',
            'white-space',
            'overflow-wrap',
            'padding-top',
            'padding-left',
            'border-top-width',
            'border-left-width'
          ]
        }
      ]
    }
  },
  // The same agreement, at the width rather than the pitch. A note that overflows
  // puts a scrollbar on the textarea and none on the mirror, which is 10px off
  // the content box of one of them and a different wrap point on every line that
  // follows. `clientWidth` is the whole assertion — the two boxes wrap the same
  // text, so equal widths is equal wrapping.
  {
    name: 'notes-mirror-wrapping',
    layout: starter,
    mutate: (doc) => {
      doc.panels.panel_ref.moduleId = 'notes'
      doc.panels.panel_ref.state = { text: wrappingNote }
    },
    click: '.markup-input',
    expect: {
      found: ['.markup-mirror', '.markup-input'],
      metrics: [{ a: '.markup-mirror', b: '.markup-input', props: ['clientWidth', 'line-height'] }]
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

async function seedSession(shot) {
  const { name, layout: layoutPath, mutate, data, keys, writable, savedAt } = shot
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

  // A shot that saves needs somewhere of its own to save to. Pointing one at
  // `examples/starter.dmscreen` would have it rewrite the fixture every other
  // shot reads, so `writable` copies the layout into this shot's userData —
  // which is already the unit of isolation here — and points the session at the
  // copy. Without it there is no way to exercise Save at all: the path a save
  // takes when the document already has a file is the one with no dialog in it.
  const filePath = writable ? join(userData, 'layout.dmscreen') : layoutPath
  if (writable) await writeFile(filePath, JSON.stringify(doc, null, 2))

  // `savedAt` is when the app was last alive, which is what the restore banks a
  // running timer up to. Declared by the shot rather than stamped here, because
  // the whole point is a gap between it and launch, and a shot pinning an exact
  // remaining time needs an exact stamp rather than one that moves per run.
  // Omitted otherwise, which is the state an older session.json is in and the
  // one where the clocks are left alone.
  await writeFile(
    join(userData, 'session.json'),
    JSON.stringify({ doc, filePath, dirty: false, ...(savedAt ? { savedAt } : {}) }, null, 2)
  )
  await writeFile(
    join(userData, 'recents.json'),
    JSON.stringify(
      [{ path: filePath, name: doc.name, openedAt: new Date().toISOString() }],
      null,
      2
    )
  )
}

/**
 * A shot's `expect` is either a bare list of selectors — the common case, "these
 * must be on screen" — or an object with `found`, `missing`, `text` and
 * `metrics`.
 *
 * Every shot must declare one. A shot with nothing to assert is a shot that
 * cannot fail, and this harness spent a long time full of those: an absent
 * feature photographs exactly as cleanly as a present one.
 *
 * `metrics` is the odd one out, and asks the question the other three cannot:
 * whether two elements are laid out alike. Each entry is `{ a, b, props }`, and
 * every property must read the same on both — a computed style by its CSS name,
 * or one of `clientWidth`, `clientHeight`, `scrollWidth`, `scrollHeight` for the
 * box itself. It exists for the Notes mirror, whose whole correctness is that it
 * agrees with the textarea over it about where a glyph goes: a mirror that has
 * drifted is present, visible, and reads correctly, so `found` and `text` both
 * pass while the caret sits a line away from the character it is on.
 */
function normaliseExpect(expect, name) {
  if (!expect) throw new Error(`shot "${name}" declares no expect`)
  const spec = Array.isArray(expect) ? { found: expect } : expect
  for (const pair of spec.metrics ?? []) {
    if (!pair.a || !pair.b || !pair.props?.length) {
      throw new Error(`shot "${name}" has a metrics entry without a, b and props`)
    }
  }
  const total =
    (spec.found?.length ?? 0) +
    (spec.missing?.length ?? 0) +
    (spec.text?.length ?? 0) +
    (spec.metrics?.length ?? 0)
  if (!total) throw new Error(`shot "${name}" declares an empty expect`)
  return spec
}

/** The actions a step may carry. Exactly one, which is what makes it ordered. */
const STEP_KINDS = ['menu', 'click', 'press', 'type', 'select', 'wheel', 'drag', 'hover', 'wait']

/**
 * Keys a step may carry beside its one action.
 *
 * `window` says which screen the step acts on, 1-based, so a shot can reach past
 * the one it photographs — a drag from the players' window onto the laptop is
 * two halves in two renderers.
 */
const STEP_MODIFIERS = ['window']

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
      const unknown = Object.keys(step).filter(
        (key) => !STEP_KINDS.includes(key) && !STEP_MODIFIERS.includes(key)
      )
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
  /*
   * Which window the shot drives and photographs, as an index into the
   * document's open windows. A layout can have several now, and a second screen
   * is UI like any other — unphotographed, it is the one part of the app nobody
   * ever looks at.
   *
   * One window, not all of them: the steps and the capture belong to a single
   * renderer, and installing the hook everywhere would have each of them fire
   * the step list and race to exit the app.
   */
  const windowIndex = shot.window ? shot.window - 1 : 0

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
          DMSCREEN_SMOKE_WINDOW: String(windowIndex),
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
  await seedSession(shot)

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

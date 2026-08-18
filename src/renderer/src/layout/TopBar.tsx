import { useState } from 'react'
import { actionUnavailable } from '../../../shared/actions'
import { useAppStore } from '../state/store'
import { parenthesised, useShortcuts } from '../lib/shortcuts'
import { ShortcutHint } from '../components/ShortcutHint'
import { WindowsMenu } from './WindowsMenu'

/**
 * A secondary window's bar: the mark, which screen this is, and the switcher.
 *
 * Deliberately almost nothing. A second window is usually the one the players
 * can see, and app chrome on it is chrome pointed at the wrong audience. The
 * commands it drops are not lost — the native menu, its accelerators and the
 * action palette all still carry them, and every one of them acts on the focused
 * window. What goes is the row of buttons, which on a players' screen would only
 * ever be pressed by accident.
 */
function SecondaryBar(): JSX.Element {
  const windowId = useAppStore((state) => state.windowId)
  const windowName = useAppStore(
    (state) => state.doc.windows.find((entry) => entry.id === state.windowId)?.name
  )
  const layoutName = useAppStore((state) => state.doc.name)
  const locked = useAppStore((state) => state.doc.locked)
  const renameWindow = useAppStore((state) => state.renameWindow)

  const [renaming, setRenaming] = useState(false)

  return (
    <header className="topbar secondary">
      <div className="brand" title="Digital DM Screen">
        <BrandMark />
      </div>

      {/* The name is a rename field here, exactly as the layout's name is on the
          primary bar. This is the name that identifies the window a DM is
          looking at, so it is the one worth being able to click — reaching it
          only through the switcher made it look like a label. */}
      {renaming ? (
        <input
          className="window-label-input"
          autoFocus
          defaultValue={windowName ?? ''}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            const next = event.target.value.trim()
            if (next) void renameWindow(windowId, next)
            setRenaming(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <button
          className="window-label"
          data-window-id={windowId}
          /* `aria-disabled`, not `disabled`: the row is still the window's name,
             and Chromium suppresses the tooltip — the only place the reason can
             go — on a disabled control. Same bargain as the layout name. */
          aria-disabled={locked ? true : undefined}
          title={
            locked
              ? `${layoutName} — the layout is locked, so the name cannot be changed`
              : `${layoutName} — click to rename this window`
          }
          onClick={() => {
            if (locked) return
            setRenaming(true)
          }}
        >
          {windowName ?? 'Window'}
        </button>
      )}

      <WindowsMenu />
      <span className="spacer" />
    </header>
  )
}

export function TopBar(): JSX.Element {
  const isPrimary = useAppStore((state) => state.isPrimary)
  if (!isPrimary) return <SecondaryBar />
  return <PrimaryBar />
}

function PrimaryBar(): JSX.Element {
  const shortcuts = useShortcuts()
  const name = useAppStore((state) => state.doc.name)
  const dirty = useAppStore((state) => state.dirty)
  const filePath = useAppStore((state) => state.filePath)
  const theme = useAppStore((state) => state.theme)
  const locked = useAppStore((state) => state.doc.locked)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)

  const newLayout = useAppStore((state) => state.newLayout)
  const openLayout = useAppStore((state) => state.openLayout)
  const save = useAppStore((state) => state.save)
  const saveAs = useAppStore((state) => state.saveAs)
  const renameLayout = useAppStore((state) => state.renameLayout)
  const setTheme = useAppStore((state) => state.setTheme)
  const toggleLock = useAppStore((state) => state.toggleLock)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)

  const [renaming, setRenaming] = useState(false)

  /* Why the name cannot be edited, asked of the catalogue rather than written
     here as a `locked` check — a second copy of that rule is how the menu and
     the palette came to disagree about what a lock covers in the first place.

     The panel fields are answered blank because the top bar has no panel in
     hand. Filling them in truthfully would mean subscribing it to the whole
     document, so that every keystroke in a notes panel re-rendered it, and
     `layout:rename` reads the lock and nothing else. */
  const renameOff = actionUnavailable('layout:rename', {
    locked,
    hasPanel: false,
    maximized: false,
    isPrimary: true,
    hasWindows: false,
    hasSplit: false,
    neighbours: { left: false, right: false, up: false, down: false }
  })
  const file = filePath ?? 'Not saved to a file yet'

  return (
    <header className="topbar">
      <div className="brand" title="Digital DM Screen">
        <BrandMark />
      </div>

      {renaming ? (
        <input
          className="layout-name-input"
          autoFocus
          defaultValue={name}
          /* Renaming is nearly always replacing, so the old name arrives
             selected and the first keystroke throws it away — keeping it means
             one extra gesture every time. On focus rather than on mount: a ref
             callback re-runs whenever the component re-renders, which would
             reselect the text under someone mid-edit. Blur commits and closes
             the field, so this can only ever fire once. */
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            const next = event.target.value.trim()
            if (next) renameLayout(next)
            setRenaming(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <button
          className="layout-name"
          /* `aria-disabled`, not `disabled`: the row is still the layout's name
             and its file path, and Chromium suppresses the tooltip — which is
             the only place the reason can go — on a disabled control. */
          aria-disabled={renameOff ? true : undefined}
          title={
            renameOff
              ? `${file} — ${renameOff}, so the name cannot be changed`
              : `${file} — click${
                  shortcuts['layout:rename'] ? ` or press ${shortcuts['layout:rename']}` : ''
                } to rename`
          }
          onClick={() => {
            if (renameOff) return
            setRenaming(true)
          }}
        >
          {name}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </button>
      )}

      <WindowsMenu />

      <span className="spacer" />

      <div className="topbar-actions">
        {/* No `title` on these four — the hint replaces it, and both at once
            would mean two tooltips for one button. */}
        <ShortcutHint label="New layout" shortcut={shortcuts['layout:new']}>
          <button className="btn" onClick={() => void newLayout()}>
            New
          </button>
        </ShortcutHint>
        <ShortcutHint label="Open layout" shortcut={shortcuts['layout:open']}>
          <button className="btn" onClick={() => void openLayout()}>
            Open
          </button>
        </ShortcutHint>
        <ShortcutHint label="Save layout" shortcut={shortcuts['layout:save']}>
          <button className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </ShortcutHint>
        <ShortcutHint label="Save to a new file" shortcut={shortcuts['layout:saveAs']}>
          <button className="btn" onClick={() => void saveAs()}>
            Save As
          </button>
        </ShortcutHint>

        <span className="divider" />

        {/* Icon-only buttons have nowhere to put the hint, so theirs stays in the
            tooltip. Keep the "Lock the layout" wording — smoke.mjs selects on it. */}
        <button
          className={`icon-btn ${locked ? 'on' : ''}`}
          onClick={toggleLock}
          title={
            locked
              ? `Layout locked${parenthesised(shortcuts['layout:toggleLock'])} — click to allow resizing, splitting and closing panels`
              : `Lock the layout${parenthesised(shortcuts['layout:toggleLock'])}: freeze panel sizes and positions`
          }
        >
          <LockIcon locked={locked} />
        </button>

        <button
          className={`btn ${sidebarOpen ? 'primary' : ''}`}
          onClick={toggleSidebar}
          title="Recent layouts"
        >
          Recent
        </button>
        <button
          className="icon-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}

/** Inline rather than a glyph — no font dependency to go missing. */
function BrandMark(): JSX.Element {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2 3.5 5v7.2c0 5.2 3.6 8.9 8.5 9.8 4.9-.9 8.5-4.6 8.5-9.8V5L12 2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 7v9M8 11h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** Inline so it matches the brand mark and needs no icon font. */
function LockIcon({ locked }: { locked: boolean }): JSX.Element {
  return (
    <svg className="lock-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="5"
        y="10.5"
        width="14"
        height="9.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      {/* Open shackle swings clear of the body when unlocked. */}
      <path
        d={locked ? 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3' : 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

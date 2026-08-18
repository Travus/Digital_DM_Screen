import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WindowDef } from '../../../shared/types'
import { useAppStore } from '../state/store'
import { useShortcuts } from '../lib/shortcuts'
import { placeMenu, type Placement, type Size } from '../lib/menuPlacement'

/**
 * The window switcher, beside the layout name.
 *
 * Always a dropdown, including with one window. It used to be a plain
 * "+ Add Window" button until a second screen existed and a list after that, and
 * a control that changes what kind of control it is has to be re-read every time
 * you look at it — the row it lives on stops being somewhere you can aim.
 *
 * Closed windows are listed too, under their own heading. A closed window still
 * has its panels — that is the whole of what closing rather than deleting buys —
 * so it has to be reachable, and a list that quietly forgot them would put those
 * panels out of reach with nothing on screen to say why.
 */
export function WindowsMenu(): JSX.Element {
  const shortcuts = useShortcuts()
  const windows = useAppStore((state) => state.doc.windows)
  const windowId = useAppStore((state) => state.windowId)

  const addWindow = useAppStore((state) => state.addWindow)
  const openWindow = useAppStore((state) => state.openWindow)
  const removeWindow = useAppStore((state) => state.removeWindow)
  const renameWindow = useAppStore((state) => state.renameWindow)
  const focusWindow = useAppStore((state) => state.focusWindow)

  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  /* Closing the menu drops a half-finished rename with it, rather than leaving a
     field that springs back open the next time the menu is. */
  useEffect(() => {
    if (!open) setRenamingId(null)
  }, [open])

  /* Placed from JS for the reason the ⋯ panel menu is: `.panel` and the top bar
     both clip, so anything overhanging one is `position: fixed` and has to be
     told where to go. Measured in a layout effect, before the browser paints. */
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    let size: Size | null = null
    const reposition = (): void => {
      if (!buttonRef.current || !menuRef.current) return
      size ??= { width: menuRef.current.offsetWidth, height: menuRef.current.offsetHeight }
      setPlacement(
        placeMenu(buttonRef.current.getBoundingClientRect(), size, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      )
    }
    reposition()
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [open])

  const openWindows = windows.filter((entry) => entry.open)
  const closedWindows = windows.filter((entry) => !entry.open)
  const primaryId = windows[0]?.id

  const commitRename = (id: string, value: string): void => {
    if (value.trim()) void renameWindow(id, value)
    setRenamingId(null)
  }

  /**
   * One row: the name focuses the window, or reopens a closed one, and the two
   * icons rename and delete it.
   *
   * Renaming has a control of its own rather than a double-click on the name.
   * The name's first click closes the menu, so the second click of a double
   * never landed and the field could not be opened at all.
   *
   * There is no close here, only delete. Closing a window is what its own frame
   * is for, and a row offering both would be two similar buttons whose
   * difference is invisible until one of them has lost you a screen.
   */
  const row = (entry: WindowDef): JSX.Element => (
    <div
      key={entry.id}
      className={`menu-item window-row ${entry.id === windowId ? 'current' : ''} ${
        entry.open ? '' : 'closed'
      }`}
      data-window-id={entry.id}
    >
      {renamingId === entry.id ? (
        <input
          className="window-name-input"
          autoFocus
          defaultValue={entry.name}
          /* Selected on arrival so typing replaces — the same bargain the layout
             and panel name fields make, and hung off focus for the same reason:
             a ref callback would reselect under someone mid-edit. */
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => commitRename(entry.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setRenamingId(null)
          }}
        />
      ) : (
        <>
          <button
            className="menu-label window-name"
            title={
              !entry.open
                ? 'Open this window again, with the panels it had'
                : entry.id === windowId
                  ? 'This window'
                  : 'Bring this window to the front'
            }
            onClick={() => {
              if (entry.open) void focusWindow(entry.id)
              else void openWindow(entry.id)
              setOpen(false)
            }}
          >
            {entry.name}
          </button>
          <button
            className="icon-btn window-rename"
            title="Rename this window"
            onClick={() => setRenamingId(entry.id)}
          >
            <PencilIcon />
          </button>
          {/* The primary has none: every layout keeps one window, and closing
              that one is quitting rather than deleting. */}
          {entry.id !== primaryId && (
            <button
              className="icon-btn window-remove"
              title="Delete this window and the panels on it"
              onClick={() => void removeWindow(entry.id)}
            >
              <BinIcon />
            </button>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        ref={buttonRef}
        className={`btn windows-btn ${open ? 'on' : ''}`}
        data-windows="menu"
        title="Screens in this layout"
        onClick={() => setOpen(!open)}
      >
        Windows
        <ChevronIcon />
      </button>

      {open && (
        <div
          className="menu windows-menu"
          ref={menuRef}
          style={placement ? { ...placement } : { visibility: 'hidden' }}
        >
          {openWindows.map(row)}

          {closedWindows.length > 0 && (
            <>
              <div className="menu-sep" />
              <div className="menu-heading">Closed</div>
              {closedWindows.map(row)}
            </>
          )}

          <div className="menu-sep" />
          <button
            className="menu-item"
            data-windows="add"
            onClick={() => {
              void addWindow()
              setOpen(false)
            }}
          >
            <span className="menu-label">+ New Window</span>
            {shortcuts['window:new'] && <span className="shortcut">{shortcuts['window:new']}</span>}
          </button>
        </div>
      )}
    </div>
  )
}

/*
 * Inline SVG rather than glyphs, the same bargain the brand mark and the lock
 * icon already make: a chevron character depends on a font having it, and the
 * one that answered drew it thin, oversized and off the baseline beside the
 * label. These are drawn at the weight of everything else on the row.
 */

function ChevronIcon(): JSX.Element {
  return (
    <svg className="chevron-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.75 4.5 6 7.75 9.25 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PencilIcon(): JSX.Element {
  return (
    <svg className="row-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M11.1 2.4a1.35 1.35 0 0 1 1.9 1.9l-6.8 6.8-2.5.6.6-2.5 6.8-6.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BinIcon(): JSX.Element {
  return (
    <svg className="row-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 4.5h10M6.5 4.5V3h3v1.5M4.6 4.5l.6 8a1 1 0 0 0 1 .95h3.6a1 1 0 0 0 1-.95l.6-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

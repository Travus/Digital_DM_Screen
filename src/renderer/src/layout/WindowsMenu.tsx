import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { parenthesised, useShortcuts } from '../lib/shortcuts'
import { placeMenu, type Placement, type Size } from '../lib/menuPlacement'

/**
 * The window switcher, beside the layout name.
 *
 * With one window there is nothing to switch between, so the control is the
 * command instead: a plain "+ Add Window". A second window turns it into a list,
 * because from then on the question being asked of it is "which screen", and
 * adding another moves to the bottom of that list.
 *
 * Closed windows are listed too, greyed, below the open ones. A window that is
 * closed still has its panels — that is the whole of what closing rather than
 * removing buys — so it has to be reachable, and a list that silently forgot
 * them would make the panels unreachable with nothing on screen to say why.
 */
export function WindowsMenu(): JSX.Element {
  const shortcuts = useShortcuts()
  const windows = useAppStore((state) => state.doc.windows)
  const windowId = useAppStore((state) => state.windowId)

  const addWindow = useAppStore((state) => state.addWindow)
  const openWindow = useAppStore((state) => state.openWindow)
  const closeWindow = useAppStore((state) => state.closeWindow)
  const removeWindow = useAppStore((state) => state.removeWindow)
  const renameWindow = useAppStore((state) => state.renameWindow)
  const focusWindow = useAppStore((state) => state.focusWindow)

  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  const alone = windows.length === 1

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
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

  // One window: the control is the command, so there is no list to open.
  if (alone) {
    return (
      <button
        className="btn windows-btn"
        data-windows="add"
        title={`Open a second screen${parenthesised(shortcuts['window:new'])} — a players' view on another monitor`}
        onClick={() => void addWindow()}
      >
        + Add Window
      </button>
    )
  }

  const openWindows = windows.filter((entry) => entry.open)
  const closedWindows = windows.filter((entry) => !entry.open)

  const commitRename = (id: string, value: string): void => {
    if (value.trim()) void renameWindow(id, value)
    setRenamingId(null)
  }

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        ref={buttonRef}
        className={`btn windows-btn ${open ? 'on' : ''}`}
        data-windows="menu"
        title="Screens in this layout"
        onClick={() => setOpen(!open)}
      >
        Windows <span aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div
          className="menu windows-menu"
          ref={menuRef}
          style={placement ? { ...placement } : { visibility: 'hidden' }}
        >
          {openWindows.map((entry) => (
            <div
              key={entry.id}
              className={`menu-item window-row ${entry.id === windowId ? 'current' : ''}`}
              data-window-id={entry.id}
            >
              {renamingId === entry.id ? (
                <input
                  className="window-name-input"
                  autoFocus
                  defaultValue={entry.name}
                  /* Selected on arrival so typing replaces — the same bargain the
                     layout and panel name fields make, and hung off focus for the
                     same reason: a ref callback would reselect mid-edit. */
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => commitRename(entry.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <button
                  className="menu-label window-name"
                  title={
                    entry.id === windowId
                      ? 'This window — double-click to rename it'
                      : 'Bring this window to the front — double-click to rename it'
                  }
                  onDoubleClick={() => setRenamingId(entry.id)}
                  onClick={() => {
                    void focusWindow(entry.id)
                    setOpen(false)
                  }}
                >
                  {entry.name}
                </button>
              )}
              {/* The primary has no close: closing it quits, which is a
                  different command and belongs on the window itself. */}
              {entry.id !== windows[0].id && (
                <button
                  className="icon-btn window-close"
                  title="Close this window — its panels are kept"
                  onClick={() => void closeWindow(entry.id)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          {closedWindows.length > 0 && (
            <>
              <div className="menu-sep" />
              <div className="menu-heading">Closed</div>
              {closedWindows.map((entry) => (
                <div
                  key={entry.id}
                  className="menu-item window-row closed"
                  data-window-id={entry.id}
                >
                  <button
                    className="menu-label window-name"
                    title="Open this window again, with the panels it had"
                    onClick={() => {
                      void openWindow(entry.id)
                      setOpen(false)
                    }}
                  >
                    {entry.name}
                  </button>
                  {/* The only way to be rid of a window for good. Without it a
                      closed one is kept forever, and the list only grows. */}
                  <button
                    className="icon-btn window-remove"
                    title="Remove this window and the panels on it"
                    onClick={() => void removeWindow(entry.id)}
                  >
                    🗑
                  </button>
                </div>
              ))}
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

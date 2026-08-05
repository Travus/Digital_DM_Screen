import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Long enough that crossing the top bar on the way somewhere else shows nothing. */
const REVEAL_DELAY_MS = 450

/**
 * Reveals what a control is and what key does the same thing, after a pause on
 * hover.
 *
 * The ⋯ menu prints its shortcuts on the rows outright, because a menu is only
 * open while you are hunting for a command. The top bar is on screen for the
 * whole session, where the same treatment reads as clutter — so it waits to be
 * asked.
 *
 * Centred on whatever it wraps, which suits the top bar and nothing near a
 * window edge; a control closer to one would need this clamped.
 */
export function ShortcutHint({
  label,
  shortcut,
  children
}: {
  label: string
  /** Absent once an action can be unbound — the hint then names the control only. */
  shortcut?: string
  children: ReactNode
}): JSX.Element {
  const [shown, setShown] = useState(false)
  const timer = useRef<number | null>(null)

  const clear = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  /* Written out rather than returning `clear`, which would make the effect
     depend on a function rebuilt every render. */
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  return (
    <span
      className="hint-anchor"
      onPointerEnter={() => {
        clear()
        timer.current = window.setTimeout(() => setShown(true), REVEAL_DELAY_MS)
      }}
      onPointerLeave={() => {
        clear()
        setShown(false)
      }}
      /* Pressing the button is the user acting on it; the hint has done its job
         and would otherwise hang over whatever the click opened. */
      onPointerDown={() => {
        clear()
        setShown(false)
      }}
    >
      {children}
      {shown && (
        <span className="hint" role="tooltip">
          {label}
          {shortcut && <span className="shortcut">{shortcut}</span>}
        </span>
      )}
    </span>
  )
}

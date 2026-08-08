import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ActionId } from '../../../shared/actions'
import { actionContext, paletteEntries } from '../lib/palette'
import { useKeymapStore } from '../state/keymapStore'
import { resolveTargetNodeId, useAppStore } from '../state/store'

/**
 * What was typed last time, kept for as long as the app runs.
 *
 * Deliberately outside React and outside every store: it has to outlive the
 * component, it is nobody's document state, and writing it must not render
 * anything. Reopening lands on the same filtered list, which is most of the work
 * of doing the same thing twice; the input is selected so the next keystroke
 * throws it away, which is the rest.
 *
 * Only the text. The highlighted *row* is deliberately not remembered — an index
 * means a different command as soon as the context changes, so restoring one
 * would hand a blind Enter to whatever had moved into that position.
 */
let lastQuery = ''

/**
 * A floating list of every command that currently applies, filtered as you type
 * and run with Enter.
 *
 * It is the answer to the two things a keymap cannot do on its own: most
 * commands ship unbound because there are more commands than chords worth
 * spending, and nobody remembers the bindings of the ones that are. Both are the
 * same problem — a command you cannot name is a command you do not have.
 *
 * Rows come from the catalogue in `src/shared/actions.ts`, so a command added
 * there appears here with no further wiring, and the key shown beside it is the
 * live one rather than a caption that has to be kept in step.
 */
export function ActionPalette({
  onRun,
  onClose
}: {
  onRun: (action: ActionId) => void
  onClose: () => void
}): JSX.Element {
  const doc = useAppStore((state) => state.doc)
  const maximizedNodeId = useAppStore((state) => state.maximizedNodeId)
  const keymap = useKeymapStore((state) => state.keymap)

  const [query, setQuery] = useState(lastQuery)
  /** Highlighted row. Clamped rather than reset, so a slow deletion keeps its place. */
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const platform = window.dmscreen.platform

  // The target panel is resolved once, when the palette opens: it is the panel
  // the user was last in, and clicking into the palette must not move it.
  const context = useMemo(
    () => actionContext(doc, resolveTargetNodeId(), maximizedNodeId),
    [doc, maximizedNodeId]
  )
  const entries = useMemo(
    () => paletteEntries(keymap, context, query, platform),
    [keymap, context, query, platform]
  )

  const active = Math.min(cursor, Math.max(entries.length - 1, 0))

  /* Select the remembered query rather than putting a caret after it, so the
     next keystroke replaces it and reopening never means clearing the box
     first. `autoFocus` does the focusing; `select()` does not, reliably. */
  useEffect(() => {
    inputRef.current?.select()
  }, [])

  /* Keep the highlighted row on screen. The list scrolls, and a cursor that
     walks off the bottom of it is a cursor the user has lost.

     `entries` is in the deps although the effect never reads it: filtering
     rebuilds the list under a cursor that may not have moved, and a list left
     scrolled where the mouse put it would then be showing rows the keyboard is
     not on. */
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, entries])

  const run = (id: ActionId): void => {
    // Closed first: several commands hand focus to something they open — the
    // panel rename field, the shortcuts editor — and the palette's own input
    // must be out of the way before they do.
    onClose()
    onRun(id)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!entries.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Wrapping, because the list is long and both ends are a plausible target
      // from either direction.
      setCursor((active + step + entries.length) % entries.length)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setCursor(event.key === 'Home' ? 0 : entries.length - 1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const entry = entries[active]
      if (entry) run(entry.id)
    }
    // Escape is not handled here. It belongs to the chain in `App.tsx`, which
    // decides between abandoning a half-typed sequence, closing this, and
    // leaving panel fullscreen — one place, one order.
  }

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div
        className="palette"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Action palette"
      >
        <input
          ref={inputRef}
          className="input palette-input"
          type="text"
          autoFocus
          placeholder="Type a command…"
          value={query}
          onChange={(event) => {
            lastQuery = event.target.value
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={onKeyDown}
        />

        <div className="palette-list" ref={listRef}>
          {entries.map((entry, index) => (
            <button
              key={entry.id}
              className={`palette-item ${index === active ? 'active' : ''}`}
              data-action-id={entry.id}
              // Pointer, not hover: a list that re-sorts under a stationary
              // mouse would otherwise move the highlight on its own.
              onPointerMove={() => setCursor(index)}
              onClick={() => run(entry.id)}
            >
              <span className="palette-label">{entry.label}</span>
              <span className="palette-category">{entry.category}</span>
              <span className="spacer" />
              {entry.binding && <span className="shortcut">{entry.binding}</span>}
            </button>
          ))}
        </div>

        {entries.length === 0 && <p className="empty">Nothing matches “{query}”.</p>}

        {/* Says why the list is short. Structural commands are filtered out
            while the layout is locked, and a palette that silently drops half
            its rows reads as a broken palette rather than a locked layout. */}
        {context.locked && (
          <p className="note">
            The layout is locked, so splitting, closing and rearranging panels are not listed.
          </p>
        )}
      </div>
    </div>
  )
}

import { useCallback, useLayoutEffect, useRef } from 'react'
import { toggleMark, type Mark } from '../lib/markup'

type TextControl = HTMLInputElement | HTMLTextAreaElement

/**
 * Ctrl+B and Ctrl+I over any text control, shared by table cells and Notes.
 *
 * The selection has to be restored by hand. `toggleMark` inserts characters
 * before the caret, so after React re-renders with the new value the browser
 * would leave the caret wherever the old offsets happen to land — usually at the
 * end — and bolding a word mid-sentence would throw you out of it. The new range
 * is parked in a ref and applied in a layout effect, which is the first moment
 * the DOM holds the text those offsets are measured against.
 *
 * Note that Ctrl+I only ever arrives here because no menu accelerator claims it:
 * a menu accelerator beats the renderer, so binding either stroke to a command
 * takes the formatting with it. See `data:importPack` in `actions.ts`.
 */
export function useMarkupKeys(): (
  event: React.KeyboardEvent<TextControl>,
  value: string,
  apply: (next: string) => void
) => void {
  const pending = useRef<{ element: TextControl; start: number; end: number } | null>(null)

  // No dependency list: this has to run after whichever render commits the new
  // value, and it costs nothing on the renders where nothing is waiting.
  useLayoutEffect(() => {
    const next = pending.current
    if (!next) return
    pending.current = null
    next.element.setSelectionRange(next.start, next.end)
  })

  return useCallback((event, value, apply) => {
    // Alt is excluded so Alt+Ctrl+B stays available to anything else.
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return

    const key = event.key.toLowerCase()
    const mark: Mark | null = key === 'b' ? 'bold' : key === 'i' ? 'italic' : null
    if (!mark) return

    event.preventDefault()
    const element = event.currentTarget
    const result = toggleMark(
      value,
      element.selectionStart ?? value.length,
      element.selectionEnd ?? value.length,
      mark
    )
    pending.current = { element, start: result.selectionStart, end: result.selectionEnd }
    apply(result.text)
  }, [])
}

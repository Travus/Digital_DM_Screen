import { useCallback, useEffect, useRef, useState } from 'react'
import { imageUrl, type ImageRef } from '../../../shared/types'
import {
  clampView,
  FIT_VIEW,
  isFitted,
  panBy,
  readView,
  zoomAt,
  type Size,
  type View
} from '../lib/imageView'
import { defineModule, type ModuleProps } from './types'

interface State extends View {
  /**
   * The image file, not the image.
   *
   * Embedding the bytes would put a megabyte of base64 through the session
   * autosave on every unrelated keystroke, and leave a `.dmscreen` nobody can
   * read. The cost is that a layout carried to another machine finds nothing,
   * which the panel says out loud rather than showing a broken image icon.
   */
  path: string | null
}

/** No settings drawer: fit, zoom and pan are the whole module. */
type Settings = Record<string, never>

const ZERO: Size = { width: 0, height: 0 }

/** Per wheel unit, so a trackpad's small deltas are not violent. */
const WHEEL_STEP = 1.0015
const BUTTON_STEP = 1.4

/**
 * How long a gesture must be quiet before the view reaches panel state.
 *
 * Every write there goes through the store's `mutate`, which marks the layout
 * unsaved and restarts the session autosave debounce. A drag or a wheel spin
 * produces those at pointer rate, so committing each one rewrites the whole
 * document several times a second for a gesture that has not finished. Long
 * enough to coalesce one gesture, short enough that letting go and closing the
 * app keeps the frame.
 */
const COMMIT_DELAY_MS = 250

/** The `alt` text. Not decorative: the image is the whole of what the panel says. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function Image({ state, setState }: ModuleProps<State, Settings>): JSX.Element {
  const [ref, setRef] = useState<ImageRef | null>(null)
  const [natural, setNatural] = useState<Size>(ZERO)
  const [viewport, setViewport] = useState<Size>(ZERO)
  const [view, setView] = useState<View>(() => readView(state))
  /**
   * Set when the file is there and Chromium still would not decode it: a
   * truncated download, or a `.png` that is really something else. Without it
   * the panel goes blank and stays blank, which is the one outcome that looks
   * like the module is broken rather than the file.
   */
  const [failed, setFailed] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  /**
   * The view as of the last gesture event, which is ahead of `view` whenever
   * React has batched two moves into one render. Handlers derive from this
   * rather than from the render they were created in, so a batched frame costs
   * a repaint and not a few pixels of pan.
   */
  const liveRef = useRef(view)
  const pendingRef = useRef<View | null>(null)
  const timerRef = useRef<number | null>(null)

  const commit = useCallback((): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) setState(pending)
  }, [setState])

  /** Moves the view now and writes it to the panel once the gesture settles. */
  const apply = useCallback(
    (next: View): void => {
      liveRef.current = next
      pendingRef.current = next
      setView(next)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(commit, COMMIT_DELAY_MS)
    },
    [commit]
  )

  // Flush on the way out. A panel closed or a module swapped mid-gesture would
  // otherwise drop the last quarter second of it.
  useEffect(() => () => commit(), [commit])

  /* The panel is resizable and can be fullscreened, and both change what "fits"
     means. Measured rather than assumed, because the clamp below needs the box
     as it is now, not as it was when the image loaded. */
  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
    // `failed` is in here because clearing it remounts the viewport: re-picking
    // the file that would not decode leaves the id and `exists` unchanged, and
    // the observer would go on watching the node that just left the DOM.
  }, [ref?.id, ref?.exists, failed])

  /**
   * Ask main for the id, and whether the file is still there.
   *
   * On mount as well as on a pick: a restored panel holds a path from some
   * earlier session, and main's guest list starts every launch empty.
   */
  useEffect(() => {
    let live = true
    setFailed(false)
    if (!state.path) {
      setRef(null)
      return
    }
    void window.dmscreen.resolveImage(state.path).then((resolved) => {
      if (live) setRef(resolved)
    })
    return () => {
      live = false
    }
  }, [state.path])

  /** Everything a fresh image resets, in one place so a pick and a drop agree. */
  const show = useCallback(
    (next: ImageRef | null, path: string | null): void => {
      setRef(next)
      setNatural(ZERO)
      setFailed(false)
      // A fresh image starts fitted. Keeping the old zoom would frame a
      // different picture by numbers that meant something about the last one.
      liveRef.current = FIT_VIEW
      setView(FIT_VIEW)
      setState({ path, ...FIT_VIEW })
    },
    [setState]
  )

  const adopt = useCallback(
    (picked: ImageRef | null): void => {
      if (picked) show(picked, picked.path)
    },
    [show]
  )

  const choose = useCallback((): void => {
    void window.dmscreen.pickImage().then(adopt)
  }, [adopt])

  const clear = (): void => show(null, null)

  const onDrop = useCallback(
    (event: React.DragEvent): void => {
      event.preventDefault()
      const file = event.dataTransfer.files[0]
      if (!file) return
      // Electron 32 removed `File.path`; the bridge is the only route to one now.
      const path = window.dmscreen.pathForFile(file)
      if (path) void window.dmscreen.resolveImage(path).then(adopt)
    },
    [adopt]
  )

  const allowDrop = (event: React.DragEvent): void => event.preventDefault()

  const shown = clampView(view, natural, viewport)
  const zoomed = !isFitted(shown)
  const usable = ref?.exists === true && !failed

  /**
   * Wheel to zoom, on a native listener rather than `onWheel`.
   *
   * React registers its root wheel listener as passive, so `preventDefault` on
   * a synthetic wheel event does nothing — the panel would zoom and scroll at
   * the same time. The listener has to be the element's own to refuse the
   * scroll.
   */
  useEffect(() => {
    const node = viewportRef.current
    if (!node || !usable) return

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const box = node.getBoundingClientRect()
      // From the centre, which is where the transform scales from.
      const point = {
        x: event.clientX - (box.left + box.width / 2),
        y: event.clientY - (box.top + box.height / 2)
      }
      apply(zoomAt(liveRef.current, WHEEL_STEP ** -event.deltaY, point, natural, viewport))
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [apply, natural, viewport, usable])

  /**
   * Drag to pan. The pointer is captured so a fast drag that leaves the panel
   * keeps moving the map rather than stopping dead at the edge.
   */
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent): void => {
    if (!usable || event.button !== 0) return
    dragRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    const from = dragRef.current
    if (!from) return
    dragRef.current = { x: event.clientX, y: event.clientY }
    apply(panBy(liveRef.current, event.clientX - from.x, event.clientY - from.y, natural, viewport))
  }

  const endDrag = (event: React.PointerEvent): void => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    commit()
  }

  const step = (factor: number): void => {
    apply(zoomAt(liveRef.current, factor, { x: 0, y: 0 }, natural, viewport))
    commit()
  }

  const reset = (): void => {
    apply(FIT_VIEW)
    commit()
  }

  if (!state.path || !ref) {
    return (
      <div className="stack fill image-module">
        <div className="image-drop" onDragOver={allowDrop} onDrop={onDrop}>
          <p className="note">Drop an image here, or choose one.</p>
          <button className="btn primary" onClick={choose}>
            Choose image…
          </button>
        </div>
      </div>
    )
  }

  if (!usable) {
    return (
      <div className="stack fill image-module">
        <div className="image-drop" onDragOver={allowDrop} onDrop={onDrop}>
          <p className="image-missing">
            {failed
              ? 'This image is there, but could not be read.'
              : 'This image is not where the layout says it is.'}
          </p>
          {/* The path, because it is the whole of what the DM needs to find the
              file again — and because a layout that travelled to another
              machine looks identical to one whose map was renamed. */}
          <p className="note mono">{ref.path}</p>
          <div className="toolbar">
            <button className="btn primary" onClick={choose}>
              {failed ? 'Choose another…' : 'Locate…'}
            </button>
            <button className="btn" onClick={clear}>
              Remove
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="stack fill image-module">
      <div
        ref={viewportRef}
        className={`image-viewport ${zoomed ? 'zoomed' : ''}`}
        /* Set from `onLoad`, so it is the one thing on screen that says the
           bytes arrived. The `<img>` has a box either way — a smoke shot
           asserting on the element alone would pass against a handler that
           served nothing but a 404. */
        data-loaded={natural.width > 0 ? 'true' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragOver={allowDrop}
        onDrop={onDrop}
        onDoubleClick={reset}
      >
        <img
          className="image-canvas"
          src={imageUrl(ref.id)}
          alt={fileName(ref.path)}
          draggable={false}
          style={{
            transform: `translate(${shown.offsetX}px, ${shown.offsetY}px) scale(${shown.scale})`
          }}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            })
          }
          onError={() => setFailed(true)}
        />
      </div>

      <div className="toolbar">
        <button className="btn" title="Zoom out" onClick={() => step(1 / BUTTON_STEP)}>
          −
        </button>
        <span className="note image-zoom">{Math.round(shown.scale * 100)}%</span>
        <button className="btn" title="Zoom in" onClick={() => step(BUTTON_STEP)}>
          +
        </button>
        <button className="btn" disabled={!zoomed} onClick={reset}>
          Fit
        </button>
        <span className="spacer" />
        <span className="note image-hint">Scroll to zoom · drag to pan · double-click to fit</span>
        <button className="btn" onClick={choose}>
          Change…
        </button>
      </div>
    </div>
  )
}

export const imageModule = defineModule<State, Settings>({
  id: 'image',
  name: 'Image',
  icon: '🖼️',
  blurb: 'A map, a handout or a portrait, held open beside everything else.',
  category: 'Tools',
  defaultState: () => ({ path: null, ...FIT_VIEW }),
  defaultSettings: () => ({}),
  Component: Image
})

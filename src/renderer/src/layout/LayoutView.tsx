import { Fragment, memo, useRef } from 'react'
import type { LayoutNode, SplitNode } from '../../../shared/types'
import { useAppStore } from '../state/store'
import { PanelFrame } from './PanelFrame'

/** Smallest a pane may be dragged to, in pixels. */
const MIN_PANE_PX = 90

/**
 * Memoised: editing inside a panel replaces `doc` but leaves `doc.root`
 * untouched, so the tree skips re-rendering on every keystroke.
 */
export const LayoutView = memo(function LayoutView({ node }: { node: LayoutNode }): JSX.Element {
  if (node.type === 'panel') return <PanelFrame node={node} />
  return <SplitView node={node} />
})

interface DragState {
  index: number
  origin: number
  sizes: number[]
  containerPx: number
}

function SplitView({ node }: { node: SplitNode }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const setSizes = useAppStore((state) => state.setSizes)
  const equalise = useAppStore((state) => state.equalise)
  const locked = useAppStore((state) => state.doc.locked)

  const horizontal = node.direction === 'row'

  const beginDrag = (index: number, event: React.PointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current
    if (!container) return
    dragRef.current = {
      index,
      origin: horizontal ? event.clientX : event.clientY,
      sizes: [...node.sizes],
      containerPx: horizontal ? container.clientWidth : container.clientHeight
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return

    const movedPx = (horizontal ? event.clientX : event.clientY) - drag.origin
    const total = drag.sizes.reduce((sum, size) => sum + size, 0)
    // Sizes are flex weights, so convert the pixel drag into weight units.
    const unitsPerPx = total / Math.max(1, drag.containerPx)
    const min = MIN_PANE_PX * unitsPerPx

    const before = drag.sizes[drag.index]
    const after = drag.sizes[drag.index + 1]
    // Only the two panes either side of this handle move; everything else holds.
    const delta = Math.max(min - before, Math.min(after - min, movedPx * unitsPerPx))

    const next = [...drag.sizes]
    next[drag.index] = before + delta
    next[drag.index + 1] = after - delta
    setSizes(node.id, next)
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div ref={containerRef} className={`split ${node.direction}`}>
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          <div className="pane" style={{ flexGrow: node.sizes[index] ?? 1, flexBasis: 0 }}>
            <LayoutView node={child} />
          </div>
          {index < node.children.length - 1 &&
            // Locked: keep the gap so the tiling doesn't reflow, but drop the
            // grip and every handler — nothing to grab, nothing to nudge.
            (locked ? (
              <div className={`splitter ${node.direction} locked`} />
            ) : (
              <div
                className={`splitter ${node.direction}`}
                role="separator"
                aria-orientation={horizontal ? 'vertical' : 'horizontal'}
                title="Drag to resize · double-click to even out"
                onPointerDown={(event) => beginDrag(index, event)}
                onPointerMove={onDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={() => equalise(node.id)}
              >
                <span className="splitter-grip" />
              </div>
            ))}
        </Fragment>
      ))}
    </div>
  )
}

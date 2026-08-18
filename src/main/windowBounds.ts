/**
 * Where a window opens, worked out in plain numbers.
 *
 * Split from the window handling for the reason `menuPlacement.ts` and
 * `menuTemplate.ts` were split from theirs: what is worth checking here is
 * arithmetic about rectangles, and none of it needs a running app or a second
 * monitor to answer. `index.ts` keeps the two lines that hand the result to
 * Electron.
 */
import type { WindowBounds } from '../shared/types'

/** What a window opens at when nothing is remembered for it. */
export const DEFAULT_SIZE = { width: 1500, height: 950 }

/** Smallest a window may be restored to, matching `minWidth`/`minHeight`. */
const MIN_SIZE = { width: 720, height: 480 }

/** How far a new window is offset from the one it was opened from. */
const CASCADE_STEP = 40

/**
 * Whether a rectangle is worth trying to restore. A window is not a panel: a
 * negative size or a non-finite coordinate would be taken literally by the OS.
 */
export function isUsableBounds(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null) return false
  const bounds = value as Record<string, unknown>
  return (['x', 'y', 'width', 'height'] as const).every(
    (key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key])
  )
}

/**
 * Bring a remembered rectangle back onto a display that exists.
 *
 * The geometry is remembered per machine, and a machine changes: the television
 * gets unplugged, the laptop is docked somewhere else, the layout arrives from
 * another desk. Electron takes an off-screen position literally, so a window
 * restored onto a monitor that is no longer there simply never appears — which
 * reads as the app failing to open rather than as a display having moved.
 *
 * A window that still overlaps a work area is left exactly where it was, since
 * partly off the edge is a place people deliberately put windows. Only one with
 * no overlap at all is moved, and then onto the nearest display rather than a
 * fixed one, so a two-monitor desk does not drag everything back to the primary.
 */
export function clampToDisplays(bounds: WindowBounds, workAreas: WindowBounds[]): WindowBounds {
  const width = Math.max(MIN_SIZE.width, Math.round(bounds.width))
  const height = Math.max(MIN_SIZE.height, Math.round(bounds.height))
  if (workAreas.length === 0) return { ...bounds, width, height }

  const sized = { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height }
  if (workAreas.some((area) => overlaps(sized, area))) return sized

  const nearest = workAreas.reduce((best, area) =>
    distance(sized, area) < distance(sized, best) ? area : best
  )
  return fitInside(sized, nearest)
}

/** A new window, offset from the one it was opened from so it is not hidden by it. */
export function cascadeFrom(
  previous: WindowBounds | null,
  workAreas: WindowBounds[]
): WindowBounds {
  if (!previous) {
    const area = workAreas[0]
    if (!area) return { x: 0, y: 0, ...DEFAULT_SIZE }
    return centreIn(DEFAULT_SIZE, area)
  }
  return clampToDisplays(
    {
      x: previous.x + CASCADE_STEP,
      y: previous.y + CASCADE_STEP,
      width: previous.width,
      height: previous.height
    },
    workAreas
  )
}

function overlaps(a: WindowBounds, b: WindowBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Between the two centres — enough to rank displays, so no square root. */
function distance(a: WindowBounds, b: WindowBounds): number {
  const dx = a.x + a.width / 2 - (b.x + b.width / 2)
  const dy = a.y + a.height / 2 - (b.y + b.height / 2)
  return dx * dx + dy * dy
}

function fitInside(bounds: WindowBounds, area: WindowBounds): WindowBounds {
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    width,
    height,
    x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height))
  }
}

function centreIn(size: { width: number; height: number }, area: WindowBounds): WindowBounds {
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2)
  }
}

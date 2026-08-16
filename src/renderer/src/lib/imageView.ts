/**
 * Zoom and pan for the Image module, as arithmetic.
 *
 * The viewer draws the image with `object-fit: contain` and then transforms it,
 * so scale 1 is always "fits the panel" whatever the panel is. That is the
 * whole reason this is expressed against a *fitted* box rather than the natural
 * pixel size: resizing the panel must not change what the DM is looking at, and
 * a stored zoom of 2 means the same thing on a laptop as on the table screen.
 */

export interface Size {
  width: number
  height: number
}

/** Scale, plus a pan offset in panel pixels applied after the fit. */
export interface View {
  scale: number
  offsetX: number
  offsetY: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 8

export const FIT_VIEW: View = { scale: 1, offsetX: 0, offsetY: 0 }

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

/** Nothing is measurable until the panel has a box and the image has loaded. */
function measurable(image: Size, viewport: Size): boolean {
  return image.width > 0 && image.height > 0 && viewport.width > 0 && viewport.height > 0
}

/**
 * The size the image is drawn at when scale is 1: the `contain` box, which
 * touches the viewport on one axis and leaves letterboxing on the other.
 */
export function fittedSize(image: Size, viewport: Size): Size {
  if (!measurable(image, viewport)) return { width: 0, height: 0 }
  const fit = Math.min(viewport.width / image.width, viewport.height / image.height)
  return { width: image.width * fit, height: image.height * fit }
}

/**
 * How far the image may be dragged on each axis before its edge would come
 * inside the viewport.
 *
 * Zero at scale 1 on both axes, because a contained image never overflows —
 * which is what makes panning a no-op until the DM zooms in, with no separate
 * rule saying so.
 */
export function panLimit(view: View, image: Size, viewport: Size): Size {
  const fitted = fittedSize(image, viewport)
  return {
    width: Math.max(0, (fitted.width * view.scale - viewport.width) / 2),
    height: Math.max(0, (fitted.height * view.scale - viewport.height) / 2)
  }
}

/**
 * Pulls a view back inside its limits. Every other function here ends with this
 * rather than checking as it goes, so a zoom that shrinks the image cannot
 * leave the pan it was paired with pointing off the edge.
 */
export function clampView(view: View, image: Size, viewport: Size): View {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE)
  const limit = panLimit({ ...view, scale }, image, viewport)
  return {
    scale,
    offsetX: clamp(view.offsetX, -limit.width, limit.width),
    offsetY: clamp(view.offsetY, -limit.height, limit.height)
  }
}

/**
 * Zooms by `factor` about a point, given in pixels from the centre of the
 * viewport. Keeping that point still is what makes a wheel zoom feel aimed
 * rather than merely applied: the pixel under the cursor is the one the DM is
 * asking to look at.
 */
export function zoomAt(
  view: View,
  factor: number,
  point: { x: number; y: number },
  image: Size,
  viewport: Size
): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
  // The real ratio, not `factor` — clamping at either end would otherwise slide
  // the image sideways while the scale stayed put.
  const ratio = scale / view.scale
  return clampView(
    {
      scale,
      offsetX: point.x - (point.x - view.offsetX) * ratio,
      offsetY: point.y - (point.y - view.offsetY) * ratio
    },
    image,
    viewport
  )
}

export function panBy(view: View, dx: number, dy: number, image: Size, viewport: Size): View {
  return clampView(
    { ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy },
    image,
    viewport
  )
}

/** True when the view is doing nothing, which is when "Reset" has nothing to do. */
export function isFitted(view: View): boolean {
  return view.scale === 1 && view.offsetX === 0 && view.offsetY === 0
}

/**
 * Reads a view out of persisted panel state.
 *
 * Panel state is user-editable JSON that may also have been written by an older
 * build, so every field is treated as unknown. A NaN reaching the transform
 * blanks the panel with no error anywhere.
 */
export function readView(value: Partial<View> | undefined): View {
  const number = (input: unknown, fallback: number): number =>
    typeof input === 'number' && Number.isFinite(input) ? input : fallback
  return {
    scale: clamp(number(value?.scale, 1), MIN_SCALE, MAX_SCALE),
    offsetX: number(value?.offsetX, 0),
    offsetY: number(value?.offsetY, 0)
  }
}

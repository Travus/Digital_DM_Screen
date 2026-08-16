import { describe, expect, it } from 'vitest'
import {
  clampView,
  fittedSize,
  isFitted,
  MAX_SCALE,
  panBy,
  panLimit,
  readView,
  zoomAt,
  type Size,
  type View
} from './imageView'

/** A wide image in a squarer panel: fits on width, letterboxed top and bottom. */
const image: Size = { width: 800, height: 400 }
const viewport: Size = { width: 400, height: 400 }
const fit: View = { scale: 1, offsetX: 0, offsetY: 0 }

describe('fittedSize', () => {
  it('touches the viewport on the constrained axis', () => {
    expect(fittedSize(image, viewport)).toEqual({ width: 400, height: 200 })
  })

  it('is empty before the image has loaded or the panel has a box', () => {
    expect(fittedSize({ width: 0, height: 0 }, viewport)).toEqual({ width: 0, height: 0 })
    expect(fittedSize(image, { width: 0, height: 0 })).toEqual({ width: 0, height: 0 })
  })
})

describe('panLimit', () => {
  /* The rule that keeps panning from needing a mode: a contained image has
     nowhere to go, so a drag at scale 1 does nothing without a check for it. */
  it('is zero on both axes at scale 1', () => {
    expect(panLimit(fit, image, viewport)).toEqual({ width: 0, height: 0 })
  })

  it('grows with the scale, per axis', () => {
    // 400x200 fitted, doubled to 800x400 in a 400x400 box.
    expect(panLimit({ ...fit, scale: 2 }, image, viewport)).toEqual({ width: 200, height: 0 })
  })
})

describe('clampView', () => {
  it('holds the scale between the ends', () => {
    expect(clampView({ ...fit, scale: 0.2 }, image, viewport).scale).toBe(1)
    expect(clampView({ ...fit, scale: 99 }, image, viewport).scale).toBe(MAX_SCALE)
  })

  it('pulls an offset back to the edge', () => {
    const view = clampView({ scale: 2, offsetX: 5000, offsetY: 5000 }, image, viewport)
    expect(view).toEqual({ scale: 2, offsetX: 200, offsetY: 0 })
  })

  /* Zooming back out with a pan already applied is the case this exists for:
     the limit shrinks under the offset, and an unclamped result leaves the
     image parked off the edge of a panel it now fits inside. */
  it('drops a pan that the new scale no longer allows', () => {
    const zoomed = panBy({ ...fit, scale: 4 }, 400, 0, image, viewport)
    expect(zoomed.offsetX).toBeGreaterThan(0)
    expect(clampView({ ...zoomed, scale: 1 }, image, viewport)).toEqual(fit)
  })
})

describe('zoomAt', () => {
  it('keeps the centre still when zooming from the centre', () => {
    const view = zoomAt(fit, 2, { x: 0, y: 0 }, image, viewport)
    expect(view).toEqual({ scale: 2, offsetX: 0, offsetY: 0 })
  })

  /* The point under the cursor stays under the cursor. Measured rather than
     asserted directly: a point p sits at (p - offset) / scale in image space,
     and that has to come out the same before and after. */
  it('keeps the point under the cursor still', () => {
    const point = { x: 100, y: 40 }
    const before = (point.x - fit.offsetX) / fit.scale
    const view = zoomAt(fit, 2, point, image, viewport)
    expect((point.x - view.offsetX) / view.scale).toBeCloseTo(before, 6)
  })

  /* Clamping the scale without clamping the ratio was the bug here: the image
     slid sideways on every further wheel tick while the zoom stayed at the cap. */
  it('does not drift once the scale is at the cap', () => {
    const capped = zoomAt({ ...fit, scale: MAX_SCALE }, 2, { x: 150, y: 0 }, image, viewport)
    expect(capped.scale).toBe(MAX_SCALE)
    expect(zoomAt(capped, 2, { x: 150, y: 0 }, image, viewport)).toEqual(capped)
  })

  it('returns to a centred fit when zoomed all the way out', () => {
    const zoomed = zoomAt(fit, 4, { x: 180, y: 60 }, image, viewport)
    expect(zoomAt(zoomed, 0.01, { x: 180, y: 60 }, image, viewport)).toEqual(fit)
  })
})

describe('panBy', () => {
  it('moves within the limit and stops at it', () => {
    const view = { scale: 2, offsetX: 0, offsetY: 0 }
    expect(panBy(view, 50, 0, image, viewport).offsetX).toBe(50)
    expect(panBy(view, 900, 0, image, viewport).offsetX).toBe(200)
  })

  it('does nothing on an axis with no room', () => {
    expect(panBy({ scale: 2, offsetX: 0, offsetY: 0 }, 0, 300, image, viewport).offsetY).toBe(0)
  })
})

describe('isFitted', () => {
  it('separates an untouched view from a zoomed one', () => {
    expect(isFitted(fit)).toBe(true)
    expect(isFitted({ ...fit, scale: 1.5 })).toBe(false)
    expect(isFitted({ ...fit, offsetX: 3 })).toBe(false)
  })
})

describe('readView', () => {
  it('fills in a panel that has never been zoomed', () => {
    expect(readView(undefined)).toEqual(fit)
  })

  /* Panel state is hand-editable JSON, and a NaN in the transform blanks the
     panel with nothing logged. */
  it('refuses anything that is not a finite number', () => {
    expect(readView({ scale: Number.NaN, offsetX: Infinity })).toEqual(fit)
    expect(readView({ scale: '3' } as unknown as Partial<View>)).toEqual(fit)
  })

  it('holds a stored scale inside the ends', () => {
    expect(readView({ scale: 500 }).scale).toBe(MAX_SCALE)
    expect(readView({ scale: 0 }).scale).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { cascadeFrom, clampToDisplays, isUsableBounds, DEFAULT_SIZE } from './windowBounds'
import type { WindowBounds } from '../shared/types'

/** A laptop with a television to the right of it, the arrangement this is for. */
const laptop: WindowBounds = { x: 0, y: 0, width: 1920, height: 1040 }
const television: WindowBounds = { x: 1920, y: 0, width: 2560, height: 1440 }

describe('restoring a remembered window position', () => {
  it('leaves a window that is on a display exactly where it was', () => {
    const bounds = { x: 2100, y: 200, width: 1400, height: 900 }
    expect(clampToDisplays(bounds, [laptop, television])).toEqual(bounds)
  })

  /*
   * Partly off the edge is somewhere people deliberately put a window, so it is
   * left alone. Only a window with no overlap at all has actually lost its
   * display.
   */
  it('leaves a window hanging over an edge alone', () => {
    const bounds = { x: -200, y: 100, width: 1000, height: 700 }
    expect(clampToDisplays(bounds, [laptop])).toEqual(bounds)
  })

  // The television is unplugged and the app is launched again. Electron takes an
  // off-screen position literally, so without this the window never appears —
  // which reads as the app failing to start rather than as a monitor having gone.
  it('brings a window back when its display is gone', () => {
    const stranded = { x: 2100, y: 200, width: 1400, height: 900 }
    const restored = clampToDisplays(stranded, [laptop])
    // Pulled fully onto the laptop: 1920 - 1400 across, and 1040 - 900 down,
    // which is above where it sat rather than at the same height.
    expect(restored).toEqual({ x: 520, y: 140, width: 1400, height: 900 })
  })

  it('moves it to the nearest remaining display, not always the first', () => {
    const farRight = { x: 5000, y: 100, width: 800, height: 600 }
    const restored = clampToDisplays(farRight, [laptop, television])
    // The television is the closer of the two, so the window lands on it.
    expect(restored.x).toBeGreaterThanOrEqual(television.x)
  })

  it('shrinks a window too big for the display it lands on', () => {
    const huge = { x: 9000, y: 9000, width: 4000, height: 3000 }
    const restored = clampToDisplays(huge, [laptop])
    expect(restored.width).toBe(laptop.width)
    expect(restored.height).toBe(laptop.height)
  })

  it('refuses to restore a window smaller than the app allows', () => {
    const tiny = { x: 10, y: 10, width: 100, height: 50 }
    const restored = clampToDisplays(tiny, [laptop])
    expect(restored.width).toBe(720)
    expect(restored.height).toBe(480)
  })

  it('survives being asked before any display is known', () => {
    const bounds = { x: 10, y: 20, width: 800, height: 600 }
    expect(clampToDisplays(bounds, [])).toEqual(bounds)
  })
})

describe('placing a new window', () => {
  it('centres the first one on the display', () => {
    const placed = cascadeFrom(null, [laptop])
    expect(placed.width).toBe(DEFAULT_SIZE.width)
    expect(placed.x).toBe(Math.round((laptop.width - DEFAULT_SIZE.width) / 2))
  })

  // Opening one exactly on top of the last is how a second window looks like
  // nothing happened.
  it('offsets the next one from the last', () => {
    const first = cascadeFrom(null, [laptop])
    const second = cascadeFrom(first, [laptop])
    expect(second.x).toBe(first.x + 40)
    expect(second.y).toBe(first.y + 40)
  })

  it('keeps a cascading window on a display', () => {
    const edge = { x: 1900, y: 1000, width: 800, height: 600 }
    const next = cascadeFrom(edge, [laptop])
    expect(next.x + next.width).toBeLessThanOrEqual(laptop.x + laptop.width)
  })
})

describe('reading remembered geometry back off the disk', () => {
  // session.json is a file like any other, and a negative or non-finite size is
  // something the OS takes literally rather than rejecting.
  it('rejects anything that is not four finite numbers', () => {
    expect(isUsableBounds({ x: 0, y: 0, width: 800, height: 600 })).toBe(true)
    expect(isUsableBounds({ x: 0, y: 0, width: 800 })).toBe(false)
    expect(isUsableBounds({ x: 0, y: 0, width: NaN, height: 600 })).toBe(false)
    expect(isUsableBounds({ x: '0', y: 0, width: 800, height: 600 })).toBe(false)
    expect(isUsableBounds(null)).toBe(false)
    expect(isUsableBounds(undefined)).toBe(false)
  })
})

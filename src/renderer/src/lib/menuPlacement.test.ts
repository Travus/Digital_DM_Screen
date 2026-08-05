import { describe, expect, it } from 'vitest'
import { placeMenu, type Rect } from './menuPlacement'

/** Roughly the app at its default size. */
const VIEWPORT = { width: 1500, height: 950 }

/** The ⋯ button, 26px square, at the right edge of a panel header. */
const button = (top: number, right: number): Rect => ({
  top,
  right,
  bottom: top + 26,
  left: right - 26
})

/** The unlocked menu: nine rows and two separators. */
const MENU = { width: 200, height: 307 }

describe('vertical placement', () => {
  it('opens below the button when there is room', () => {
    expect(placeMenu(button(60, 900), MENU, VIEWPORT)).toMatchObject({ top: 90 })
  })

  it('flips above when the space below is too short and above is longer', () => {
    // A panel low in the window: 950 - 826 leaves 124px under the button.
    const placement = placeMenu(button(800, 900), MENU, VIEWPORT)
    expect(placement.top).toBe(800 - 4 - MENU.height)
    expect(placement.maxHeight).toBeUndefined()
  })

  it('stays below when neither side fits, and caps its height instead', () => {
    // Near the top of a window shorter than the menu: flipping would only make
    // it worse, so it opens the expected way and scrolls.
    const placement = placeMenu(button(60, 900), MENU, { width: 1500, height: 260 })
    expect(placement.top).toBe(90)
    expect(placement.maxHeight).toBe(260 - 86 - 4 - 6)
  })

  it('never places itself off the top edge when it flips', () => {
    const placement = placeMenu(button(700, 900), MENU, { width: 1500, height: 760 })
    expect(placement.top).toBeGreaterThanOrEqual(0)
    expect(placement.top + (placement.maxHeight ?? MENU.height)).toBeLessThanOrEqual(700)
  })
})

describe('horizontal placement', () => {
  it('right-aligns with the button', () => {
    expect(placeMenu(button(60, 900), MENU, VIEWPORT).left).toBe(700)
  })

  it('slides back inside the window rather than off the left edge', () => {
    // A panel narrow enough that the button sits under 200px from the left.
    expect(placeMenu(button(60, 120), MENU, VIEWPORT).left).toBe(6)
  })

  it('keeps clear of the right edge when the button is against it', () => {
    expect(placeMenu(button(60, 1499), MENU, VIEWPORT).left).toBe(1500 - 200 - 6)
  })
})

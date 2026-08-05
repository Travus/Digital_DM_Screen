/**
 * Where a menu anchored to a button belongs, in viewport coordinates.
 *
 * The panel menu is positioned `fixed` so it escapes `.panel`'s own
 * `overflow: hidden` — laid out inside the panel it was cut off at the panel
 * edge, which in a short panel put "Close panel" out of reach entirely. Nothing
 * keeps a fixed box inside the window either, so that part is this function's
 * job.
 */

/** The anchoring button's edges, as `getBoundingClientRect` gives them. */
export interface Rect {
  top: number
  right: number
  bottom: number
  left: number
}

export interface Size {
  width: number
  height: number
}

export interface Placement {
  left: number
  top: number
  /** Set only when neither side of the button has room for the whole menu. */
  maxHeight?: number
}

/** Space kept between the menu and its button, and between it and the window. */
const GAP = 4
const MARGIN = 6

export function placeMenu(anchor: Rect, menu: Size, viewport: Size): Placement {
  const below = viewport.height - anchor.bottom - GAP - MARGIN
  const above = anchor.top - GAP - MARGIN

  // Downward is the convention, so flip only where it actually buys room: a
  // menu too tall for either side still opens the way the button suggests.
  const flip = menu.height > below && above > below
  const room = Math.max(flip ? above : below, 0)
  const height = Math.min(menu.height, room)

  return {
    // Right-aligned with the button, then pulled back inside the window.
    left: Math.max(
      MARGIN,
      Math.min(anchor.right - menu.width, viewport.width - menu.width - MARGIN)
    ),
    top: flip ? anchor.top - GAP - height : anchor.bottom + GAP,
    maxHeight: menu.height > room ? room : undefined
  }
}

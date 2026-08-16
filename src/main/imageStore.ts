/**
 * The set of image files the renderer may display, and the ids it names them by.
 *
 * A path in the layout is not enough on its own: the renderer is sandboxed and
 * the CSP does not list `file:`, so main serves the bytes over the
 * `dmscreen-image://` scheme instead. This module is the guest list for that
 * handler. Only a path that arrived through the file dialog, or through a
 * layout the user opened, is ever served — without the list, any string that
 * reached an `<img src>` would name a readable file, which is the file access
 * `sandbox: true` exists to withhold.
 *
 * Deliberately free of Electron imports so it can be unit-tested.
 */
import { createHash } from 'node:crypto'
import { extname } from 'node:path'

/** What Chromium will decode. Anything else is refused at registration. */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_TYPES).map((ext) => ext.slice(1))

export function mimeFor(path: string): string | null {
  return IMAGE_TYPES[extname(path).toLowerCase()] ?? null
}

/**
 * A stable id for a path.
 *
 * Derived rather than minted, so re-registering the same file on the next
 * launch yields the same URL. A fresh id per session would change the `<img>`
 * src on every restore and throw away Chromium's decode of an unchanged file.
 * It is also a hash and not the path itself, so a URL cannot leak where a DM
 * keeps their maps into anything that logs one.
 */
export function imageId(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 32)
}

const served = new Map<string, string>()

/**
 * Adds a path to the guest list. Returns null for anything that is not an image
 * by extension — a caller may pass a path out of a layout file, which is user
 * data and need not be either an image or still there.
 */
export function registerImage(path: string): string | null {
  if (!path || !mimeFor(path)) return null
  const id = imageId(path)
  served.set(id, path)
  return id
}

export function servedPath(id: string): string | null {
  return served.get(id) ?? null
}

/** Test seam. The registry is process-wide otherwise. */
export function clearImages(): void {
  served.clear()
}

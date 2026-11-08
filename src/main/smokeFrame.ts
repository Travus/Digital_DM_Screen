/**
 * Whether a captured frame shows anything at all.
 *
 * `capturePage()` can hand back a frame of the right size that the compositor
 * has not painted yet: the window's background colour and nothing else. It is
 * not empty, so `isEmpty()` passes it, and the expectations ran in the renderer
 * against a DOM that was perfectly fine — so the shot goes green with a blank
 * PNG on disk. Every shot this harness takes has the app's own chrome in it, so
 * a frame that is one colour from corner to corner is never a real picture.
 *
 * Kept out of `smoke.ts`, which holds an Electron handle, so the arithmetic can
 * be tested on its own.
 */
export function isUniformFrame(bitmap: Uint8Array): boolean {
  // Compared a byte at a time against the first pixel rather than through a
  // Uint32Array view: a Buffer's byteOffset is not guaranteed to be aligned to
  // four, and the view would throw on the one that is not.
  for (let i = 4; i < bitmap.length; i += 1) {
    if (bitmap[i] !== bitmap[i % 4]) return false
  }
  return true
}

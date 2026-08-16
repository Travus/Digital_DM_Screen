/**
 * The guest list behind the `dmscreen-image://` handler.
 *
 * The interesting half is what it refuses. Everything the handler will serve
 * has to have been registered, so a registration that lets a non-image through
 * is the whole of the difference between "shows the DM's maps" and "reads any
 * file the renderer names".
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { clearImages, imageId, mimeFor, registerImage, servedPath } from './imageStore'

beforeEach(() => clearImages())

describe('imageId', () => {
  it('is stable for a path', () => {
    expect(imageId('/maps/keep.png')).toBe(imageId('/maps/keep.png'))
  })

  it('separates two paths', () => {
    expect(imageId('/maps/keep.png')).not.toBe(imageId('/maps/crypt.png'))
  })

  it('does not carry the path in the clear', () => {
    expect(imageId('/maps/keep.png')).not.toContain('keep')
  })
})

describe('mimeFor', () => {
  it('reads the extension, whatever its case', () => {
    expect(mimeFor('/maps/Keep.PNG')).toBe('image/png')
    expect(mimeFor('/maps/keep.jpeg')).toBe('image/jpeg')
  })

  it('returns null for anything Chromium will not decode', () => {
    expect(mimeFor('/layouts/party.dmscreen')).toBeNull()
    expect(mimeFor('/etc/passwd')).toBeNull()
    expect(mimeFor('')).toBeNull()
  })
})

describe('registerImage', () => {
  it('serves a path once it is registered, and not before', () => {
    const id = imageId('/maps/keep.png')
    expect(servedPath(id)).toBeNull()
    expect(registerImage('/maps/keep.png')).toBe(id)
    expect(servedPath(id)).toBe('/maps/keep.png')
  })

  /* A layout file is user data: it can name anything at all, and the panel
     state it comes out of was hand-editable JSON a moment earlier. */
  it('refuses a path that is not an image', () => {
    expect(registerImage('/etc/passwd')).toBeNull()
    expect(servedPath(imageId('/etc/passwd'))).toBeNull()
  })

  it('refuses an empty path rather than registering the empty string', () => {
    expect(registerImage('')).toBeNull()
  })

  it('is idempotent, so a restore does not grow the list', () => {
    expect(registerImage('/maps/keep.png')).toBe(registerImage('/maps/keep.png'))
  })
})

describe('servedPath', () => {
  it('returns null for an id nobody registered', () => {
    expect(servedPath('deadbeef')).toBeNull()
  })
})

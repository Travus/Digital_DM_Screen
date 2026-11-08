import { describe, expect, it } from 'vitest'
import { isUniformFrame } from './smokeFrame'

const fill = (pixels: number, bgra: number[]): Uint8Array =>
  Uint8Array.from({ length: pixels * 4 }, (_, i) => bgra[i % 4])

describe('isUniformFrame', () => {
  it('calls a frame of one colour blank', () => {
    expect(isUniformFrame(fill(1000, [0x1e, 0x17, 0x15, 0xff]))).toBe(true)
  })

  it('sees a single pixel that differs', () => {
    const frame = fill(1000, [0x1e, 0x17, 0x15, 0xff])
    frame[4 * 777 + 2] = 0x16
    expect(isUniformFrame(frame)).toBe(false)
  })

  it('sees a difference in the last pixel', () => {
    const frame = fill(1000, [0, 0, 0, 0xff])
    frame[frame.length - 4] = 1
    expect(isUniformFrame(frame)).toBe(false)
  })

  it('compares whole pixels, not bytes against each other', () => {
    // Four channels that differ from each other but repeat exactly: still one colour.
    expect(isUniformFrame(fill(16, [10, 20, 30, 255]))).toBe(true)
  })

  it('reads a buffer that does not start on a four-byte boundary', () => {
    const backing = new Uint8Array(4 * 50 + 1)
    const frame = backing.subarray(1)
    expect(isUniformFrame(frame)).toBe(true)
    frame[9] = 1
    expect(isUniformFrame(frame)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  axisAngle,
  D20_FACES,
  D20_FACE_BOX,
  D20_INRADIUS,
  D20_SPAN,
  dot,
  faceLighting,
  length,
  multiply,
  randomSpin,
  restRotation,
  rotation,
  throwLift,
  throwRotation,
  toMatrix3d,
  transform,
  transpose,
  type Mat3,
  type Vec3
} from './dieSolid'

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** A rotation keeps lengths and right angles, and does not turn the solid inside out. */
function isRotation(m: Mat3): boolean {
  const columns: Vec3[] = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]]
  ]
  const unit = columns.every((column) => Math.abs(length(column) - 1) < 1e-9)
  const square =
    Math.abs(dot(columns[0], columns[1])) < 1e-9 &&
    Math.abs(dot(columns[1], columns[2])) < 1e-9 &&
    Math.abs(dot(columns[0], columns[2])) < 1e-9
  const determinant =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[3] * (m[1] * m[8] - m[2] * m[7]) +
    m[6] * (m[1] * m[5] - m[2] * m[4])
  return unit && square && Math.abs(determinant - 1) < 1e-9
}

/** A run of numbers standing in for Math.random, so a spin is reproducible. */
function sequence(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]
}

describe('the solid', () => {
  it('has twenty faces', () => {
    expect(D20_FACES).toHaveLength(20)
  })

  it('numbers them 1 to 20, once each', () => {
    const values = D20_FACES.map((face) => face.value).sort((a, b) => a - b)
    expect(values).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
  })

  it('puts opposite numbers on opposite faces', () => {
    for (const face of D20_FACES) {
      const opposite = D20_FACES.find((other) => dot(face.normal, other.normal) < -0.99)
      expect(opposite?.value).toBe(21 - face.value)
    }
  })

  it('gives every face a proper rotation for a basis', () => {
    for (const face of D20_FACES) expect(isRotation(face.basis)).toBe(true)
  })

  it('makes the third column of a basis the face normal', () => {
    for (const face of D20_FACES) {
      expect([face.basis[6], face.basis[7], face.basis[8]]).toEqual([...face.normal])
    }
  })

  it('draws each face as a triangle inside its viewBox', () => {
    for (const face of D20_FACES) {
      const pairs = face.points.split(' ')
      expect(pairs).toHaveLength(3)
      for (const pair of pairs) {
        const [x, y] = pair.split(',').map(Number)
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(100)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(100)
      }
    }
  })

  it('stands each triangle on its base, with a corner at the top', () => {
    for (const face of D20_FACES) {
      const ys = face.points.split(' ').map((pair) => Number(pair.split(',')[1]))
      // One corner well above the centre, two below it. CSS y counts downwards.
      expect(ys.filter((y) => y < 50)).toHaveLength(1)
    }
  })
})

describe('the measurements the stylesheet reads', () => {
  it('spans corner to corner, wider than it is deep', () => {
    expect(D20_SPAN).toBeGreaterThan(2 * D20_INRADIUS)
    expect(D20_SPAN).toBeCloseTo(3.8042, 3)
  })

  it('seats every face at the same distance from the centre', () => {
    expect(D20_INRADIUS).toBeCloseTo(1.5115, 3)
  })

  it('sizes a face element so its triangle lands at the radius it is drawn to', () => {
    expect(D20_FACE_BOX).toBeCloseTo(2.4056, 3)
  })
})

describe('axisAngle', () => {
  it('round-trips a rotation back to itself', () => {
    for (const face of D20_FACES) {
      const { axis, angle } = axisAngle(face.basis)
      const rebuilt = rotation(axis, angle)
      for (let i = 0; i < 9; i++) expect(rebuilt[i]).toBeCloseTo(face.basis[i], 9)
    }
  })

  it('names an axis for a rotation that turns nothing', () => {
    expect(axisAngle(IDENTITY)).toEqual({ axis: [0, 0, 1], angle: 0 })
  })
})

describe('multiply and transpose', () => {
  it('undoes a rotation with its transpose', () => {
    const turned = rotation([0.3, 0.9, -0.2], 1.1)
    const back = multiply(transpose(turned), turned)
    for (let i = 0; i < 9; i++) expect(back[i]).toBeCloseTo(IDENTITY[i], 9)
  })

  it('applies the right-hand argument first', () => {
    const quarter = rotation([0, 0, 1], Math.PI / 2)
    const half = rotation([0, 0, 1], Math.PI)
    const combined = transform(multiply(quarter, half), [1, 0, 0])
    const stepwise = transform(quarter, transform(half, [1, 0, 0]))
    for (let i = 0; i < 3; i++) expect(combined[i]).toBeCloseTo(stepwise[i], 9)
  })
})

describe('restRotation', () => {
  it('turns the rolled face towards the camera', () => {
    for (const face of D20_FACES) {
      const normal = transform(restRotation(face.value), face.normal)
      expect(normal[2]).toBeCloseTo(1, 9)
    }
  })

  it('leaves the number upright rather than on its side', () => {
    for (const face of D20_FACES) {
      // A face's second basis column runs down its own front, and CSS y counts
      // downwards, so a face standing upright maps that column onto (0, 1, 0).
      // Anything else reads as a die that landed askew.
      const down = transform(restRotation(face.value), [
        face.basis[3],
        face.basis[4],
        face.basis[5]
      ])
      expect(down[0]).toBeCloseTo(0, 9)
      expect(down[1]).toBeCloseTo(1, 9)
    }
  })

  it('falls back to a real face for a value the die does not have', () => {
    expect(restRotation(99)).toEqual(restRotation(14))
  })
})

describe('throwRotation', () => {
  const rest = restRotation(20)
  const spin = randomSpin(sequence([0.1, 0.7, 0.3, 0.9, 0.2, 0.6, 0.4]))

  it('lands on exactly the resting orientation', () => {
    const landed = throwRotation(rest, spin, 1)
    for (let i = 0; i < 9; i++) expect(landed[i]).toBeCloseTo(rest[i], 9)
  })

  it('is somewhere else on the way there', () => {
    const midway = throwRotation(rest, spin, 0.4)
    const drift = midway.reduce((sum, cell, i) => sum + Math.abs(cell - rest[i]), 0)
    expect(drift).toBeGreaterThan(0.5)
  })

  it('stays a rotation throughout', () => {
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      expect(isRotation(throwRotation(rest, spin, t))).toBe(true)
    }
  })

  it('clamps past the ends rather than spinning on', () => {
    expect(throwRotation(rest, spin, 2)).toEqual(throwRotation(rest, spin, 1))
  })

  it('slows down towards the landing', () => {
    const early = throwRotation(rest, spin, 0.1)
    const earlier = throwRotation(rest, spin, 0.05)
    const late = throwRotation(rest, spin, 0.95)
    const later = throwRotation(rest, spin, 0.9)
    const moved = (a: Mat3, b: Mat3): number =>
      a.reduce((sum, cell, i) => sum + Math.abs(cell - b[i]), 0)
    expect(moved(early, earlier)).toBeGreaterThan(moved(late, later))
  })
})

describe('throwLift', () => {
  it('starts and finishes on the table', () => {
    expect(throwLift(0)).toBeCloseTo(0, 9)
    expect(throwLift(1)).toBeCloseTo(0, 9)
  })

  it('is highest in the middle of the throw', () => {
    expect(throwLift(0.5)).toBeGreaterThan(0.9)
  })
})

describe('faceLighting', () => {
  it('draws one of every opposite pair', () => {
    const light = faceLighting(restRotation(20))
    for (const [index, face] of D20_FACES.entries()) {
      const other = D20_FACES.findIndex((candidate) => dot(face.normal, candidate.normal) < -0.99)
      expect(light[index].visible).not.toBe(light[other].visible)
    }
  })

  it('draws the face that was rolled', () => {
    for (const face of D20_FACES) {
      const index = D20_FACES.indexOf(face)
      expect(faceLighting(restRotation(face.value))[index].visible).toBe(true)
    }
  })

  it('keeps every face off black, so the die reads as one object', () => {
    for (const shade of faceLighting(restRotation(7))) {
      expect(shade.brightness).toBeGreaterThan(0.6)
      expect(shade.brightness).toBeLessThan(1.3)
    }
  })
})

describe('toMatrix3d', () => {
  it('writes a rotation with no translation in it', () => {
    expect(toMatrix3d(IDENTITY)).toBe('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)')
  })
})

describe('randomSpin', () => {
  it('turns a whole number of times, so the landing is exact', () => {
    const spin = randomSpin(sequence([0.5]))
    expect(Number.isInteger(spin.turns)).toBe(true)
    expect(Number.isInteger(spin.otherTurns)).toBe(true)
    expect(spin.turns).toBeGreaterThanOrEqual(3)
  })
})

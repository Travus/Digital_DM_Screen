import { describe, expect, it } from 'vitest'
import {
  axisAngle,
  dot,
  faceLighting,
  length,
  multiply,
  PERCENTILE,
  randomSpin,
  restRotation,
  rotation,
  SOLIDS,
  throwLift,
  throwRotation,
  toMatrix3d,
  transform,
  transpose,
  type DieSolid,
  type Mat3,
  type SolidFace,
  type Vec3
} from './dieSolid'

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Every solid the module can put on screen, named for the failure messages. */
const ALL: [string, DieSolid][] = [
  ...Object.entries(SOLIDS).map(([sides, solid]): [string, DieSolid] => [`d${sides}`, solid]),
  ['percentile tens', PERCENTILE[0]],
  ['percentile units', PERCENTILE[1]]
]

/**
 * The dice numbered the way a real one is: opposite faces summing to one more
 * than the face count. The tetrahedron has no opposite faces, and the
 * percentile pair count in tens and from zero, so all three are asked
 * different questions below.
 */
const PAIRED: [string, DieSolid][] = [6, 8, 10, 12, 20].map((sides) => [
  `d${sides}`,
  SOLIDS[sides as 6 | 8 | 10 | 12 | 20]
])

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

function opposite(die: DieSolid, face: SolidFace): SolidFace | undefined {
  return die.faces.find((other) => dot(face.normal, other.normal) < -0.99)
}

describe.each(ALL)('%s, as a solid', (_name, die) => {
  it('gives every face a proper rotation for a basis', () => {
    for (const face of die.faces) expect(isRotation(face.basis)).toBe(true)
  })

  it('makes the third column of a basis the face normal', () => {
    for (const face of die.faces) {
      expect([face.basis[6], face.basis[7], face.basis[8]]).toEqual([...face.normal])
    }
  })

  it('round-trips every basis through its axis and angle', () => {
    for (const face of die.faces) {
      const { axis, angle } = axisAngle(face.basis)
      const rebuilt = rotation(axis, angle)
      for (let i = 0; i < 9; i++) expect(rebuilt[i]).toBeCloseTo(face.basis[i], 9)
    }
  })

  /*
    The one that matters for the d10. Its kite is planar only because the
    zigzag equator sits at exactly `APEX · tan²(18°)`; at any other radius the
    four corners are not coplanar, the face drawn through them is a projection
    of a fold, and the die develops visible gaps no screenshot would obviously
    explain.
  */
  it('keeps every face flat', () => {
    for (const face of die.faces) {
      const depths = face.corners.map((corner) => dot(corner, face.normal))
      for (const depth of depths) expect(depth).toBeCloseTo(depths[0], 9)
    }
  })

  it('seats every face at the same distance from the centre', () => {
    for (const face of die.faces) {
      expect(dot(face.corners[0], face.normal)).toBeCloseTo(die.inradius, 9)
    }
  })

  it('points every normal outwards', () => {
    for (const face of die.faces) {
      // Outward means agreeing with the direction of the face's own centre,
      // which for a solid centred on the origin is the same thing.
      expect(dot(face.corners[0], face.normal)).toBeGreaterThan(0)
    }
  })

  it('draws each face inside its own viewBox', () => {
    for (const face of die.faces) {
      const pairs = face.points.split(' ')
      expect(pairs).toHaveLength(face.corners.length)
      for (const pair of pairs) {
        const [x, y] = pair.split(',').map(Number)
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(100)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(100)
      }
    }
  })

  /* A polygon walked out of order is a bowtie: a star shape that self-crosses
     and shades as though it had a hole in it. Convexity is what rules it out. */
  it('walks each face round rather than across it', () => {
    for (const face of die.faces) {
      const points = face.points.split(' ').map((pair) => pair.split(',').map(Number))
      const turns = points.map((point, index) => {
        const next = points[(index + 1) % points.length]
        const after = points[(index + 2) % points.length]
        const a = [next[0] - point[0], next[1] - point[1]]
        const b = [after[0] - next[0], after[1] - next[1]]
        return Math.sign(a[0] * b[1] - a[1] * b[0])
      })
      expect(new Set(turns).size).toBe(1)
    }
  })

  it('prints something on every face', () => {
    for (const face of die.faces) {
      expect(face.labels.length).toBeGreaterThan(0)
      for (const label of face.labels) {
        expect(label.text).toMatch(/^\d+$/)
        expect(label.x).toBeGreaterThan(0)
        expect(label.x).toBeLessThan(100)
        expect(label.y).toBeGreaterThan(0)
        expect(label.y).toBeLessThan(100)
      }
    }
  })

  /*
    `span` is how wide the die looks standing still, so it has to *hold* at
    rest — nothing may poke outside the box the stylesheet fits it to — while
    still being tight enough to be worth using: a bounding sphere would pass the
    first half of this and fail the second, which is what it used to do.
  */
  it('fits inside the span the stylesheet sizes it by, at every rest', () => {
    for (const value of die.rests.keys()) {
      const rest = restRotation(die, value)
      for (const face of die.faces) {
        for (const corner of face.corners) {
          const [x, y] = transform(rest, corner)
          expect(2 * Math.hypot(x, y)).toBeLessThanOrEqual(die.span + 1e-9)
        }
      }
    }
  })

  it('measures a span the die nearly fills, rather than a sphere around it', () => {
    const sphere = 2 * Math.max(...die.faces.flatMap((face) => face.corners.map(length)))
    expect(die.span).toBeGreaterThan(sphere * 0.55)
    expect(die.span).toBeLessThanOrEqual(sphere + 1e-9)
  })

  /* The shrink the stylesheet applies at the top of a throw is exactly what
     buys back the difference, so it has to be that difference. */
  it('reports a swing that covers everything the span leaves out', () => {
    const sphere = 2 * Math.max(...die.faces.flatMap((face) => face.corners.map(length)))
    expect(die.swing).toBeCloseTo(sphere / die.span, 9)
    expect(die.swing).toBeGreaterThanOrEqual(1)
    expect(die.span * die.swing).toBeCloseTo(sphere, 9)
  })

  it('rests on a face it actually has', () => {
    expect(die.rests.has(die.restingValue)).toBe(true)
  })

  it('gives every value a resting orientation, and every orientation a value', () => {
    const values = die.faces.map((face) => face.value)
    expect([...die.rests.keys()].sort((a, b) => a - b)).toEqual([...values].sort((a, b) => a - b))
    for (const rest of die.rests.values()) expect(isRotation(rest)).toBe(true)
  })

  /*
    Three faces is the threshold for reading as a solid rather than as a
    picture of one. It is also the whole reason the d6 is tilted: a cube's
    neighbours meet it at exactly 90°, so square to the camera it shows one
    face and `faceLighting` correctly drops the rest.
  */
  it('shows at least three faces at rest', () => {
    for (const value of die.rests.keys()) {
      const lit = faceLighting(die, restRotation(die, value)).filter((shade) => shade.visible)
      expect(lit.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps every face off black, so the die reads as one object', () => {
    for (const shade of faceLighting(die, restRotation(die, die.restingValue))) {
      expect(shade.brightness).toBeGreaterThan(0.6)
      expect(shade.brightness).toBeLessThan(1.3)
    }
  })

  it('falls back to its resting face for a value it does not have', () => {
    expect(restRotation(die, 999)).toEqual(restRotation(die, die.restingValue))
  })
})

describe.each(PAIRED)('%s, numbered as a die', (_name, die) => {
  it('numbers its faces 1 to n, once each', () => {
    const values = die.faces.map((face) => face.value).sort((a, b) => a - b)
    expect(values).toEqual(Array.from({ length: die.faces.length }, (_, index) => index + 1))
  })

  it('puts opposite numbers on opposite faces', () => {
    for (const face of die.faces) {
      expect(opposite(die, face)?.value).toBe(die.faces.length + 1 - face.value)
    }
  })

  it('turns the rolled face towards the camera', () => {
    for (const face of die.faces) {
      const normal = transform(restRotation(die, face.value), face.normal)
      /*
        Square on, except for the d6, which says why in `D6_TILT`: a cube shown
        square to the camera has no depth at all. Its number's own face comes to
        rest around 32° off — far enough for the two beside it to read as the
        sides of a cube, near enough to leave the number legible. Pinned rather
        than loosely bounded, because that balance is the whole of the choice.
      */
      if (die.kind === 'd6') expect(Math.acos(normal[2])).toBeCloseTo(0.556, 2)
      else expect(normal[2]).toBeGreaterThan(0.999999)
    }
  })

  it('draws the face that was rolled, and never its opposite', () => {
    for (const [index, face] of die.faces.entries()) {
      const lit = faceLighting(die, restRotation(die, face.value))
      expect(lit[index].visible).toBe(true)
      const other = die.faces.indexOf(opposite(die, face) as SolidFace)
      expect(lit[other].visible).toBe(false)
    }
  })

  it('leaves the number upright rather than on its side', () => {
    for (const face of die.faces) {
      // A face's second basis column runs down its own front, and CSS y counts
      // downwards, so a face standing upright maps that column onto (0, 1, 0).
      // Anything else reads as a die that landed askew. The d6's tilt puts it
      // a few degrees off, which is the point of the tilt.
      const down = transform(restRotation(die, face.value), [
        face.basis[3],
        face.basis[4],
        face.basis[5]
      ])
      expect(down[1]).toBeGreaterThan(die.kind === 'd6' ? 0.9 : 0.999999)
    }
  })
})

describe('the d20', () => {
  const die = SOLIDS[20]

  it('has twenty faces, every one a triangle', () => {
    expect(die.faces).toHaveLength(20)
    for (const face of die.faces) expect(face.corners).toHaveLength(3)
  })

  /* Pinned rather than derived a second time: these are what the stylesheet
     sizes the die by, and a change in any of them is a change in how big the
     die comes out. The icosahedron is nearly a ball, so its span is nearly its
     sphere and there is almost nothing for the swing to give back. */
  it('measures as it always has', () => {
    expect(die.span).toBeCloseTo(3.7367, 3)
    expect(die.swing).toBeCloseTo(1.0181, 3)
    expect(die.inradius).toBeCloseTo(1.5115, 3)
    expect(die.faceBox).toBeCloseTo(2.4056, 3)
  })

  it('stands each triangle on its base, with a corner at the top', () => {
    for (const face of die.faces) {
      const ys = face.points.split(' ').map((pair) => Number(pair.split(',')[1]))
      // One corner well above the centre, two below it. CSS y counts downwards.
      expect(ys.filter((y) => y < 50)).toHaveLength(1)
    }
  })
})

describe('the d6', () => {
  const die = SOLIDS[6]

  /*
    The one solid whose faces are squared to the *die's* up axis rather than to
    a corner of their own. Any edge of a square is as good as the other three,
    so left to pick one each face lands on an arbitrary quarter turn — and on a
    cube, where three faces meet at right angles in plain view, that reads as
    numbers lying on their sides for no reason.

    Asserted as agreement rather than as absolute angles: what matters is that
    the four faces around the up axis point the same way, not which way.
  */
  it('squares the four side faces to one shared up axis', () => {
    const sides = die.faces.filter((face) => Math.abs(face.normal[1]) < 0.5)
    expect(sides).toHaveLength(4)
    for (const face of sides) {
      // A face's second basis column runs down its own front. Squared to the
      // die's up axis, that column *is* the die's down axis. Compared loosely
      // because half of these come out as negative zero.
      expect(face.basis[3]).toBeCloseTo(0, 9)
      expect(face.basis[4]).toBeCloseTo(1, 9)
      expect(face.basis[5]).toBeCloseTo(0, 9)
    }
  })

  it('gives the top and bottom the depth axis, which is what a real die does', () => {
    const caps = die.faces.filter((face) => Math.abs(face.normal[1]) > 0.5)
    expect(caps).toHaveLength(2)
    for (const face of caps) {
      // No up axis to lie along, so the number's top points at the viewer —
      // look down at a die and you read its top face with the front at the
      // bottom.
      const down: Vec3 = [face.basis[3], face.basis[4], face.basis[5]]
      expect(Math.abs(down[2])).toBeCloseTo(1, 9)
    }
  })

  /* A cube square to the camera shows one face and nothing else, so the tilt is
     load-bearing rather than decorative. Three is the threshold for reading as
     a solid; more than four would mean it had turned past its own corner. */
  it('rests showing three faces, which is what the tilt is for', () => {
    for (const value of die.rests.keys()) {
      const lit = faceLighting(die, restRotation(die, value)).filter((shade) => shade.visible)
      expect(lit).toHaveLength(3)
    }
  })
})

describe('the other shapes', () => {
  it('builds a cube, an octahedron, a trapezohedron and a dodecahedron', () => {
    expect(SOLIDS[6].faces.map((face) => face.corners.length)).toEqual(Array(6).fill(4))
    expect(SOLIDS[8].faces.map((face) => face.corners.length)).toEqual(Array(8).fill(3))
    expect(SOLIDS[10].faces.map((face) => face.corners.length)).toEqual(Array(10).fill(4))
    expect(SOLIDS[12].faces.map((face) => face.corners.length)).toEqual(Array(12).fill(5))
  })

  /* A trapezohedron is two apexes and a ring, not a barrel: the ring vertices
     have to sit nearer the equator than the apexes do to the poles, or the
     kites stop being kites. */
  it('gives the d10 two apexes and a zigzag equator', () => {
    const zs = new Set(
      SOLIDS[10].faces.flatMap((face) => face.corners.map((corner) => corner[2].toFixed(4)))
    )
    expect(zs.size).toBe(4)
    const sorted = [...zs].map(Number).sort((a, b) => a - b)
    expect(sorted[0]).toBeCloseTo(-sorted[3], 9)
    expect(sorted[1]).toBeCloseTo(-sorted[2], 9)
    expect(Math.abs(sorted[1])).toBeLessThan(Math.abs(sorted[0]))
  })
})

describe('the d4, read at its apex', () => {
  const die = SOLIDS[4]

  it('has four triangles and four results', () => {
    expect(die.faces).toHaveLength(4)
    expect([...die.rests.keys()].sort()).toEqual([1, 2, 3, 4])
  })

  it('prints three numbers on every face, one per corner', () => {
    for (const face of die.faces) {
      expect(face.labels).toHaveLength(3)
      const printed = face.labels.map((label) => Number(label.text)).sort()
      // A face touches three of the four vertices, so it carries every number
      // but the one at the vertex opposite it — which is the face's own name.
      expect(printed).toEqual([1, 2, 3, 4].filter((value) => value !== face.value))
    }
  })

  /*
    The convention, pinned. A tetrahedron has no face pointing anywhere useful,
    so a real d4 is read either at the apex or along the bottom edge. This one
    reads the apex, and at rest that apex points at the camera — so the thrown
    number is on all three visible faces and nowhere else, and the one face
    turned away is the one named after it.
  */
  it('shows the thrown number on every visible face', () => {
    for (const value of [1, 2, 3, 4]) {
      const lit = faceLighting(die, restRotation(die, value))
      const visible = die.faces.filter((_, index) => lit[index].visible)
      expect(visible).toHaveLength(3)
      expect(visible.map((face) => face.value).sort()).toEqual(
        [1, 2, 3, 4].filter((other) => other !== value)
      )
      for (const face of visible) {
        expect(face.labels.map((label) => label.text)).toContain(String(value))
      }
    }
  })

  /*
    Each number has its top turned into the corner it belongs to, which is how
    the moulds print them — so the three copies of a thrown number radiate from
    the point you read them at. A triangle's corners are 120° apart, so its
    three numbers are too, and one of them always comes out upright: the corner
    the face was stood up by.
  */
  it('turns each number up towards the corner it belongs to', () => {
    for (const face of die.faces) {
      const angles = face.labels
        .map((label) => ((label.angle % 360) + 360) % 360)
        .sort((a, b) => a - b)
      expect(angles[0]).toBeCloseTo(0, 6)
      expect(angles[1]).toBeCloseTo(120, 4)
      expect(angles[2]).toBeCloseTo(240, 4)
    }
  })

  it('pulls each number in from its corner rather than onto it', () => {
    for (const face of die.faces) {
      for (const label of face.labels) {
        const from = Math.hypot(label.x - 50, label.y - 50)
        expect(from).toBeGreaterThan(10)
        expect(from).toBeLessThan(40)
      }
    }
  })
})

describe('the percentile pair', () => {
  it('is the same shape twice', () => {
    expect(PERCENTILE[0].span).toBe(PERCENTILE[1].span)
    expect(PERCENTILE[0].faces.map((face) => face.points)).toEqual(
      PERCENTILE[1].faces.map((face) => face.points)
    )
  })

  it('counts the tens in tens, from zero, printed as two digits', () => {
    const values = PERCENTILE[0].faces.map((face) => face.value).sort((a, b) => a - b)
    expect(values).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
    const zero = PERCENTILE[0].faces.find((face) => face.value === 0)
    expect(zero?.labels[0].text).toBe('00')
  })

  it('counts the units from zero', () => {
    const values = PERCENTILE[1].faces.map((face) => face.value).sort((a, b) => a - b)
    expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('puts opposite numbers opposite, the way a real percentile pair is cut', () => {
    for (const face of PERCENTILE[0].faces) {
      expect(opposite(PERCENTILE[0], face)?.value).toBe(90 - face.value)
    }
    for (const face of PERCENTILE[1].faces) {
      expect(opposite(PERCENTILE[1], face)?.value).toBe(9 - face.value)
    }
  })

  it('names the two dice apart, so CSS can size their numbers apart', () => {
    expect(PERCENTILE[0].kind).not.toBe(PERCENTILE[1].kind)
    expect(new Set(ALL.map(([, die]) => die.kind)).size).toBe(ALL.length)
  })
})

describe('axisAngle', () => {
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

describe('throwRotation', () => {
  const rest = restRotation(SOLIDS[20], 20)
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

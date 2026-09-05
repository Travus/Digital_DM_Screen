/**
 * The d20 as a solid, expressed as arithmetic.
 *
 * The Big Dice module draws a real icosahedron out of twenty SVG triangles on
 * `transform-style: preserve-3d`. Everything deciding where a face sits, which
 * face the die comes to rest on, and how lit each one is, lives here as pure
 * functions — so the module is left with the DOM and none of the geometry.
 *
 * WebGL was the alternative and it loses on cost: a library, a physics engine to
 * make the tumble worth having, a GPU context per panel in every window, and the
 * interesting half of the module moved somewhere no unit test can reach it.
 *
 * The frame is CSS's: x right, y *down*, z out of the screen. Rotations are
 * 3×3 and column-major, which is the order `matrix3d()` reads them in.
 */

export type Vec3 = readonly [number, number, number]

/** A rotation, column-major: `m[column * 3 + row]`. */
export type Mat3 = readonly number[]

export interface SolidFace {
  /** The number printed on this face. */
  value: number
  /** Rotation taking the face's own frame into the die's. Its third column is `normal`. */
  basis: Mat3
  /** Outward unit normal, in the die's frame. */
  normal: Vec3
  /** Axis and angle of `basis`, for a CSS `rotate3d()`. */
  axis: Vec3
  angle: number
  /** `points` for the face triangle, in a 0–100 viewBox. */
  points: string
}

export interface Spin {
  axis: Vec3
  otherAxis: Vec3
  turns: number
  otherTurns: number
}

export interface FaceLight {
  visible: boolean
  brightness: number
}

/** How long a throw runs. */
export const THROW_MS = 1240

/** The face the die rests on before anything has been thrown. */
export const RESTING_VALUE = 14

/**
 * The face triangle's circumradius inside its own 0–100 viewBox. Every other
 * measurement scales off this, so the die has exactly one size constant.
 */
const FACE_RADIUS = 48

/**
 * Faces are drawn a little oversized so neighbours overlap. Cut to their exact
 * edges, the hairline seams between them let you see through the solid.
 */
const FACE_OVERLAP = 1.025

/** Unlit and fully lit. A face never goes black: the die reads as one object. */
const AMBIENT = 0.66
const DIFFUSE = 0.62

/** A face turned this far from the camera is not drawn at all. */
const FACING = 0.02

/* ------------------------------------------------------------------ vectors */

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a))
}

function normalise(a: Vec3): Vec3 {
  const l = length(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Where the light sits. `y` is negative because CSS y points down. */
const LIGHT: Vec3 = normalise([-0.42, -0.72, 0.55])

/* ----------------------------------------------------------------- matrices */

/** `b` first, then `a`, as one rotation. Column-major throughout. */
export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) {
      out[column * 3 + row] =
        a[row] * b[column * 3] + a[3 + row] * b[column * 3 + 1] + a[6 + row] * b[column * 3 + 2]
    }
  }
  return out
}

/** The inverse of a rotation, which for a rotation is its transpose. */
export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

export function transform(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2]
  ]
}

/** Rodrigues, straight into column-major. */
export function rotation(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = normalise(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c
  ]
}

/**
 * A rotation as an axis and an angle, by way of a quaternion.
 *
 * Going through the quaternion rather than reading the trace directly is what
 * keeps a half-turn from dividing by zero — several of the twenty face bases
 * land near one.
 */
export function axisAngle(m: Mat3): { axis: Vec3; angle: number } {
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = m
  const trace = m00 + m11 + m22
  let w: number
  let x: number
  let y: number
  let z: number

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    w = 0.25 * s
    x = (m21 - m12) / s
    y = (m02 - m20) / s
    z = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    w = (m21 - m12) / s
    x = 0.25 * s
    y = (m01 + m10) / s
    z = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    w = (m02 - m20) / s
    x = (m01 + m10) / s
    y = 0.25 * s
    z = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    w = (m10 - m01) / s
    x = (m02 + m20) / s
    y = (m12 + m21) / s
    z = 0.25 * s
  }

  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, w)))
  // No rotation leaves no axis to speak of, so name one rather than dividing
  // three zeroes by a fourth.
  return length([x, y, z]) < 1e-9
    ? { axis: [0, 0, 1], angle: 0 }
    : { axis: normalise([x, y, z]), angle }
}

/** A rotation as the CSS function that applies it. */
export function toMatrix3d(m: Mat3): string {
  const cells = [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1]
  return `matrix3d(${cells.map((cell) => Number(cell.toFixed(6))).join(',')})`
}

/**
 * A face's own placement, as the CSS that applies it.
 *
 * `rotate3d` then `translateZ` rather than one `matrix3d`: the rotation is a
 * constant, but the distance out is a length that has to scale with the panel,
 * and only this form lets the stylesheet own it.
 */
export function toRotate3d(face: SolidFace): string {
  const [x, y, z] = face.axis.map((cell) => Number(cell.toFixed(6)))
  const degrees = Number(((face.angle * 180) / Math.PI).toFixed(4))
  return `rotate3d(${x}, ${y}, ${z}, ${degrees}deg)`
}

/* -------------------------------------------------------------- the solid */

/** Cyclic permutations of (0, ±1, ±φ). Edge length is 2. */
function vertices(): Vec3[] {
  const phi = (1 + Math.sqrt(5)) / 2
  const out: Vec3[] = []
  for (const p of [1, -1]) {
    for (const q of [1, -1]) {
      out.push([0, p, q * phi], [p, q * phi, 0], [p * phi, 0, q])
    }
  }
  return out
}

interface RawFace {
  corners: [Vec3, Vec3, Vec3]
  centroid: Vec3
  normal: Vec3
}

/**
 * A face is any triple of vertices whose three edges are all the shortest edge.
 * The next distance up in an icosahedron is 2φ, so the test has room to spare.
 */
function rawFaces(corners: Vec3[]): RawFace[] {
  const out: RawFace[] = []
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      for (let k = j + 1; k < corners.length; k++) {
        const trio: [Vec3, Vec3, Vec3] = [corners[i], corners[j], corners[k]]
        const edges = [
          length(subtract(trio[0], trio[1])),
          length(subtract(trio[1], trio[2])),
          length(subtract(trio[0], trio[2]))
        ]
        if (!edges.every((edge) => edge < 2.01)) continue

        const centroid: Vec3 = [
          (trio[0][0] + trio[1][0] + trio[2][0]) / 3,
          (trio[0][1] + trio[1][1] + trio[2][1]) / 3,
          (trio[0][2] + trio[1][2] + trio[2][2]) / 3
        ]
        // The solid is centred on the origin, so a face's centroid points the
        // same way its normal does.
        out.push({ corners: trio, centroid, normal: normalise(centroid) })
      }
    }
  }
  return out
}

/**
 * Numbers a solid so opposite faces sum to one more than its face count, which
 * is how a real die is numbered. The sides of this one are visible, so an
 * arbitrary arrangement is something you could sit and notice.
 */
function numberFaces(normals: Vec3[]): number[] {
  const total = normals.length
  const numbers = new Array<number>(total).fill(0)
  let next = 1

  for (let i = 0; i < total; i++) {
    if (numbers[i]) continue
    const opposite = normals.findIndex((other, j) => j !== i && dot(normals[i], other) < -0.99)
    numbers[i] = next
    if (opposite >= 0) numbers[opposite] = total + 1 - next
    next++
    while (next <= total && numbers.includes(next)) next++
  }
  return numbers
}

const CORNERS = vertices()
const RAW = rawFaces(CORNERS)
const NUMBERS = numberFaces(RAW.map((face) => face.normal))

function describe(face: RawFace, index: number): SolidFace {
  const { corners, centroid, normal } = face
  const toCorner = normalise(subtract(corners[0], centroid))
  // X across and Y *up the screen*. CSS y points down, so Y is the negated
  // corner direction, which stands the triangle on its base rather than
  // leaving it pointing to the right.
  const axisX = cross(normal, toCorner)
  const axisY: Vec3 = [-toCorner[0], -toCorner[1], -toCorner[2]]
  const basis: Mat3 = [...axisX, ...axisY, ...normal]
  const scale = FACE_RADIUS / length(subtract(corners[0], centroid))

  const points = corners
    .map((corner) => {
      const offset = subtract(corner, centroid)
      const x = 50 + dot(offset, axisX) * scale * FACE_OVERLAP
      const y = 50 + dot(offset, axisY) * scale * FACE_OVERLAP
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return { value: NUMBERS[index], basis, normal, points, ...axisAngle(basis) }
}

/**
 * The twenty faces, built once at load.
 *
 * Deriving them beats twenty hand-copied matrices: the derivation is the thing
 * a test can hold to account, and a table of 180 floats is not.
 */
export const D20_FACES: readonly SolidFace[] = Object.freeze(RAW.map(describe))

/**
 * The three measurements the stylesheet needs, in the units the vertices are
 * given in. They cross into CSS as custom properties rather than being written
 * out again there, because a second copy of a number is a second copy to get
 * wrong.
 */
/** The solid's widest span, which is what the die is fitted to. */
export const D20_SPAN = 2 * length(CORNERS[0])
/** How far each face sits from the centre of the solid. */
export const D20_INRADIUS = length(RAW[0].centroid)
/** A face element's width, given its triangle is drawn at `FACE_RADIUS`. */
export const D20_FACE_BOX =
  (100 * length(subtract(RAW[0].corners[0], RAW[0].centroid))) / FACE_RADIUS

/* ------------------------------------------------------------ orientation */

// Bringing a face to the camera means undoing its own basis: the face then lies
// in the screen plane, upright, with its number facing out.
const REST_BY_VALUE = new Map<number, Mat3>(
  D20_FACES.map((face) => [face.value, transpose(face.basis)])
)

export function restRotation(value: number): Mat3 {
  return REST_BY_VALUE.get(value) ?? REST_BY_VALUE.get(RESTING_VALUE) ?? D20_FACES[0].basis
}

/** Fast, then slowing hard. */
function eased(t: number): number {
  return 1 - (1 - t) ** 4
}

/**
 * Where the die is, `t` of the way through a throw.
 *
 * The spin is composed *onto* the resting orientation as a whole number of
 * turns decaying to zero, so at `t = 1` it is the resting orientation exactly.
 * Interpolating towards the rest instead leaves the die a degree or two off the
 * number the readout claims, which is the one error nobody would forgive.
 */
export function throwRotation(rest: Mat3, spin: Spin, t: number): Mat3 {
  const remaining = 1 - eased(Math.max(0, Math.min(1, t)))
  return multiply(
    rotation(spin.axis, spin.turns * 2 * Math.PI * remaining),
    multiply(rotation(spin.otherAxis, spin.otherTurns * 2 * Math.PI * remaining), rest)
  )
}

/** How high the die is off the table, from 0 at the throw to 0 at the landing. */
export function throwLift(t: number): number {
  return Math.sin(Math.PI * Math.max(0, Math.min(1, t)) ** 0.85)
}

export function randomSpin(random: () => number = Math.random): Spin {
  const axis = (): Vec3 => [random() - 0.5, random() - 0.5, random() - 0.5]
  return { axis: axis(), otherAxis: axis(), turns: 3 + Math.floor(random() * 2), otherTurns: 2 }
}

/* --------------------------------------------------------------- lighting */

/**
 * How lit each face is, and whether it is drawn at all.
 *
 * The same dot product does both jobs. A convex solid needs no depth sorting if
 * the faces pointing away are simply absent, which is also why this does not
 * lean on `backface-visibility` reaching an SVG element.
 */
export function faceLighting(current: Mat3): FaceLight[] {
  return D20_FACES.map((face) => {
    const normal = transform(current, face.normal)
    return {
      visible: normal[2] > FACING,
      brightness: AMBIENT + DIFFUSE * Math.max(0, dot(normal, LIGHT))
    }
  })
}

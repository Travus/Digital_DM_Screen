/**
 * Every die as a solid, expressed as arithmetic.
 *
 * The Big Dice module draws real polyhedra out of SVG faces on
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

/** One number printed on a face, in the face's own 0–100 viewBox. */
export interface FaceLabel {
  text: string
  x: number
  y: number
  /** Degrees clockwise about (x, y). Zero is upright; the d4 is why it exists. */
  angle: number
}

export interface SolidFace {
  /** The result this face stands for. On the d4 that is a vertex's number. */
  value: number
  /** Rotation taking the face's own frame into the die's. Its third column is `normal`. */
  basis: Mat3
  /** Outward unit normal, in the die's frame. */
  normal: Vec3
  /** Axis and angle of `basis`, for a CSS `rotate3d()`. */
  axis: Vec3
  angle: number
  /** `points` for the face polygon, in a 0–100 viewBox. */
  points: string
  /** What is printed on the face. One number everywhere but the d4's three. */
  labels: readonly FaceLabel[]
  /**
   * The face's corners in the die's frame. Nothing draws from these — `points`
   * is their projection — but they are the only way a test can ask whether a
   * face is actually flat, which is a real question for the d10's kite: its
   * zigzag equator is planar at exactly one radius and nowhere else.
   */
  corners: readonly Vec3[]
}

export interface DieSolid {
  /** Names the die in CSS (`.bigdice-scene.d12`) and in React keys. */
  kind: string
  faces: readonly SolidFace[]
  /**
   * How wide the die looks *at rest*, which is what it is fitted to.
   *
   * Not the bounding sphere, which is what this was and which sizes dice by
   * something you cannot see: a cube's corners stick out half again as far as
   * its faces, so fitted that way a d6 came out at 60% of the box while a d20
   * filled 92% of it, and the two read as different sizes sitting side by side.
   */
  span: number
  /**
   * How much wider the die gets mid-throw, as a multiple of `span`.
   *
   * The bounding sphere has to be paid for somewhere, and this is where: fitting
   * to the resting width means a tumbling die would overrun its panel, so the
   * stylesheet shrinks it by this much at the top of its arc. That reads as a
   * die thrown away from you and caught again, which is what is happening.
   */
  swing: number
  /** How far each face sits from the centre of the solid. */
  inradius: number
  /** A face element's width, given its polygon is drawn at `FACE_RADIUS`. */
  faceBox: number
  /** The face shown before anything has been thrown. */
  restingValue: number
  /** Value → the orientation the die settles in after rolling it. */
  rests: ReadonlyMap<number, Mat3>
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
export const THROW_MS = 1400

/**
 * The face polygon's largest corner radius inside its own 0–100 viewBox. Every
 * other measurement scales off this, so a die has exactly one size constant.
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

function scaled(a: Vec3, by: number): Vec3 {
  return [a[0] * by, a[1] * by, a[2] * by]
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

function average(points: readonly Vec3[]): Vec3 {
  const sum = points.reduce<Vec3>(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]],
    [0, 0, 0]
  )
  return scaled(sum, 1 / points.length)
}

/** Where the light sits. `y` is negative because CSS y points down. */
const LIGHT: Vec3 = normalise([-0.42, -0.72, 0.55])

/* ----------------------------------------------------------------- matrices */

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

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
 * keeps a half-turn from dividing by zero — several of the face bases land
 * near one.
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

/* ------------------------------------------------------------------ a face */

/**
 * One face of a solid, before it knows its number.
 *
 * `up` is a point whose direction from the face's centre, flattened onto the
 * face, becomes "up the screen" when that face is looked at. Usually a point on
 * the face — a corner, an edge midpoint — which is what stands a triangle on
 * its base and hangs a kite by its apex corner. It does not have to be: the
 * cube hands every face the *die's* own up axis, so its numbers agree with each
 * other rather than each choosing its own quarter turn.
 */
interface FaceGeometry {
  normal: Vec3
  basis: Mat3
  inradius: number
  /** Largest corner distance from the face's centre, in solid units. */
  reach: number
  points: string
  /** A point on the face, into the face's 0–100 viewBox. */
  project: (point: Vec3) => { x: number; y: number }
}

function describeFace(corners: readonly Vec3[], up: Vec3): FaceGeometry {
  const centroid = average(corners)
  const winding = cross(subtract(corners[1], corners[0]), subtract(corners[2], corners[0]))
  // The solid is centred on the origin, so outward is the side the centroid is on.
  const normal = dot(winding, centroid) < 0 ? normalise(scaled(winding, -1)) : normalise(winding)
  /*
    The face's centre is the foot of the perpendicular from the solid's centre,
    not the corner average — the kite is the face where they differ, and drawing
    around the average would leave the polygon sitting beside the point the CSS
    `translateZ` pushes the element out to.
  */
  const inradius = dot(corners[0], normal)
  const origin = scaled(normal, inradius)

  const upDir = subtract(up, origin)
  const flat = subtract(upDir, scaled(normal, dot(upDir, normal)))
  const toTop = normalise(flat)
  // X across and Y *up the screen*. CSS y points down, so Y is the negated
  // top direction, which stands the polygon the way its `up` point asks.
  const axisX = cross(normal, toTop)
  const axisY: Vec3 = [-toTop[0], -toTop[1], -toTop[2]]
  const basis: Mat3 = [...axisX, ...axisY, ...normal]

  const reach = Math.max(...corners.map((corner) => length(subtract(corner, origin))))
  const scale = FACE_RADIUS / reach

  // Corners arrive from set operations in no particular order, so walk them by
  // angle — a square drawn in extraction order comes out a bowtie.
  const angleOf = (corner: Vec3): number => {
    const offset = subtract(corner, origin)
    return Math.atan2(dot(offset, axisY), dot(offset, axisX))
  }
  const ordered = [...corners].sort((a, b) => angleOf(a) - angleOf(b))

  const points = ordered
    .map((corner) => {
      const offset = subtract(corner, origin)
      const x = 50 + dot(offset, axisX) * scale * FACE_OVERLAP
      const y = 50 + dot(offset, axisY) * scale * FACE_OVERLAP
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const project = (point: Vec3): { x: number; y: number } => {
    const offset = subtract(point, origin)
    return { x: 50 + dot(offset, axisX) * scale, y: 50 + dot(offset, axisY) * scale }
  }

  return { normal, basis, inradius, reach, points, project }
}

/**
 * Numbers a solid so opposite faces sum to one more than its face count, which
 * is how a real die is numbered. The sides of these are visible, so an
 * arbitrary arrangement is something you could sit and notice. The tetrahedron
 * has no opposite faces and skips this entirely.
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

/* ------------------------------------------------------------- the solids */

interface FaceSpec {
  corners: Vec3[]
  up: Vec3
  /** Where the number sits, as a point on the face. Corner average otherwise. */
  labelAnchor?: Vec3
}

interface SolidSpec {
  kind: string
  restingValue: number
  faces: FaceSpec[]
  /** Rescales the 1-based numbering — the percentile dice count in tens and from zero. */
  value?: (n: number) => number
  /** Prints a value — `padStart` is what turns the tens die's 0 into "00". */
  text?: (value: number) => string
  /**
   * Nudges the number down its face, in viewBox units. A triangle's visual
   * centre sits below its centroid, so its number placed dead centre reads high.
   */
  labelNudge?: number
  /** Composed onto every resting orientation. The d6 says why below. */
  tilt?: Mat3
}

function buildSolid(spec: SolidSpec): DieSolid {
  const geometries = spec.faces.map((face) => describeFace(face.corners, face.up))
  const numbers = numberFaces(geometries.map((geometry) => geometry.normal))
  const toValue = spec.value ?? ((n: number) => n)
  const toText = spec.text ?? ((value: number) => String(value))
  const nudge = spec.labelNudge ?? 0

  const faces = spec.faces.map((face, index) => {
    const geometry = geometries[index]
    const value = toValue(numbers[index])
    const anchor = geometry.project(face.labelAnchor ?? average(face.corners))
    return {
      value,
      basis: geometry.basis,
      normal: geometry.normal,
      points: geometry.points,
      labels: [{ text: toText(value), x: anchor.x, y: anchor.y + nudge, angle: 0 }],
      corners: face.corners,
      ...axisAngle(geometry.basis)
    }
  })

  // Bringing a face to the camera means undoing its own basis: the face then
  // lies in the screen plane, upright, with its number facing out.
  const tilt = spec.tilt ?? IDENTITY
  const rests = new Map<number, Mat3>(
    faces.map((face) => [face.value, multiply(tilt, transpose(face.basis))])
  )

  const span = restingWidth(faces, rests)
  return {
    kind: spec.kind,
    faces: Object.freeze(faces),
    span,
    swing: (2 * Math.max(...faces.flatMap((face) => face.corners.map(length)))) / span,
    inradius: geometries[0].inradius,
    faceBox: (100 * geometries[0].reach) / FACE_RADIUS,
    restingValue: spec.restingValue,
    rests
  }
}

/**
 * The widest the die ever looks standing still: the smallest circle around its
 * corners once a resting orientation has been applied, over every face it can
 * rest on.
 *
 * A circle rather than the silhouette's true width, because the die turns
 * inside its box as it lands and a bound that held only for one heading would
 * be no bound at all. It overstates by a few per cent on the tetrahedron, which
 * is the one solid here with no corner opposite another.
 */
function restingWidth(faces: readonly SolidFace[], rests: ReadonlyMap<number, Mat3>): number {
  let widest = 0
  for (const rest of rests.values()) {
    for (const face of faces) {
      for (const corner of face.corners) {
        const [x, y] = transform(rest, corner)
        widest = Math.max(widest, 2 * Math.hypot(x, y))
      }
    }
  }
  return widest
}

const PHI = (1 + Math.sqrt(5)) / 2

/** Cyclic permutations of (0, ±1, ±φ). Edge length is 2. */
function icosahedronVertices(): Vec3[] {
  const out: Vec3[] = []
  for (const p of [1, -1]) {
    for (const q of [1, -1]) {
      out.push([0, p, q * PHI], [p, q * PHI, 0], [p * PHI, 0, q])
    }
  }
  return out
}

/**
 * A face is any triple of vertices whose three edges are all the shortest edge.
 * The next distance up in an icosahedron is 2φ, so the test has room to spare.
 *
 * The corners come back as the same objects `corners` holds, which is what lets
 * the dodecahedron below ask which faces meet at a given vertex by identity.
 */
function icosahedronTriangles(corners: Vec3[]): Vec3[][] {
  const out: Vec3[][] = []
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      for (let k = j + 1; k < corners.length; k++) {
        const trio = [corners[i], corners[j], corners[k]]
        const edges = [
          length(subtract(trio[0], trio[1])),
          length(subtract(trio[1], trio[2])),
          length(subtract(trio[0], trio[2]))
        ]
        if (edges.every((edge) => edge < 2.01)) out.push(trio)
      }
    }
  }
  return out
}

function icosahedronFaces(): FaceSpec[] {
  return icosahedronTriangles(icosahedronVertices()).map((trio) => ({
    corners: trio,
    up: trio[0]
  }))
}

function octahedronFaces(): FaceSpec[] {
  const out: FaceSpec[] = []
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        out.push({
          corners: [
            [sx, 0, 0],
            [0, sy, 0],
            [0, 0, sz]
          ],
          up: [sx, 0, 0]
        })
      }
    }
  }
  return out
}

/**
 * The cube, with every face's number squared to the *die's* up axis.
 *
 * This one cannot take a corner or an edge midpoint for `up` the way the other
 * solids do. Any edge of a square is as good as the other three, so each face
 * ends up rotated by an arbitrary quarter turn — and on a cube, where you see
 * three faces meeting at right angles, that reads as numbers lying on their
 * sides for no reason. Nowhere else does it show: a d20's neighbours really are
 * turned every which way, on the real die as much as on this one.
 *
 * So the four faces the up axis runs beside take that axis, and read upright
 * together. The two it runs *through* have no such direction and take the depth
 * axis instead — which is what a real die does, and why looking down at one's
 * top face reads it with the front of the die at the bottom.
 */
function cubeFaces(): FaceSpec[] {
  const corners: Vec3[] = []
  for (const sx of [1, -1])
    for (const sy of [1, -1]) for (const sz of [1, -1]) corners.push([sx, sy, sz])

  return [0, 1, 2].flatMap((axis) =>
    [1, -1].map((sign) => ({
      corners: corners.filter((corner) => corner[axis] === sign),
      // CSS y points down, so the die's up axis is negative y.
      up: axis === 1 ? ([0, 0, 1] as Vec3) : ([0, -1, 0] as Vec3)
    }))
  )
}

/**
 * The twelve pentagons, built as the icosahedron's dual.
 *
 * Taking the textbook coordinates and gathering "the five vertices leaning
 * furthest towards each face normal" was tried first and is wrong: it picks a
 * set whose corners are not coplanar, because the standard dodecahedron and the
 * standard icosahedron are not in dual position — their cyclic conventions
 * differ by a rotation, so one's vertex directions are not the other's face
 * normals, and they miss by about eleven degrees.
 *
 * Dualising is exact by construction and needs no coordinates at all. A
 * dodecahedron vertex sits on the ray through an icosahedron face; a
 * dodecahedron face answers an icosahedron vertex, and is the ring of the five
 * faces meeting there. Coplanar by symmetry, which is what the flatness test
 * then confirms rather than hopes for.
 */
function dodecahedronFaces(): FaceSpec[] {
  const corners = icosahedronVertices()
  const triangles = icosahedronTriangles(corners)
  const duals = triangles.map((trio) => normalise(average(trio)))

  return corners.map((vertex) => {
    const ring = duals.filter((_, index) => triangles[index].includes(vertex))
    return { corners: ring, up: ring[0] }
  })
}

/**
 * The d10's pentagonal trapezohedron: two apexes and a zigzag equator of ten
 * kites. With the equator ring at radius 1 and the apexes at ±APEX, the ring
 * must sit at ±APEX·tan²(18°) for the kites to be flat — set the height and
 * planarity dictates the zigzag. APEX itself is proportion, chosen against
 * photographs of the die.
 */
const APEX = 1.12
const RING = APEX * Math.tan(Math.PI / 10) ** 2

function trapezohedronFaces(): FaceSpec[] {
  const top: Vec3 = [0, 0, APEX]
  const bottom: Vec3 = [0, 0, -APEX]
  const upper = (i: number): Vec3 => {
    const angle = (2 * Math.PI * i) / 5
    return [Math.cos(angle), Math.sin(angle), RING]
  }
  const lower = (i: number): Vec3 => {
    const angle = (2 * Math.PI * i) / 5 + Math.PI / 5
    return [Math.cos(angle), Math.sin(angle), -RING]
  }

  const out: FaceSpec[] = []
  for (let i = 0; i < 5; i++) {
    // A kite hangs from its apex corner: the number's top points at the die's
    // point, the way a real d10 is printed.
    out.push({ corners: [top, upper(i), lower(i), upper(i + 1)], up: top })
    out.push({ corners: [bottom, lower(i), upper(i + 1), lower(i + 1)], up: bottom })
  }
  return out
}

/**
 * The d4 as a vertex-read die: the thrown number is the one at the point
 * facing you, printed at the matching corner of all three faces you can see.
 *
 * A tetrahedron has no face pointing anywhere useful, so real dice read either
 * the apex or the bottom edge. Apex is the convention here and it is load-
 * bearing: this module presents a die to a camera rather than resting it on a
 * table, and "the corner towards the viewer" survives that translation where
 * "the edge against the table" does not — there is no table.
 */
function tetrahedron(): DieSolid {
  const vertices: Vec3[] = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1]
  ]
  /**
   * How far out from the face's centre each corner's number sits.
   *
   * Tuned against the apex, where three faces meet and print the same number
   * three times. Pulling further out tightens that trio around the point you
   * read it at, and past about 0.6 they collide: the faces are steeply
   * foreshortened there, so a step out on the face is a much smaller step on
   * screen. 0.7 was tried and the three numbers overlapped into a smudge.
   */
  const PULL = 0.58

  const faces = vertices.map((apex, index) => {
    const corners = vertices.filter((_, j) => j !== index)
    const geometry = describeFace(corners, corners[0])

    const labels = corners.map((corner) => {
      const at = geometry.project(corner)
      const dx = at.x - 50
      const dy = at.y - 50
      return {
        text: String(vertices.indexOf(corner) + 1),
        x: 50 + dx * PULL,
        y: 50 + dy * PULL,
        // Top of the digit into its corner, which is how the moulds do it: the
        // three copies of the thrown number then radiate from the point you
        // read them at.
        angle: Number(((Math.atan2(dx, -dy) * 180) / Math.PI).toFixed(2))
      }
    })

    return {
      // A face carries every number but its opposite vertex's, so that missing
      // number is the face's own name. Unlike every other solid here, it is an
      // identity rather than a result: a d4 face stands for no throw.
      value: index + 1,
      basis: geometry.basis,
      normal: geometry.normal,
      points: geometry.points,
      labels,
      corners,
      ...axisAngle(geometry.basis)
    }
  })

  /*
    Resting means the thrown vertex looks at the camera, spun so another vertex
    sits at the top of the screen — the silhouette is then the familiar
    point-up triangle rather than a shape that reads as mid-tumble.

    Then tipped back, for the same reason the d6 is. Dead-on, all three visible
    faces sit at 70.5° from the camera and the die reads as a flat triangle with
    a Y of edges on it. This much rotation brings the lower face round to about
    55° — enough that its copy of the thrown number is the one you read — while
    leaving the other two at roughly 79°, steep but still drawn, which is what
    keeps the shape solid. The tetrahedron has no better angle available: a
    tilt that squares one face up entirely loses the other two, since a
    neighbour is 109.5° away and drops below the horizon at about 40°.
  */
  const TILT = rotation([1, 0, 0], 0.26)
  const rests = new Map<number, Mat3>(
    vertices.map((vertex, index) => {
      const axisZ = normalise(vertex)
      const other = vertices[(index + 1) % vertices.length]
      const flat = subtract(other, scaled(axisZ, dot(other, axisZ)))
      const toTop = normalise(flat)
      const axisY: Vec3 = [-toTop[0], -toTop[1], -toTop[2]]
      const axisX = cross(axisY, axisZ)
      return [index + 1, multiply(TILT, transpose([...axisX, ...axisY, ...axisZ]))]
    })
  )

  const geometry = describeFace([vertices[1], vertices[2], vertices[3]], vertices[1])
  const span = restingWidth(faces, rests)
  return {
    kind: 'd4',
    faces: Object.freeze(faces),
    span,
    swing: (2 * length(vertices[0])) / span,
    inradius: geometry.inradius,
    faceBox: (100 * geometry.reach) / FACE_RADIUS,
    restingValue: 3,
    rests
  }
}

/**
 * The d6 rests off axis, and has to.
 *
 * A cube's neighbours meet it at exactly 90°, so a face brought square to the
 * camera leaves every other face on the horizon and `faceLighting` drops them
 * all: the solid d6 would be a flat square, indistinguishable from the flat
 * renderer it is meant to be an alternative to. Every other solid here has an
 * obtuse dihedral angle and shows three to five faces unaided.
 *
 * A quarter of a right angle each way, which is the angle a die is photographed
 * at. The first attempt was half this and read as janky rather than as a
 * three-quarter view: it left the two neighbouring faces at 73° and 76°, thin
 * enough to look like an error on a square rather than the sides of a cube.
 * Here they land near 65° and 72°, with the number's own face at 32°.
 */
const D6_TILT = multiply(rotation([0, 1, 0], 0.44), rotation([1, 0, 0], -0.35))

/**
 * The dice, built once at load.
 *
 * Deriving them beats hand-copied tables: the derivation is the thing a test
 * can hold to account, and hundreds of floats are not.
 */
export const SOLIDS: Readonly<Record<4 | 6 | 8 | 10 | 12 | 20, DieSolid>> = Object.freeze({
  4: tetrahedron(),
  6: buildSolid({ kind: 'd6', restingValue: 5, faces: cubeFaces(), tilt: D6_TILT }),
  8: buildSolid({ kind: 'd8', restingValue: 6, faces: octahedronFaces(), labelNudge: 6 }),
  10: buildSolid({ kind: 'd10', restingValue: 7, faces: trapezohedronFaces() }),
  12: buildSolid({ kind: 'd12', restingValue: 9, faces: dodecahedronFaces(), labelNudge: 2 }),
  20: buildSolid({ kind: 'd20', restingValue: 14, faces: icosahedronFaces(), labelNudge: 6 })
})

/**
 * A percentile throw is two of the same solid wearing different numbers, so
 * the shape is built once and only the values change. Tens run 00–90 with
 * opposite faces summing to 90, units 0–9 summing to 9 — the numberings real
 * percentile pairs carry.
 */
export const PERCENTILE: readonly [DieSolid, DieSolid] = Object.freeze([
  buildSolid({
    kind: 'd10-tens',
    restingValue: 40,
    faces: trapezohedronFaces(),
    value: (n) => (n - 1) * 10,
    text: (value) => String(value).padStart(2, '0')
  }),
  buildSolid({
    kind: 'd10-units',
    restingValue: 7,
    faces: trapezohedronFaces(),
    value: (n) => n - 1
  })
])

/* ------------------------------------------------------------ orientation */

export function restRotation(die: DieSolid, value: number): Mat3 {
  return die.rests.get(value) ?? die.rests.get(die.restingValue) ?? IDENTITY
}

/**
 * Fast, then slowing evenly.
 *
 * The square is doing real work here. A fourth power spends 94% of the turning
 * inside the first half of the throw and then crawls, which reads as a die that
 * barely moved: what the eye follows is the slow tail, and there is almost
 * nothing left in it. Squared leaves the angular speed falling off linearly,
 * which is roughly what a die on a table does anyway, and keeps a quarter of the
 * spin for the second half where it can be seen.
 */
function eased(t: number): number {
  return 1 - (1 - t) ** 2
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

/**
 * Always a whole number of turns, and never few enough to be missed.
 *
 * Whole turns are what let the throw land on its face exactly. The floor of four
 * is what stops a throw from reading as a nudge: the die opens the animation
 * already at its resting orientation, so anything less leaves the first frame
 * looking like the answer simply appearing.
 */
export function randomSpin(random: () => number = Math.random): Spin {
  const axis = (): Vec3 => [random() - 0.5, random() - 0.5, random() - 0.5]
  return {
    axis: axis(),
    otherAxis: axis(),
    turns: 4 + Math.floor(random() * 3),
    otherTurns: 2 + Math.floor(random() * 2)
  }
}

/* --------------------------------------------------------------- lighting */

/**
 * How lit each face is, and whether it is drawn at all.
 *
 * The same dot product does both jobs. A convex solid needs no depth sorting if
 * the faces pointing away are simply absent, which is also why this does not
 * lean on `backface-visibility` reaching an SVG element.
 */
export function faceLighting(die: DieSolid, current: Mat3): FaceLight[] {
  return die.faces.map((face) => {
    const normal = transform(current, face.normal)
    return {
      visible: normal[2] > FACING,
      brightness: AMBIENT + DIFFUSE * Math.max(0, dot(normal, LIGHT))
    }
  })
}

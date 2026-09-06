import { ShapeUtils, Vector2 } from 'three'
import type { Bounds3, FootprintGroup, Vec2 } from '../domain'
import { signedArea } from './text'

export interface ExtrudedMesh { vertices: Float32Array; indices: Uint32Array; bounds: Bounds3; footprints: FootprintGroup[] }

/** Groups rings by winding direction and assigns holes to containing outer contours. */
export function groupsFromContours(contours: Vec2[][]): FootprintGroup[] {
  const outers: FootprintGroup[] = []
  const holes: Vec2[][] = []

  // In standard Cartesian coordinates (Y up), CCW rings have signedArea > 0 (outer),
  // and CW rings have signedArea < 0 (holes).
  for (const ring of contours) {
    if (signedArea(ring) > 0) {
      outers.push({ outer: ring, holes: [] })
    } else {
      holes.push(ring)
    }
  }

  // Assign each hole to its containing outer ring
  for (const hole of holes) {
    const testPoint = hole[0]
    const parent = outers.find((o) => pointInRing(testPoint, o.outer))
    if (parent) {
      parent.holes.push(hole)
    } else if (outers.length > 0) {
      outers[0].holes.push(hole)
    }
  }

  return outers
}

export function extrude(groups: FootprintGroup[], zMin: number, zMax: number): ExtrudedMesh {
  const vertices: number[] = []
  const indices: number[] = []
  for (const group of groups) appendExtrusion(vertices, indices, group, zMin, zMax)
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), bounds: meshBounds(vertices), footprints: groups }
}

export function roundedRectangle(width: number, height: number, radius: number): FootprintGroup[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  if (r === 0) return [{ outer: [{ x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 }, { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 }], holes: [] }]
  const corners: Array<[number, number, number]> = [[width / 2 - r, -height / 2 + r, -Math.PI / 2], [width / 2 - r, height / 2 - r, 0], [-width / 2 + r, height / 2 - r, Math.PI / 2], [-width / 2 + r, -height / 2 + r, Math.PI]]
  const outer: Vec2[] = []
  corners.forEach(([cx, cy, start]) => {
    for (let step = 0; step <= 6; step += 1) {
      const angle = start + (step / 6) * Math.PI / 2
      outer.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r })
    }
  })
  return [{ outer, holes: [] }]
}

function appendExtrusion(vertices: number[], indices: number[], group: FootprintGroup, zMin: number, zMax: number): void {
  const rings = [orient(group.outer, false), ...group.holes.map((hole) => orient(hole, true))]
  const flat = rings.flat()
  const base = vertices.length / 3
  flat.forEach((point) => vertices.push(point.x, point.y, zMin))
  flat.forEach((point) => vertices.push(point.x, point.y, zMax))
  const holes = rings.slice(1).map((_, index) => rings.slice(0, index + 1).reduce((total, ring) => total + ring.length, 0))
  const triangles = ShapeUtils.triangulateShape(rings[0].map(toVector), rings.slice(1).map((ring) => ring.map(toVector)))
  for (const [a, b, c] of triangles) {
    indices.push(base + c, base + b, base + a)
    indices.push(base + flat.length + a, base + flat.length + b, base + flat.length + c)
  }
  let ringOffset = 0
  rings.forEach((ring) => {
    ring.forEach((_, index) => {
      const next = (index + 1) % ring.length
      const a = base + ringOffset + index
      const b = base + ringOffset + next
      const at = base + flat.length + ringOffset + index
      const bt = base + flat.length + ringOffset + next
      indices.push(a, b, bt, a, bt, at)
    })
    ringOffset += ring.length
  })
  void holes
}
const toVector = (point: Vec2) => new Vector2(point.x, point.y)
function orient(ring: Vec2[], clockwise: boolean): Vec2[] { const isClockwise = signedArea(ring) < 0; return isClockwise === clockwise ? [...ring] : [...ring].reverse() }
function meshBounds(vertices: number[]): Bounds3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < vertices.length; i += 3) for (let axis = 0; axis < 3; axis += 1) { min[axis] = Math.min(min[axis], vertices[i + axis]); max[axis] = Math.max(max[axis], vertices[i + axis]) }
  return { min, max }
}
function interiorPoint(ring: Vec2[]): Vec2 {
  const centroid = ring.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 })
  const candidate = { x: centroid.x / ring.length, y: centroid.y / ring.length }
  if (pointInRing(candidate, ring)) return candidate
  const a = ring[0]; const b = ring[1]; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const direction = signedArea(ring) > 0 ? 1 : -1
  const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy) || 1
  return { x: mid.x - dy / length * 0.001 * direction, y: mid.y + dx / length * 0.001 * direction }
}
export function pointInRing(point: Vec2, ring: Vec2[]): boolean { let inside = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const p = ring[a]; const q = ring[b]; if ((p.y > point.y) !== (q.y > point.y) && point.x < (q.x - p.x) * (point.y - p.y) / (q.y - p.y) + p.x) inside = !inside } return inside }

import { MathUtils, Vector3 } from 'three'

export const clamp = MathUtils.clamp
export const mix = MathUtils.lerp
export const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t) }
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
export const yawTo = (from: Vector3, to: Vector3) => Math.atan2(to.x - from.x, to.z - from.z)
export const flatDistance = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
export const forward = (yaw: number, out: Vector3) => out.set(Math.sin(yaw), 0, Math.cos(yaw))
export function pointSegmentSquared(point: Vector3, start: Vector3, end: Vector3) {
  const x = end.x - start.x, y = end.y - start.y, z = end.z - start.z
  const px = point.x - start.x, py = point.y - start.y, pz = point.z - start.z
  const projection = clamp((px * x + py * y + pz * z) / (x * x + y * y + z * z || 1), 0, 1)
  return (px - projection * x) ** 2 + (py - projection * y) ** 2 + (pz - projection * z) ** 2
}

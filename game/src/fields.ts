export const defaultFieldId = 'FIELD_001'

export interface Obstacle { x: number; z: number; radius: number; height: number }
type Spawn = readonly [x: number, z: number]
type ViewSizes = { portrait: number; landscape: number; victory: number }
export interface FieldCamera {
  pitch: number
  distance: ViewSizes
  focusHeight: ViewSizes
  targetTracking?: { fraction: number; distance: number }
  closeDistance?: number
}

interface FieldData {
  name: string
  radius: number
  playerSpawn: Spawn
  monsterSpawn: Spawn
  obstacles?: readonly Obstacle[]
  background: string
  fog: { color: string; density: number }
  lighting: {
    sky: number
    ground: number
    fill: number
    sun?: { color: number; intensity: number; position: readonly [number, number, number] }
  }
  ambiance?: { path: string; volume: number }
  camera?: FieldCamera
  landscape: 'shore' | 'summit' | { path: string; scale: number; floor: number; surround?: number }
}

const fields = {
  FIELD_001: {
    name: '夕凪の石浜', radius: 24, playerSpawn: [0, 8], monsterSpawn: [0, -2],
    background: '#a0afb0', fog: { color: '#a6ada5', density: .018 },
    lighting: { sky: 0xc9e4ec, ground: 0x665044, fill: 2.05 },
    landscape: 'shore',
  },
  FIELD_002: {
    name: '古代神殿跡地', radius: 22, playerSpawn: [0, 8], monsterSpawn: [0, -2],
    background: '#9faeb0', fog: { color: '#9faeb0', density: .017 },
    lighting: {
      sky: 0xe2edf3, ground: 0x66675c, fill: 1.75,
      sun: { color: 0xffe0b4, intensity: 2.65, position: [-25, 35, -30] },
    },
    ambiance: { path: 'fields/ancient-temple-wind.mp3', volume: .27 },
    landscape: { path: 'fields/ancient-temple.glb', scale: 1.3, floor: 0, surround: 0x54584b },
    camera: {
      pitch: .54,
      distance: { portrait: 12, landscape: 11, victory: 10 },
      focusHeight: { portrait: 2.55, landscape: 2.2, victory: 1.8 },
      targetTracking: { fraction: .15, distance: 2.1 },
      closeDistance: .85,
    },
  },
  FIELD_003: {
    name: '神の山頂', radius: 18, playerSpawn: [0, 7.5], monsterSpawn: [0, .5],
    background: '#a39aba', fog: { color: '#a598c3', density: .012 },
    lighting: { sky: 0xdad8ff, ground: 0x66577b, fill: 2.05 },
    landscape: 'summit',
    camera: {
      pitch: .52,
      distance: { portrait: 25, landscape: 22, victory: 16 },
      focusHeight: { portrait: 4.7, landscape: 4.7, victory: 2.9 },
      targetTracking: { fraction: .38, distance: 5 },
    },
  },
} as const satisfies Record<string, FieldData>

export type FieldId = keyof typeof fields
export type RegisteredField = FieldData & { id: FieldId }

export function fieldFor(id: FieldId = defaultFieldId): RegisteredField {
  const resolved = Object.hasOwn(fields,id) ? id : defaultFieldId
  return { id: resolved, ...fields[resolved] }
}

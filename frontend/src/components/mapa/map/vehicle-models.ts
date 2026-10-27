import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { VehicleAppearance, VehicleColor, VehicleType } from "../../../api/types"

export const VEHICLE_MODEL_TYPES: readonly VehicleType[] = ["ABT", "ABTF", "ABTR", "AT", "ASE", "AEM", "APM", "UR", "MOB", "ABRESC", "AV"]
export const VEHICLE_PALETTE: Record<VehicleColor, string> = { vermelho_bombeiro: "#aa343b", branco: "#e2e5df", amarelo_refletivo: "#d3b45b", grafite: "#384650" }
export const DEFAULT_VEHICLE_APPEARANCE: VehicleAppearance = { variant: "default", body_color: "vermelho_bombeiro", stripe_color: "branco", show_prefix: true, unit_badge: true }
// Illustrative proportions, never specifications of the registered fleet.
const DIMENSIONS: Record<VehicleType, [number, number, number, number]> = {
  ABT: [8.2, 2.5, 3.15, .53], ABTF: [7.8, 2.5, 3.55, .62], ABTR: [8.6, 2.5, 3.25, .53], AT: [9.4, 2.5, 3.35, .56],
  ASE: [6.8, 2.25, 2.85, .43], AEM: [10.4, 2.55, 3.65, .56], APM: [10.1, 2.55, 3.65, .56], UR: [6.15, 2.15, 2.65, .41],
  MOB: [2.35, .9, 1.6, .34], ABRESC: [6.3, 2.2, 2.55, .44], AV: [4.9, 1.9, 1.65, .35],
}
export function vehicleModelDimensions(type: VehicleType) { const [length, width, height, wheelRadius] = DIMENSIONS[type]; return { length, width, height, wheelRadius } }
export interface VehicleModelOptions {
  type: VehicleType; prefix?: string; unit_acronym?: string; appearance?: VehicleAppearance | null
  routeVariant?: "normal" | "ai" | "distance"
  isolatedGeometry?: boolean
  /** Preserve individual equipment meshes for picking in the garage. */
  inspectable?: boolean
}
export interface VehicleModelFrame {
  seconds: number; deltaSeconds?: number
  /** Distance since the previous frame, in meters. */
  distanceMeters?: number; speedMps?: number; turnRate?: number; braking?: boolean; moving?: boolean
  signals?: boolean; arrived?: boolean; night?: boolean; headlights?: boolean; reducedMotion?: boolean; hidden?: boolean
  doors?: boolean; compartments?: boolean; ladder?: boolean; exploded?: boolean; wireframe?: boolean
  /** Distant map views omit small rigid fittings; the garage leaves this unset. */
  zoom?: number
}
type Pool = { users: number; geometries: Map<string, THREE.BufferGeometry> }
const pools = new Map<VehicleType, Pool>()
interface ModelState {
  pool: Pool; type: VehicleType; body: THREE.Group; details: THREE.Group; wheels: THREE.Group[]; doors: THREE.Group[]; shutters: THREE.Group[]; ladder?: THREE.Group
  materials: Set<THREE.Material>; owned: Set<THREE.BufferGeometry>; textures: THREE.Texture[]; signals: THREE.MeshStandardMaterial[]
  brake: THREE.MeshStandardMaterial; lamp: THREE.MeshStandardMaterial; reflection: THREE.Mesh; beam: THREE.Mesh
  parts: { object: THREE.Object3D; origin: THREE.Vector3; offset: THREE.Vector3 }[]; frame: VehicleModelFrame
}
const states = new WeakMap<THREE.Object3D, ModelState>()

/** Shared assembly: Z up, +Y forward. The caller owns rendering and animation. */
export function createVehicleModel(options: VehicleModelOptions): THREE.Group {
  const { type } = options
  const d = vehicleModelDimensions(type)
  const appearance = { ...DEFAULT_VEHICLE_APPEARANCE, ...options.appearance }
  const pool = pools.get(type) ?? { users: 0, geometries: new Map() }
  pools.set(type, pool); pool.users++
  const root = new THREE.Group(); root.name = `zeno-vehicle-${type}`; root.userData.type = type
  const body = new THREE.Group(); body.name = "Conjunto da carroceria"; root.add(body)
  const materials = new Set<THREE.Material>(), owned = new Set<THREE.BufferGeometry>()
  function material(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .18, ...extra }); materials.add(mat); return mat
  }
  const paint = material(VEHICLE_PALETTE[appearance.body_color]), stripe = material(VEHICLE_PALETTE[appearance.stripe_color])
  const metal = material(0xa3afb2, { metalness: .7, roughness: .4 }), dark = material(0x26333b)
  const rubber = material(0x192126, { roughness: .95, metalness: 0 }), glass = material(0x274652, { roughness: .2, metalness: .35 })
  const lamp = material(0xece4c9, { emissive: 0xece4c9, emissiveIntensity: .15 }), brake = material(0xa83236, { emissive: 0xe93a32, emissiveIntensity: .08 })
  const signals = Array.from({ length: 4 }, (_, i) => material(i % 2 ? 0xe2e5df : 0xbd3435, { emissive: i % 2 ? 0xf3e8dc : 0xf23c30, emissiveIntensity: .25 }))
  function geometry(key: string, create: () => THREE.BufferGeometry) {
    let geo = pool.geometries.get(key)
    if (!geo) { geo = create(); pool.geometries.set(key, geo) }
    if (!options.isolatedGeometry) return geo
    const clone = geo.clone(); owned.add(clone); return clone
  }
  function box(parent: THREE.Object3D, name: string, size: [number, number, number], pos: [number, number, number], mat: THREE.Material) {
    const mesh = new THREE.Mesh(geometry(`box:${size}`, () => new THREE.BoxGeometry(...size)), mat)
    mesh.name = name; mesh.position.set(...pos); parent.add(mesh); return mesh
  }
  function cylinder(parent: THREE.Object3D, name: string, radius: number, length: number, pos: [number, number, number], mat: THREE.Material) {
    const mesh = new THREE.Mesh(geometry(`cyl:${radius}:${length}`, () => new THREE.CylinderGeometry(radius, radius, length, 12)), mat)
    mesh.name = name; mesh.position.set(...pos); parent.add(mesh); return mesh
  }
  // Rigid details share draw calls; wheels, doors, shutters and booms retain pivots.
  function batch(group: THREE.Group) {
    if (options.inspectable) return
    const batches = new Map<THREE.Material, THREE.Mesh[]>()
    for (const child of group.children) if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
      const meshes = batches.get(child.material) ?? []; meshes.push(child); batches.set(child.material, meshes)
    }
    for (const [mat, meshes] of batches) if (meshes.length > 1) {
      const key = `batch:${group.name}:${meshes.map((m) => `${m.name}:${m.position.toArray()}:${m.rotation.toArray()}`)}`
      const geo = geometry(key, () => {
        const pieces = meshes.map((mesh) => { mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix) })
        const merged = mergeGeometries(pieces)!
        pieces.forEach((piece) => piece.dispose()); return merged
      })
      const mesh = new THREE.Mesh(geo, mat); mesh.name = meshes[0].name
      meshes.forEach((part) => group.remove(part)); group.add(mesh)
    }
  }
  const details = new THREE.Group(); details.name = "Acabamentos"; body.add(details)
  const wheels: THREE.Group[] = [], doors: THREE.Group[] = [], shutters: THREE.Group[] = []
  const chassisZ = d.wheelRadius + .08, half = d.length / 2
  const frontAxle = half - (type === "MOB" ? .38 : 1.25), rearAxle = -half + (type === "MOB" ? .36 : 1.4)
  const wheelRows = ["AT", "AEM", "APM"].includes(type) ? [frontAxle, rearAxle, rearAxle + 1.25] : [frontAxle, rearAxle]
  for (const [row, y] of wheelRows.entries()) for (const side of type === "MOB" ? [0] : [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.name = `wheel.${row === 0 ? "front" : row === 1 ? "rear" : "middle"}.${side < 0 ? "left" : side > 0 ? "right" : "center"}`
    pivot.position.set(side * (d.width / 2 - .08), y, d.wheelRadius)
    cylinder(pivot, "Pneu", d.wheelRadius, type === "MOB" ? .15 : .32, [0, 0, 0], rubber).rotation.z = Math.PI / 2
    cylinder(pivot, "Roda", d.wheelRadius * .55, type === "MOB" ? .17 : .34, [0, 0, 0], metal).rotation.z = Math.PI / 2
    box(pivot, "Referência do cubo", [type === "MOB" ? .19 : .36, .055, d.wheelRadius * .87], [0, 0, 0], dark)
    root.add(pivot); wheels.push(pivot)
  }
  let ladder: THREE.Group | undefined
  const cabRoof = type === "MOB" ? 1.1 : d.height - (["AEM", "APM"].includes(type) ? .62 : .22)
  const cabY = half - (type === "AV" ? 2 : 1.25)
  if (type === "MOB") {
    box(body, "Carroceria", [.34, d.length, .3], [0, -.05, .57], paint)
    box(details, "Banco", [.44, .8, .14], [0, -.15, .92], rubber)
    box(body, "Baú operacional", [.64, .55, .46], [0, -.66, 1.15], paint)
    box(details, "Faixa refletiva", [.655, .45, .085], [0, -.66, 1.2], stripe)
    for (const side of [-1, 1]) box(details, "Garfo dianteiro", [.055, .08, .63], [side * .14, frontAxle, .65], metal)
    box(details, "Guidão", [.9, .07, .065], [0, .55, 1.24], metal)
    box(details, "Para-brisa", [.43, .055, .44], [0, .61, 1.36], glass).rotation.x = -.22
  } else {
    box(body, "Carroceria", [d.width - .16, d.length, .3], [0, 0, chassisZ], paint)
    box(body, "Cabine", [d.width - .22, 2.3, (cabRoof - chassisZ) * .58], [0, cabY - .13, chassisZ + (cabRoof - chassisZ) * .3], paint)
    box(details, "Teto", [d.width - .2, 2.15, .12], [0, cabY - .14, cabRoof], paint)
    box(details, "Para-brisa", [d.width - .42, .065, (cabRoof - chassisZ) * .38], [0, cabY + 1.03, cabRoof - (cabRoof - chassisZ) * .24], glass).rotation.x = .13
    box(details, "Coluna do para-brisa", [.055, .075, (cabRoof - chassisZ) * .4], [0, cabY + 1.06, cabRoof - (cabRoof - chassisZ) * .24], dark)
    box(details, "Grade frontal", [d.width * .5, .09, .28], [0, half + .02, chassisZ + .36], dark)
    for (const end of [-1, 1]) box(details, "Para-choque", [d.width, .15, .2], [0, end * (half + .04), chassisZ], metal)
    for (const side of [-1, 1]) {
      const door = new THREE.Group(); door.name = side < 0 ? "door.left" : "door.right"
      door.position.set(side * (d.width / 2 - .09), cabY + .88, chassisZ)
      box(door, "Porta da cabine", [.075, 1.95, (cabRoof - chassisZ) * .56], [0, -.98, (cabRoof - chassisZ) * .33], paint)
      box(door, "Vidro lateral", [.077, 1.83, (cabRoof - chassisZ) * .35], [0, -.98, (cabRoof - chassisZ) * .77], glass)
      box(door, "Faixa da cabine", [.086, 1.85, .12], [0, -.98, (cabRoof - chassisZ) * .54], stripe)
      box(door, "Maçaneta", [.11, .22, .045], [0, -1.7, (cabRoof - chassisZ) * .42], dark)
      body.add(door); doors.push(door)
      box(details, "Retrovisor", [.14, .24, .3], [side * (d.width / 2 + .16), cabY + .62, cabRoof - .4], dark)
      box(details, "Degrau", [.27, 1.15, .12], [side * d.width / 2, cabY -.45, chassisZ -.13], metal)
    }
    const rearLength = d.length - 2.55, rearY = -1.2
    if (type === "AV") {
      box(body, "Capô", [d.width - .14, 1.2, .26], [0, half -.5, chassisZ + .24], paint)
      box(body, "Porta-malas", [d.width -.12, 1.1, .4], [0, -half + .54, chassisZ + .26], paint)
      box(details, "Vidro traseiro", [d.width -.4, .055, .44], [0, cabY -1.29, cabRoof -.3], glass)
    } else if (type === "AT") {
      cylinder(body, "Tanque de água", d.width * .43, rearLength -.3, [0, rearY, chassisZ + 1.2], paint).scale.z = .86
      for (const y of [-half +1.5, -.4]) cylinder(details, "Cinta do tanque", d.width * .438, .12, [0, y, chassisZ + 1.2], metal).scale.z = .86
      box(details, "Bomba hidráulica", [1.5, .4, .8], [0, -half + .3, chassisZ + .65], metal)
    } else {
      const h = ["AEM", "APM"].includes(type) ? 1.55 : cabRoof - chassisZ -.07
      box(body, type === "ABRESC" ? "Módulo de busca e resgate" : "Módulo operacional", [d.width -.12, rearLength, h], [0, rearY, chassisZ + h / 2], paint)
      for (const side of [-1, 1]) {
        box(details, "Faixa refletiva", [.075, rearLength -.15, .15], [side * (d.width / 2 -.035), rearY, chassisZ + h *.76], stripe)
        if (["UR", "ASE"].includes(type)) box(details, "Janela do resgate", [.08, 1, .65], [side * (d.width / 2 -.03), -half + 1, cabRoof -.65], glass)
        else for (let index = 0; index < 3; index++) {
          const shutter = new THREE.Group(); shutter.name = `compartment.${side}.${index}`
          const shutterHalfHeight = h *.295
          shutter.position.set(side * d.width / 2, -half + .8 + index * (rearLength -1) / 3, chassisZ + h *.48 + shutterHalfHeight)
          const size = (rearLength -1.2) / 3
          box(shutter, type === "ABRESC" ? "Caixa ventilada para cães" : "Compartimento lateral", [.065, size, h *.59], [0, 0, -shutterHalfHeight], metal)
          for (let z = -.3; z < .35; z += .16) box(shutter, "Persiana", [.075, size -.08, .022], [0, 0, z - shutterHalfHeight], dark)
          batch(shutter); body.add(shutter); shutters.push(shutter)
        }
      }
    }
    if (["ABT", "ABTF", "ABTR"].includes(type)) {
      for (const x of [-.8, .8]) cylinder(details, "Mangote de sucção", .115, rearLength -.5, [x, -1.2, cabRoof +.05], dark)
      for (const x of [-.42, .42]) box(details, "Escada de apoio", [.08, rearLength -.4, .08], [x, -1.2, cabRoof + .04], metal)
      for (let y = -half + .5; y < .8; y += .42) box(details, "Degraus da escada", [.84, .065, .055], [0, y, cabRoof + .04], metal)
      if (type === "ABTF") box(details, "Proteção florestal", [d.width +.04, .16, .44], [0, half +.12, chassisZ + .25], dark)
      if (type === "ABTR") box(details, "Guincho de salvamento", [.8, .3, .33], [0, half +.1, chassisZ +.15], metal)
    }
    if (["AEM", "APM"].includes(type)) {
      cylinder(body, "Base giratória", .65, .3, [0, -half + 1.6, chassisZ + 1.65], dark).rotation.x = Math.PI / 2
      ladder = new THREE.Group(); ladder.name = type === "AEM" ? "Escada mecânica" : "Plataforma elevatória"
      ladder.position.set(0, -half +1.6, chassisZ +1.9)
      const span = d.length -2
      for (const side of [-1, 1]) box(ladder, "Longarina telescópica", [.13, span, .22], [side * .43, span / 2 -.5, .07], metal)
      for (let y = 0; y < span -.5; y += .42) box(ladder, "Degrau telescópico", [.88, .085, .07], [0, y, .07], metal)
      if (type === "APM") {
        box(ladder, "Cesto de trabalho", [1.45, 1.2, .18], [0, span -.7, .15], metal)
        for (const side of [-1, 1]) box(ladder, "Guarda-corpo", [.055, 1.2, .64], [side * .7, span -.7, .51], stripe)
      }
      batch(ladder); body.add(ladder)
    }
  }
  for (const side of [-1, 1]) {
    box(details, "Farol", [d.width *.2, .085, .16], [side * d.width *.32, half +.045, chassisZ +.4], lamp)
    box(body, "Luz de freio", [d.width *.12, .075, .24], [side * d.width *.38, -half -.065, chassisZ +.36], brake)
  }
  for (let i = 0; i < 4; i++) box(body, `signal.${i}`, [d.width *.18, .25, .15], [(i -1.5) * d.width *.19, type === "MOB" ? -.64 : cabY, type === "MOB" ? 1.49 : cabRoof + .14], signals[i])
  batch(details)
  const textures: THREE.Texture[] = []
  if (typeof document !== "undefined" && (appearance.show_prefix && options.prefix || appearance.unit_badge && options.unit_acronym)) {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 160
    const context = canvas.getContext("2d")
    if (context) {
      context.fillStyle = "#edf0e9"; context.fillRect(0, 0, 512, 160); context.fillStyle = "#26333b"
      context.textAlign = "center"; context.textBaseline = "middle"; context.font = "bold 70px sans-serif"
      context.fillText(appearance.show_prefix ? options.prefix ?? type : options.unit_acronym ?? type, 256, 61, 490)
      context.font = "bold 34px sans-serif"; context.fillText(appearance.unit_badge ? options.unit_acronym ?? "" : "", 256, 126, 490)
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture)
      const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }); materials.add(mat)
      const roof = new THREE.Mesh(geometry("prefix", () => new THREE.PlaneGeometry(d.width *.72, d.width *.24)), mat)
      roof.name = "Identificação no teto"; roof.position.set(0, type === "MOB" ? -.65 : cabY -.56, type === "MOB" ? 1.386 : cabRoof +.067); body.add(roof)
      if (type !== "MOB") for (const side of [-1, 1]) {
        const label = new THREE.Mesh(roof.geometry, mat); label.name = "Identificação lateral"
        label.rotation.set(Math.PI / 2, side * Math.PI / 2, 0); label.position.set(side * (d.width / 2 + .055), -.2, chassisZ + .95); body.add(label)
      }
    }
  }
  const shadowGeo = geometry("shadow", () => {
    const geo = new THREE.RingGeometry(0, 1, 24, 4), p = geo.getAttribute("position"), colors = new Float32Array(p.count *4)
    for (let i = 0; i < p.count; i++) colors.set([1, 1, 1, .28 * Math.max(0, 1 - Math.hypot(p.getX(i), p.getY(i)))], i *4)
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 4)); return geo
  })
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x10191e, vertexColors: true, transparent: true, depthWrite: false })
  const reflectionMat = new THREE.MeshBasicMaterial({ color: 0xb83a39, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  materials.add(shadowMat); materials.add(reflectionMat)
  const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.name = "Sombra de contato"
  shadow.scale.set(d.width * .75, half + .3, 1); shadow.position.z = .015; root.add(shadow)
  const reflection = new THREE.Mesh(shadowGeo, reflectionMat); reflection.name = "Reflexo do giroflex"
  reflection.scale.set(d.width *1.2, half +1, 1); reflection.position.z = .025; root.add(reflection)
  const beamGeo = geometry("beam", () => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-.65, 0, 0, .65, 0, 0, 3, 8, 0, -.65, 0, 0, 3, 8, 0, -3, 8, 0], 3))
    geo.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1, .2, 1, 1, 1, .2, 1, 1, 1, 0, 1, 1, 1, .2, 1, 1, 1, 0, 1, 1, 1, 0], 4)); return geo
  })
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xe5dfc5, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }); materials.add(beamMat)
  const beam = new THREE.Mesh(beamGeo, beamMat); beam.name = "Facho dos faróis"; beam.position.set(0, half, .03); beam.visible = false; root.add(beam)
  if (options.routeVariant && options.routeVariant !== "normal") {
    const mat = new THREE.MeshBasicMaterial({ color: options.routeVariant === "distance" ? 0xb47c34 : 0x367da2, transparent: true, opacity: .62 }); materials.add(mat)
    const lane = new THREE.Group(); lane.name = "Identificação da rota"
    for (const side of [-1, 1]) box(lane, "Faixa da rota", [.07, d.length *.7, .025], [side * (d.width / 2 +.5), 0, .025], mat)
    batch(lane); root.add(lane)
  }
  const parts = [...body.children, ...wheels].map((object, i) => ({ object, origin: object.position.clone(), offset: object.name.startsWith("wheel")
    ? new THREE.Vector3(Math.sign(object.position.x) *.8, 0, 0) : new THREE.Vector3(Math.sign(object.position.x) *.6, Math.sign(object.position.y) *.4, .28 + i *.025) }))
  states.set(root, { pool, type, body, details, wheels, doors, shutters, ladder, materials, owned, textures, signals, brake, lamp, reflection, beam, parts, frame: { seconds: 0 } })
  return root
}

export function updateVehicleModel(root: THREE.Object3D, input: VehicleModelFrame) {
  const s = states.get(root)
  if (!s || input.hidden) return
  const previousSpeed = s.frame.speedMps
  s.frame = { ...s.frame, ...input }; const f = s.frame
  s.details.visible = f.zoom === undefined || f.zoom >= 15
  const dt = Math.max(0, Math.min(input.deltaSeconds ?? 1 / 60, 1)), blend = f.reducedMotion ? 1 : 1 - Math.exp(-dt *8), motion = !f.reducedMotion
  if (motion) for (const wheel of s.wheels) wheel.rotation.x += (input.distanceMeters ?? 0) / DIMENSIONS[s.type][3]
  const lean = motion && f.moving ? THREE.MathUtils.clamp((f.turnRate ?? 0) * -.012, -.052, .052) : 0
  const accelerationPitch = f.moving && input.speedMps !== undefined && previousSpeed !== undefined && dt > 0
    ? THREE.MathUtils.clamp((input.speedMps - previousSpeed) / dt * .003, 0, .012) : 0
  s.body.rotation.y = THREE.MathUtils.lerp(s.body.rotation.y, lean, blend)
  s.body.rotation.x = THREE.MathUtils.lerp(s.body.rotation.x, motion ? f.braking ? -.018 : accelerationPitch : 0, blend)
  s.body.position.z = THREE.MathUtils.lerp(s.body.position.z, motion && f.braking ? -.045 : 0, blend)
  s.brake.emissiveIntensity = f.braking ? .9 : .08
  const phase = f.signals !== false && motion ? Math.sin(f.seconds * Math.PI * (f.arrived ? 1 : 2)) : 0
  s.signals.forEach((mat, i) => { mat.emissiveIntensity = f.signals === false ? .02 : .64 + (i % 2 ? -phase : phase) *.32 })
  ;(s.reflection.material as THREE.MeshBasicMaterial).opacity = motion && f.moving && f.signals !== false ? .3 + phase *.1 : 0
  s.beam.visible = Boolean(f.headlights ?? f.night); s.lamp.emissiveIntensity = s.beam.visible ? .9 : .15
  s.doors.forEach((door, i) => { door.rotation.z = THREE.MathUtils.lerp(door.rotation.z, f.doors ? (i === 0 ? -1 : 1) *1.05 : 0, blend) })
  s.shutters.forEach((shutter) => { shutter.scale.z = THREE.MathUtils.lerp(shutter.scale.z, f.compartments ? .12 : 1, blend) })
  if (s.ladder) s.ladder.rotation.x = THREE.MathUtils.lerp(s.ladder.rotation.x, f.ladder ? .72 : 0, blend)
  for (const part of s.parts) part.object.position.lerp(part.origin.clone().addScaledVector(part.offset, f.exploded ? 1 : 0), blend)
  s.materials.forEach((mat) => { if (mat instanceof THREE.MeshStandardMaterial) mat.wireframe = Boolean(f.wireframe) })
}

export function disposeVehicleModel(root: THREE.Object3D) {
  const state = states.get(root)
  if (!state) return
  states.delete(root)
  state.materials.forEach((material) => material.dispose()); state.textures.forEach((texture) => texture.dispose()); state.owned.forEach((geometry) => geometry.dispose())
  state.pool.users--
  if (state.pool.users === 0) { state.pool.geometries.forEach((geometry) => geometry.dispose()); pools.delete(state.type) }
}

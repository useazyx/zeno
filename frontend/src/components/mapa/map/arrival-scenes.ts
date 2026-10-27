import * as THREE from "three"
import type { OccurrenceNature } from "../../../api/types"

export const ARRIVAL_DURATION_SECONDS = 5.5
const WATER_POINTS = 160
const completedLabels: Record<OccurrenceNature, string> = {
  INCENDIO_EDIFICACAO: "Fogo controlado", INCENDIO_VEICULO: "Fogo controlado", INCENDIO_VEGETACAO: "Fogo controlado",
  CAPTURA_ANIMAL: "Animal resgatado", SALVAMENTO: "Resgate concluído", AFOGAMENTO: "Apoio de salvamento",
  ATENDIMENTO_PRE_HOSPITALAR: "Atendimento no local", PRODUTOS_PERIGOSOS: "Perímetro isolado", VISTORIA: "Vistoria no local", OUTROS: "Equipe no local",
}
interface SceneState {
  nature: OccurrenceNature; characters: boolean; materials: Set<THREE.Material>; owned: THREE.BufferGeometry[]
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; actors: THREE.Group[]; flames: THREE.Mesh[]; smoke: THREE.Mesh[]
  water?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>; hose?: THREE.Mesh; cat?: THREE.Group; tail?: THREE.Mesh
  buoy?: THREE.Mesh; cones: THREE.Mesh[]; tape?: THREE.LineLoop; patient?: THREE.Group; stretcher?: THREE.Group
  tool?: THREE.Group; label?: THREE.Sprite; textures: THREE.Texture[]
}
const states = new WeakMap<THREE.Object3D, SceneState>()
const geometries = new Map<string, THREE.BufferGeometry>()
let instances = 0
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const ease = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t) }

/** Local metres, Z up and +Y forward. The map/playback owns the only animation loop. */
export function createArrivalScene(nature: OccurrenceNature, options: { characters?: boolean } = {}): THREE.Group {
  instances++
  const root = new THREE.Group(); root.name = "Cena ilustrativa de chegada"
  const materials = new Set<THREE.Material>()
  const owned: THREE.BufferGeometry[] = [], textures: THREE.Texture[] = []
  function geometry<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
    let item = geometries.get(key)
    if (!item) { item = create(); geometries.set(key, item) }
    return item as T
  }
  function material(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
    const item = new THREE.MeshStandardMaterial({ color, roughness: .85, ...extra }); materials.add(item); return item
  }
  const khaki = material(0x9b8158), dark = material(0x29383e), reflector = material(0xd3bd70)
  const skin = material(0xcbb59c), red = material(0xb34038), metal = material(0x8d9da1), blue = material(0x668e9f)
  function box(parent: THREE.Object3D, name: string, size: [number, number, number], position: [number, number, number], mat: THREE.Material) {
    const mesh = new THREE.Mesh(geometry(`box:${size}`, () => new THREE.BoxGeometry(...size)), mat)
    mesh.name = name; mesh.position.set(...position); parent.add(mesh); return mesh
  }
  function person(protective = false) {
    const group = new THREE.Group(); group.name = protective ? "Bombeiro com proteção" : "Bombeiro"
    box(group, "Uniforme", [protective ? .52 : .42, .29, .58], [0, 0, 1.03], protective ? reflector : khaki)
    box(group, "Faixa do uniforme", [.44, .3, .07], [0, 0, 1.01], reflector)
    for (const side of [-1, 1]) {
      box(group, "Perna", [.16, .2, .57], [side * .13, 0, .43], khaki)
      box(group, "Bota", [.18, .31, .15], [side * .13, .045, .1], dark)
      box(group, "Braço", [.14, .19, .54], [side * .3, .015, 1], protective ? reflector : khaki)
    }
    const head = new THREE.Mesh(geometry("head", () => new THREE.SphereGeometry(.19, 6, 4)), skin)
    head.position.z = 1.49; group.add(head)
    const helmet = new THREE.Mesh(geometry("helmet", () => new THREE.SphereGeometry(.23, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2)), red)
    helmet.rotation.x = Math.PI / 2; helmet.position.z = 1.55; group.add(helmet)
    return group
  }
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x579b7c, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false })
  materials.add(ringMaterial)
  const ring = new THREE.Mesh(geometry("arrival-ring", () => new THREE.RingGeometry(3.8, 3.96, 48)), ringMaterial)
  ring.name = "Anel de chegada"; ring.position.z = .04; root.add(ring)
  const state: SceneState = { nature, characters: options.characters !== false, materials, owned, ring, actors: [], flames: [], smoke: [], cones: [], textures }
  states.set(root, state)
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas"); canvas.width = 384; canvas.height = 80
    const context = canvas.getContext("2d")
    if (context) {
      context.fillStyle = "#23392f"; context.fillRect(0, 0, 384, 80)
      context.fillStyle = "#dcece3"; context.textAlign = "center"; context.textBaseline = "middle"; context.font = "600 34px sans-serif"
      context.fillText("NO LOCAL", 192, 40)
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture)
      const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }); materials.add(mat)
      state.label = new THREE.Sprite(mat); state.label.scale.set(3, .625, 1); state.label.position.set(0, -.5, 4.6); root.add(state.label)
    }
  }
  if (!state.characters) { updateArrivalScene(root, 0); return root }
  const fire = nature.startsWith("INCENDIO_")
  const actorCount = fire || nature === "SALVAMENTO" || nature === "ATENDIMENTO_PRE_HOSPITALAR" ? 2 : 1
  for (let index = 0; index < actorCount; index++) { const actor = person(nature === "PRODUTOS_PERIGOSOS"); root.add(actor); state.actors.push(actor) }
  if (fire) {
    const target = new THREE.Group(); target.name = "Local da ocorrência"; target.position.set(4.5, 5.5, 0); root.add(target)
    if (nature === "INCENDIO_EDIFICACAO") {
      box(target, "Edificação", [2.8, 2.2, 3.3], [0, 0, 1.65], material(0x68777a))
      for (const x of [-.8, .8]) box(target, "Janela", [.7, .06, 1.1], [x, -1.13, 2.1], dark)
    } else if (nature === "INCENDIO_VEICULO") {
      box(target, "Veículo atendido", [1.6, 3.2, .7], [0, 0, .6], material(0x576b73))
      box(target, "Cabine do veículo atendido", [1.4, 1.5, .65], [0, 0, 1.25], dark)
    } else {
      for (let index = 0; index < 5; index++) box(target, "Faixa de vegetação", [.65, .8, .3 + index % 2 * .2], [(index -2) *.55, 0, .2], material(0x586f48))
    }
    const flameMaterial = material(0xd07632, { emissive: 0x803728, emissiveIntensity: .4 })
    const flameCore = material(0xc14d31, { emissive: 0x702721, emissiveIntensity: .3 })
    for (let index = 0; index < 6; index++) {
      const flame = new THREE.Mesh(geometry(`flame:${index % 2}`, () => new THREE.ConeGeometry(.42 + index % 2 * .1, 1.65, 6)), index % 2 ? flameCore : flameMaterial)
      flame.rotation.x = Math.PI / 2; flame.position.set(3.6 + index % 3 * .7, 4.1 + Math.floor(index / 3) * .45, .9 + (nature === "INCENDIO_EDIFICACAO" ? .8 : 0))
      root.add(flame); state.flames.push(flame)
    }
    for (let index = 0; index < 3; index++) {
      const smoke = new THREE.Mesh(geometry("smoke", () => new THREE.IcosahedronGeometry(.55, 0)), material(0x899396, { transparent: true, opacity: 0, depthWrite: false }))
      smoke.position.set(4 + index *.5, 4.6, 1.9 + index *.5); root.add(smoke); state.smoke.push(smoke)
    }
    if (nature !== "INCENDIO_VEGETACAO") {
      const positions = new Float32Array(WATER_POINTS *3), waterGeometry = new THREE.BufferGeometry()
      waterGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); owned.push(waterGeometry)
      const waterMaterial = new THREE.PointsMaterial({ color: 0xa8d2df, size: .07, transparent: true, opacity: .78, depthWrite: false }); materials.add(waterMaterial)
      state.water = new THREE.Points(waterGeometry, waterMaterial); state.water.name = "Jato de água"; state.water.frustumCulled = false; root.add(state.water)
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(1.3, -1, .18), new THREE.Vector3(2.5, -.3, .08), new THREE.Vector3(2.8, 2, .08), new THREE.Vector3(2.4, 3.7, 1)])
      state.hose = new THREE.Mesh(geometry("hose", () => new THREE.TubeGeometry(curve, 20, .055, 5, false)), dark); state.hose.name = "Mangueira"; root.add(state.hose)
    } else {
      const tool = new THREE.Group(); box(tool, "Cabo do abafador", [.055, .055, 1.5], [0, 0, .4], metal)
      box(tool, "Abafador", [.42, .07, .43], [0, 0, -.4], dark); state.actors[0].add(tool); tool.position.set(.3, .5, .7); state.tool = tool
    }
  } else if (nature === "CAPTURA_ANIMAL") {
    const trunk = new THREE.Mesh(geometry("tree-trunk", () => new THREE.CylinderGeometry(.16, .24, 3.2, 6)), material(0x82715b)); trunk.rotation.x = Math.PI / 2; trunk.position.set(3.6, 5, 1.6); root.add(trunk)
    const crown = new THREE.Mesh(geometry("tree-crown", () => new THREE.IcosahedronGeometry(1.15, 0)), material(0x5f7851)); crown.position.set(3.6, 5, 3.45); root.add(crown)
    const ladder = new THREE.Group(); ladder.name = "Escada de salvamento"; ladder.position.set(2.9, 4.1, 0); ladder.rotation.x = -.18
    for (const side of [-1, 1]) box(ladder, "Longarina", [.07, .08, 3.45], [side * .35, 0, 1.725], metal)
    for (let z = .3; z < 3.4; z += .3) box(ladder, "Degrau", [.72, .07, .055], [0, 0, z], metal)
    root.add(ladder)
    const cat = new THREE.Group(); cat.name = "Gato resgatado"
    box(cat, "Corpo do gato", [.28, .48, .25], [0, 0, .17], material(0xb2a28b))
    box(cat, "Cabeça do gato", [.24, .22, .23], [0, .26, .31], khaki)
    for (const side of [-1, 1]) box(cat, "Orelha", [.07, .08, .13], [side * .08, .26, .48], khaki)
    state.tail = box(cat, "Rabo", [.055, .4, .055], [0, -.37, .22], khaki)
    root.add(cat); state.cat = cat
  } else if (nature === "SALVAMENTO" || nature === "ATENDIMENTO_PRE_HOSPITALAR") {
    const patient = person(); patient.name = "Pessoa recebendo atendimento"; root.add(patient); state.patient = patient
    const stretcher = new THREE.Group(); stretcher.name = "Maca"
    box(stretcher, "Leito da maca", [.74, 1.9, .1], [0, 0, .67], blue)
    for (const x of [-.43, .43]) box(stretcher, "Estrutura da maca", [.065, 2.2, .08], [x, 0, .6], metal)
    for (const x of [-.32, .32]) for (const y of [-.65, .65]) box(stretcher, "Pé da maca", [.065, .065, .5], [x, y, .34], metal)
    root.add(stretcher); state.stretcher = stretcher
    if (nature === "SALVAMENTO") {
      const rope = new THREE.Mesh(geometry("rope", () => new THREE.TorusGeometry(.24, .035, 5, 18)), reflector); rope.position.set(-.32, 0, 1); state.actors[0].add(rope)
    }
  } else if (nature === "AFOGAMENTO") {
    const water = new THREE.Mesh(geometry("water-surface", () => new THREE.CircleGeometry(2.8, 16)), material(0x416c7b, { transparent: true, opacity: .7 })); water.position.set(3.6, 6.5, .05); root.add(water)
    state.buoy = new THREE.Mesh(geometry("buoy", () => new THREE.TorusGeometry(.38, .1, 6, 16)), red); state.buoy.name = "Boia de salvamento"; root.add(state.buoy)
  } else if (nature === "PRODUTOS_PERIGOSOS") {
    box(root, "Recipiente isolado", [.6, .6, .8], [4, 5.2, .4], metal)
    const positions = [[2.5, 3.7], [5.5, 3.7], [5.5, 6.7], [2.5, 6.7]]
    for (const [x, y] of positions) {
      const cone = new THREE.Mesh(geometry("safety-cone", () => new THREE.ConeGeometry(.22, .6, 8)), reflector)
      cone.rotation.x = Math.PI / 2; cone.position.set(x, y, .3); root.add(cone); state.cones.push(cone)
    }
    const tapeGeometry = geometry("tape", () => new THREE.BufferGeometry().setFromPoints(positions.map(([x, y]) => new THREE.Vector3(x, y, .65))))
    const tapeMaterial = new THREE.LineBasicMaterial({ color: 0xd3bd70 }); materials.add(tapeMaterial)
    state.tape = new THREE.LineLoop(tapeGeometry, tapeMaterial); state.tape.name = "Fita de isolamento"; root.add(state.tape)
  } else {
    const clipboard = new THREE.Group(); clipboard.name = "Prancheta de vistoria"
    box(clipboard, "Prancheta", [.3, .045, .42], [0, 0, 0], metal)
    box(clipboard, "Ficha", [.25, .05, .32], [0, .012, .015], material(0xdadfd8))
    clipboard.position.set(.3, .25, 1); state.actors[0].add(clipboard)
  }
  updateArrivalScene(root, 0)
  return root
}

/** Pure playback time: seeking backwards and skipping produce the same poses. */
export function updateArrivalScene(root: THREE.Object3D, elapsedSeconds: number, options: { reducedMotion?: boolean } = {}) {
  const state = states.get(root)
  const elapsed = options.reducedMotion ? ARRIVAL_DURATION_SECONDS : Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0)
  const progress = clamp(elapsed / ARRIVAL_DURATION_SECONDS), complete = progress === 1
  if (!state) return { complete, label: "No local", progress }
  const t = progress * ARRIVAL_DURATION_SECONDS
  const exit = ease((t - .55) / 1.25), action = ease((t - 1.8) / 2.7), returnProgress = ease((t - 4) / 1.5)
  const wave = ease(t / 1.3)
  state.ring.scale.setScalar(.55 + wave * .75); state.ring.material.opacity = .5 - wave *.3
  if (state.label) state.label.visible = t >= .9
  for (const [index, actor] of state.actors.entries()) {
    actor.visible = t > .55
    actor.position.set(THREE.MathUtils.lerp(index ? -1.5 : 1.5, 2.3 + index *.8, exit), THREE.MathUtils.lerp(.6, 3.3 + index *.35, exit), 0)
    actor.rotation.z = -.5; actor.rotation.x = 0
  }
  state.flames.forEach((flame, index) => {
    const size = Math.max(.001, 1 - action)
    flame.scale.set(size, size * (1 + (complete ? 0 : Math.sin(t * 2 + index) * .1)), size)
    flame.visible = action < .99
  })
  state.smoke.forEach((smoke, index) => {
    smoke.scale.setScalar(.6 + action * .8); smoke.position.z = 1.9 + index *.5 + action *1.6
    ;(smoke.material as THREE.MeshStandardMaterial).opacity = Math.sin(action * Math.PI) *.33
    smoke.visible = action > 0 && !complete
  })
  if (state.hose) state.hose.visible = exit > .85
  if (state.water) {
    state.water.visible = exit > .95 && action < .99
    const positions = state.water.geometry.getAttribute("position")
    for (let index = 0; index < WATER_POINTS; index++) {
      const p = (index / WATER_POINTS + t *.9) % 1, spread = Math.sin(index *2.4) * .065
      positions.setXYZ(index, 2.4 + p *1.9 + spread, 3.7 + p *.6 + spread, 1.05 + Math.sin(p * Math.PI) *1.45 + p *.1)
    }
    positions.needsUpdate = true
  }
  if (state.tool) state.tool.rotation.x = action > 0 && !complete ? Math.sin(t *5) *.35 : -.25
  if (state.cat && state.actors[0]) {
    const actor = state.actors[0], climb = ease((t - 1.3) / 1.2), descend = ease((t - 3.05) / 1.8)
    actor.position.set(THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.5, 2.7, exit), 2, returnProgress), THREE.MathUtils.lerp(.6, 4, exit) - returnProgress *2, climb *2.5 * (1 - descend))
    if (t < 2.8) state.cat.position.set(3.5, 4.7, 3)
    else state.cat.position.copy(actor.position).add(new THREE.Vector3(0, .4, 1.14))
    if (state.tail) state.tail.rotation.z = complete ? .12 : Math.sin(t *2.4) *.18
  }
  if (state.patient && state.stretcher) {
    const stretcher = state.stretcher, patient = state.patient
    stretcher.position.set(THREE.MathUtils.lerp(1.7, 3.4, exit), THREE.MathUtils.lerp(-4.6, 4.8, exit), 0)
    if (state.nature === "SALVAMENTO") {
      patient.rotation.x = Math.PI / 2
      patient.position.set(3.4, 4.2, .23 + action *.56)
    } else {
      patient.rotation.x = .18; patient.position.set(3.4, 4.8, .15)
      // Seated patient: legs point forward rather than intersecting the stretcher.
      patient.children.filter((part) => part.name === "Perna").forEach((part) => { part.rotation.x = -1.35; part.position.y = .2; part.position.z = .65 })
    }
    patient.visible = t > .6
  }
  if (state.buoy) {
    const launch = ease((t - 1.7) / 1.6)
    state.buoy.position.set(2.4 + launch *1.2, 3.4 + launch *3.1, 1.2 * (1 - launch) + Math.sin(launch * Math.PI) *1.9 + .13)
    state.buoy.rotation.x = (1 - launch) * .8; state.buoy.visible = t > 1
  }
  state.cones.forEach((cone, index) => { const scale = ease((t -1.6 -index *.25) / .45); cone.scale.setScalar(scale); cone.visible = scale > 0 })
  if (state.tape) state.tape.visible = action > .4
  return { complete, label: complete && state.characters ? completedLabels[state.nature] : "No local", progress }
}

export function disposeArrivalScene(root: THREE.Object3D) {
  const state = states.get(root)
  if (!state) return
  states.delete(root); state.materials.forEach((material) => material.dispose()); state.owned.forEach((geometry) => geometry.dispose()); state.textures.forEach((texture) => texture.dispose())
  instances--
  if (instances === 0) { geometries.forEach((geometry) => geometry.dispose()); geometries.clear() }
  root.removeFromParent()
}

import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { VehicleType } from "../../api/types"
import {
  createVehicleModel, disposeVehicleModel, updateVehicleModel, VEHICLE_MODEL_TYPES, vehicleModelDimensions,
} from "../mapa/map/vehicle-models"
import type { VehicleModelFrame, VehicleModelOptions } from "../mapa/map/vehicle-models"

export type VehicleView = "Frente" | "Trás" | "Esquerda" | "Direita" | "Cima" | "Baixo" | "3/4"
export const VEHICLE_VIEWS: VehicleView[] = ["Frente", "Trás", "Esquerda", "Direita", "Cima", "Baixo", "3/4"]
export interface Inspection {
  signals: boolean; headlights: boolean; doors: boolean; compartments: boolean
  ladder: boolean; wheels: boolean; exploded: boolean; wireframe: boolean; dimensions: boolean; rotate: boolean
}
export const DEFAULT_INSPECTION: Inspection = {
  signals: false, headlights: false, doors: false, compartments: false,
  ladder: false, wheels: false, exploded: false, wireframe: false, dimensions: false, rotate: false,
}
const thumbnailCache = new Map<VehicleType, string>()
const graphite = new THREE.Color("#202b33")
const EXPORT_WIDTH = 2400

/** One renderer, including thumbnails and export. No animation loop while idle. */
export class VehicleViewerRuntime {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(34, 1, .1, 250)
  private readonly controls: OrbitControls
  private readonly floor: THREE.Mesh
  private readonly grid: THREE.GridHelper
  private readonly resizeObserver: ResizeObserver
  private readonly media = window.matchMedia("(prefers-reduced-motion: reduce)")
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private models: THREE.Group[] = []
  private annotations: THREE.LineSegments | null = null
  private selected: THREE.BoxHelper | null = null
  private settings = { ...DEFAULT_INSPECTION }
  private frame = 0
  private lastTime = 0
  private animateUntil = 0
  private cameraMove: { start: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null
  private extent = 10
  private disposed = false
  private thumbnailTypes = [...VEHICLE_MODEL_TYPES]
  private lastThumbnailTime = 0
  private lastCanvasSize = { width: 0, height: 0 }
  private pointerStart = { x: 0, y: 0 }
  private readonly container: HTMLDivElement
  private readonly callbacks: {
    onPart: (name: string) => void
    onParts: (names: string[]) => void
    onThumbnail: (type: VehicleType, url: string) => void
    onRotateStopped: () => void
    onError: (message: string) => void
  }

  constructor(container: HTMLDivElement, callbacks: VehicleViewerRuntime["callbacks"]) {
    this.container = container
    this.callbacks = callbacks
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.35
    this.renderer.domElement.setAttribute("aria-hidden", "true")
    this.scene.background = graphite
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(13, 17, 10)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0, 1.4)
    this.controls.minDistance = 5
    this.controls.maxDistance = 48
    this.controls.enableDamping = false
    this.controls.autoRotateSpeed = .7
    this.controls.update()
    this.controls.addEventListener("change", this.invalidate)
    this.controls.addEventListener("start", this.onInteraction)
    this.scene.add(new THREE.HemisphereLight(0xdce6ec, 0x384149, 2.1))
    for (const [position, color, intensity] of [
      [[-8, 10, 14], 0xf5eee0, 3], [[10, 1, 7], 0xaac7d7, 1.4], [[0, -11, 9], 0xe1e9ef, 2.3],
    ] as const) {
      const light = new THREE.DirectionalLight(color, intensity)
      light.position.set(position[0], position[1], position[2]); this.scene.add(light)
    }
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x26333b, roughness: .95, side: THREE.DoubleSide }))
    this.floor.position.z = -.06; this.scene.add(this.floor)
    this.grid = new THREE.GridHelper(40, 40, 0x44525b, 0x33414a)
    this.grid.rotation.x = Math.PI / 2; this.grid.position.z = -.04; this.scene.add(this.grid)
    container.append(this.renderer.domElement)
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)
    document.addEventListener("visibilitychange", this.onVisibility)
    this.media.addEventListener("change", this.onPreference)
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown)
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp)
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost)
    this.resize()
    for (const [type, url] of thumbnailCache) callbacks.onThumbnail(type, url)
  }

  setModels(options: VehicleModelOptions, comparison?: VehicleModelOptions) {
    const definitions = [options, ...(comparison ? [comparison] : [])]
    const firstModel = this.models.length === 0
    const layoutChanged = this.models.map((model) => model.userData.type).join(":") !== definitions.map((model) => model.type).join(":")
    const previousFit = this.extent * (this.models.length > 1 ? 2.65 : 2.3)
    const previousOffset = this.camera.position.clone().sub(this.controls.target)
    const selectedPart = this.selected?.userData.partName as string | undefined
    this.clearSelection()
    for (const model of this.models) { this.scene.remove(model); disposeVehicleModel(model) }
    this.models = definitions.map((value) => createVehicleModel({ ...value, inspectable: true }))
    const dimensions = definitions.map((value) => vehicleModelDimensions(value.type))
    this.extent = Math.max(...dimensions.map((value) => value.length))
    for (const [index, model] of this.models.entries()) {
      model.position.x = comparison ? (index === 0 ? -1 : 1) * (dimensions[0].width + dimensions[1].width + 3) / 4 : 0
      this.scene.add(model)
    }
    this.controls.minDistance = Math.max(4, this.extent * .65)
    this.controls.maxDistance = this.extent * 5
    if (layoutChanged) this.controls.target.set(0, 0, Math.max(...dimensions.map((value) => value.height)) / 2)
    this.makeDimensions()
    const names = new Set<string>()
    this.models[0].traverse((part) => {
      if (part instanceof THREE.Mesh && part.name && !/signal\.|Sombra|Reflexo|Facho|Faixa da rota/.test(part.name)) names.add(part.name)
    })
    this.callbacks.onParts([...names].sort((a, b) => a.localeCompare(b, "pt-BR")))
    this.animateUntil = performance.now() + 650
    if (firstModel) this.setView("3/4", true)
    else if (layoutChanged) {
      const fit = this.extent * (this.models.length > 1 ? 2.65 : 2.3)
      this.camera.position.copy(previousOffset.multiplyScalar(fit / previousFit)).add(this.controls.target)
      this.cameraMove = null; this.controls.update()
    }
    if (selectedPart) this.selectPart(selectedPart)
    this.invalidate()
  }

  setInspection(settings: Inspection) {
    this.settings = { ...settings }
    this.animateUntil = performance.now() + 700
    if (this.annotations) this.annotations.visible = settings.dimensions
    this.invalidate()
  }

  setView(view: VehicleView, instant = false) {
    const distance = this.extent * (this.models.length > 1 ? 2.65 : 2.3)
    const vectors: Record<VehicleView, THREE.Vector3> = {
      Frente: new THREE.Vector3(0, distance, distance * .15), Trás: new THREE.Vector3(0, -distance, distance * .15),
      Esquerda: new THREE.Vector3(-distance, 0, distance * .15), Direita: new THREE.Vector3(distance, 0, distance * .15),
      Cima: new THREE.Vector3(0, .001, distance), Baixo: new THREE.Vector3(0, .001, -distance),
      "3/4": new THREE.Vector3(distance * .63, distance * .72, distance * .48),
    }
    this.floor.visible = view !== "Baixo"; this.grid.visible = view !== "Baixo"
    const target = vectors[view].add(this.controls.target)
    if (this.media.matches || instant) { this.camera.position.copy(target); this.cameraMove = null; this.controls.update() }
    else this.cameraMove = { start: performance.now(), from: this.camera.position.clone(), to: target }
    this.invalidate()
  }

  keyboard(key: string, shift: boolean) {
    this.onInteraction()
    const offset = this.camera.position.clone().sub(this.controls.target)
    const sphere = new THREE.Spherical().setFromVector3(new THREE.Vector3(offset.x, offset.z, offset.y))
    const step = .13
    if (key === "+" || key === "=") sphere.radius = Math.max(this.controls.minDistance, sphere.radius * .9)
    else if (key === "-") sphere.radius = Math.min(this.controls.maxDistance, sphere.radius * 1.1)
    else if (shift) {
      const pan = new THREE.Vector3(key === "ArrowLeft" ? -.35 : key === "ArrowRight" ? .35 : 0, 0, key === "ArrowUp" ? .35 : -.35)
      this.controls.target.add(pan); this.camera.position.add(pan); this.controls.update(); this.invalidate(); return
    } else {
      sphere.theta += key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0
      sphere.phi = THREE.MathUtils.clamp(sphere.phi + (key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0), .001, Math.PI - .001)
    }
    const position = new THREE.Vector3().setFromSpherical(sphere)
    this.camera.position.set(position.x, position.z, position.y).add(this.controls.target)
    this.controls.update(); this.invalidate()
  }

  /** A clicked mesh wins over the name lookup, so the right-hand door is not swapped for the left one. */
  selectPart(name: string, picked?: THREE.Object3D) {
    this.clearSelection()
    let owned = false
    picked?.traverseAncestors((ancestor) => { if (ancestor === this.models[0]) owned = true })
    const object = owned ? picked : this.models[0]?.getObjectByName(name)
    if (object) {
      this.models[0].updateMatrixWorld(true)
      this.selected = new THREE.BoxHelper(object, 0xe2c578)
      this.selected.userData.partName = name
      this.scene.add(this.selected)
    }
    this.callbacks.onPart(object ? name : ""); this.invalidate()
  }

  async exportPng(transparent: boolean) {
    const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio()
    const background = this.scene.background, floorVisible = this.floor.visible, gridVisible = this.grid.visible
    try {
      if (transparent) { this.scene.background = null; this.floor.visible = false; this.grid.visible = false }
      this.renderer.setPixelRatio(1)
      this.renderer.setSize(EXPORT_WIDTH, Math.round(EXPORT_WIDTH * size.y / size.x), false)
      this.renderer.render(this.scene, this.camera)
      const blob = await new Promise<Blob | null>((resolve) => this.renderer.domElement.toBlob(resolve, "image/png"))
      if (!blob) throw new Error("Não foi possível gerar a imagem.")
      const url = URL.createObjectURL(blob), link = document.createElement("a")
      link.href = url; link.download = "zeno-garagem.png"; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      this.scene.background = background; this.floor.visible = floorVisible; this.grid.visible = gridVisible
      this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x, size.y, false); this.invalidate()
    }
  }

  private makeDimensions() {
    if (this.annotations) { this.scene.remove(this.annotations); this.annotations.geometry.dispose(); (this.annotations.material as THREE.Material).dispose() }
    const points: THREE.Vector3[] = []
    const line = (a: number[], b: number[]) => { points.push(new THREE.Vector3(...a as [number, number, number]), new THREE.Vector3(...b as [number, number, number])) }
    for (const model of this.models) {
      const d = vehicleModelDimensions(model.userData.type), x = model.position.x
      line([x - d.width / 2 - .6, -d.length / 2, .06], [x - d.width / 2 - .6, d.length / 2, .06])
      line([x - d.width / 2, -d.length / 2 - .6, .06], [x + d.width / 2, -d.length / 2 - .6, .06])
      line([x + d.width / 2 + .6, -d.length / 2, .06], [x + d.width / 2 + .6, -d.length / 2, d.height])
      for (const y of [-d.length / 2, d.length / 2]) line([x - d.width / 2 - .85, y, .06], [x - d.width / 2 - .35, y, .06])
      for (const end of [-1, 1]) line([x + end * d.width / 2, -d.length / 2 - .85, .06], [x + end * d.width / 2, -d.length / 2 - .35, .06])
      for (const z of [.06, d.height]) line([x + d.width / 2 + .35, -d.length / 2, z], [x + d.width / 2 + .85, -d.length / 2, z])
    }
    this.annotations = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xb4c9d0, depthTest: false }))
    this.annotations.visible = this.settings.dimensions; this.scene.add(this.annotations)
  }

  private generateThumbnail(type: VehicleType) {
    if (thumbnailCache.has(type)) return
    const model = createVehicleModel({ type }), scene = new THREE.Scene(), d = vehicleModelDimensions(type)
    const camera = new THREE.PerspectiveCamera(34, 1.7, .1, 100)
    camera.up.set(0, 0, 1); camera.position.set(d.length *1.5, d.length *1.6, d.length *1.1); camera.lookAt(0, 0, d.height / 2)
    scene.add(model, new THREE.HemisphereLight(0xe3ecf0, 0x4d5356, 3.5))
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-5, 8, 10); scene.add(light)
    const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio()
    try {
      this.renderer.setPixelRatio(1); this.renderer.setSize(170, 100, false); this.renderer.render(scene, camera)
      const url = this.renderer.domElement.toDataURL("image/png")
      thumbnailCache.set(type, url); this.callbacks.onThumbnail(type, url)
    } finally { disposeVehicleModel(model); this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x, size.y, false) }
  }

  private render = (now: number) => {
    this.frame = 0
    if (document.hidden || this.disposed) return
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, .05) : 1 / 60
    this.lastTime = now
    const motion = !this.media.matches
    const input: VehicleModelFrame = { ...this.settings, seconds: now / 1000, deltaSeconds: dt, reducedMotion: !motion, moving: this.settings.wheels, speedMps: this.settings.wheels ? 2 : 0, distanceMeters: this.settings.wheels && motion ? dt * 2 : 0 }
    this.models.forEach((model) => updateVehicleModel(model, input))
    if (this.cameraMove) {
      const t = motion ? Math.min(1, (now - this.cameraMove.start) / 500) : 1
      this.camera.position.lerpVectors(this.cameraMove.from, this.cameraMove.to, t * t * (3 - 2 * t))
      this.controls.update(); if (t === 1) this.cameraMove = null
    }
    this.controls.autoRotate = motion && this.settings.rotate
    if (this.controls.autoRotate) this.controls.update(dt)
    if (this.selected) this.selected.update()
    // Spread costly off-screen renders across frames to avoid a burst of WebGL work on entry.
    if (this.thumbnailTypes.length && (!this.lastThumbnailTime || now - this.lastThumbnailTime >= 120)) {
      const thumbnail = this.thumbnailTypes.shift()
      if (thumbnail) this.generateThumbnail(thumbnail)
      this.lastThumbnailTime = now
    }
    this.renderer.render(this.scene, this.camera)
    if (this.thumbnailTypes.length || this.cameraMove || motion && (this.settings.rotate || this.settings.signals || this.settings.wheels || now < this.animateUntil)) this.invalidate()
  }
  private invalidate = () => { if (!this.frame && !this.disposed && !document.hidden) this.frame = requestAnimationFrame(this.render) }
  private resize = () => {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight)
    if (this.lastCanvasSize.width === width && this.lastCanvasSize.height === height) return
    this.lastCanvasSize = { width, height }
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.invalidate()
  }
  private onVisibility = () => { if (document.hidden) { cancelAnimationFrame(this.frame); this.frame = 0; this.lastTime = 0 } else this.invalidate() }
  private onPreference = () => this.invalidate()
  private onInteraction = () => {
    this.cameraMove = null
    if (this.settings.rotate) { this.settings.rotate = false; this.callbacks.onRotateStopped() }
  }
  private onPointerDown = (event: PointerEvent) => { this.pointerStart = { x: event.clientX, y: event.clientY } }
  private onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.models[0]?.children ?? [], true).find((item) => !/Sombra|Reflexo|Facho/.test(item.object.name))
    if (hit) this.selectPart(hit.object.name, hit.object)
  }
  private onContextLost = (event: Event) => { event.preventDefault(); this.callbacks.onError("O visualizador perdeu o contexto gráfico. Reabra a Garagem para tentar novamente.") }
  private clearSelection() {
    if (!this.selected) return
    this.scene.remove(this.selected); this.selected.geometry.dispose(); (this.selected.material as THREE.Material).dispose(); this.selected = null
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.controls.dispose()
    document.removeEventListener("visibilitychange", this.onVisibility); this.media.removeEventListener("change", this.onPreference)
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown); this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp)
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost)
    this.clearSelection(); this.models.forEach(disposeVehicleModel)
    this.floor.geometry.dispose(); (this.floor.material as THREE.Material).dispose()
    this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose()
    if (this.annotations) { this.annotations.geometry.dispose(); (this.annotations.material as THREE.Material).dispose() }
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove()
  }
}

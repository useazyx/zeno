import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { OBJLoader } from "three/addons/loaders/OBJLoader.js"
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js"

type SceneControls = { update: (active: boolean, animate: boolean, stage: number) => void }

export default function NeuralBrainScene({ active, animate, stage }: { active: boolean; animate: boolean; stage: number }) {
  const host = useRef<HTMLDivElement>(null)
  const controls = useRef<SceneControls | null>(null)
  const [status, setStatus] = useState("Carregando cérebro 3D…")

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }) }
    catch { Promise.resolve().then(() => setStatus("Visualização 3D indisponível. Explore as etapas abaixo.")); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    const canvas = renderer.domElement
    canvas.tabIndex = 0
    canvas.setAttribute("role", "img")
    canvas.setAttribute("aria-label", "Cérebro 3D ilustrativo. Arraste para girar, ou use as setas do teclado. Home restaura a vista. Não representa ativações do modelo.")
    element.appendChild(canvas)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 50)
    camera.position.set(0, .1, 5.1)
    camera.lookAt(0, 0, 0)
    scene.add(new THREE.HemisphereLight(0xc5e4ef, 0x263039, 2.1))
    const key = new THREE.DirectionalLight(0xe7f0ee, 3.3)
    key.position.set(-3, 5, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x78acc1, 2.5)
    rim.position.set(3, 1, -2)
    scene.add(rim)
    const brain = new THREE.Group()
    const reset = () => brain.rotation.set(.16, -.64, -.06)
    reset()
    scene.add(brain)
    const material = new THREE.MeshStandardMaterial({ color: 0x9aafb5, roughness: .6, metalness: .12 })
    // A schematic sweep links the specimen to the selected explanatory stage.
    // It does not use or imply anatomical activation measurements.
    const signal = { center: { value: -1 }, width: { value: .12 }, strength: { value: 0 }, color: { value: new THREE.Color(0x367f9f) } }
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { signalCenter: signal.center, signalWidth: signal.width, signalStrength: signal.strength, signalColor: signal.color })
      shader.vertexShader = `varying vec3 specimenPosition;\n${shader.vertexShader}`.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nspecimenPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = `varying vec3 specimenPosition;\nuniform float signalCenter;\nuniform float signalWidth;\nuniform float signalStrength;\nuniform vec3 signalColor;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat band = 1.0 - smoothstep(signalWidth * 0.3, signalWidth, abs(specimenPosition.x - signalCenter));\ntotalEmissiveRadiance += signalColor * band * signalStrength;')
    }
    let currentStage = 0
    let disposed = false, enabled = true, moving = false, frame = 0, last = 0
    const render = () => { if (!disposed && enabled) renderer.render(scene, camera) }
    const tick = (time: number) => {
      frame = 0
      if (disposed || !enabled || !moving) return
      if (time - last >= 1000 / 30) {
        brain.rotation.y += Math.min((time - last) / 1000, .05) * .08
        signal.center.value = -1.35 + ((time / 4500) % 1) * 2.7
        render()
        last = time
      }
      frame = requestAnimationFrame(tick)
    }
    const update = (isActive: boolean, isAnimating: boolean, nextStage = currentStage) => {
      currentStage = nextStage
      signal.center.value = [-.85, -.4, .2, .8][nextStage]
      signal.width.value = [.16, .35, .85, .23][nextStage]
      signal.strength.value = nextStage === 0 ? .22 : .8
      signal.color.value.set(nextStage === 3 ? 0xa78346 : 0x367f9f)
      enabled = isActive
      moving = isAnimating
      cancelAnimationFrame(frame)
      frame = 0
      if (enabled) {
        render()
        if (moving) { last = performance.now(); frame = requestAnimationFrame(tick) }
      }
    }
    controls.current = { update }
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth, height = element.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      render()
    })
    resize.observe(element)
    const abort = new AbortController()
    fetch(`${import.meta.env.BASE_URL}models/brain.obj`, { signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error("Model unavailable"); return response.text() })
      .then(source => {
        if (disposed) return
        const model = new OBJLoader().parse(source)
        model.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return
          const original = object.geometry
          original.deleteAttribute("normal")
          object.geometry = mergeVertices(original)
          object.geometry.computeVertexNormals()
          original.dispose()
          const previous = Array.isArray(object.material) ? object.material : [object.material]
          previous.forEach(value => value.dispose())
          object.material = material
        })
        const bounds = new THREE.Box3().setFromObject(model)
        const center = bounds.getCenter(new THREE.Vector3())
        const size = bounds.getSize(new THREE.Vector3())
        const scale = 2.6 / Math.max(size.x, size.y, size.z)
        model.position.copy(center).multiplyScalar(-scale)
        model.scale.setScalar(scale)
        brain.add(model)
        setStatus("")
        render()
      })
      .catch(error => { if (!disposed && error.name !== "AbortError") setStatus("Modelo 3D indisponível. As etapas continuam disponíveis abaixo.") })
    let pointer: { id: number; x: number; y: number } | null = null
    const down = (event: PointerEvent) => {
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return
      brain.rotation.y += (event.clientX - pointer.x) * .009
      brain.rotation.x = THREE.MathUtils.clamp(brain.rotation.x + (event.clientY - pointer.y) * .006, -.8, .8)
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
      render()
    }
    const up = () => { pointer = null }
    const keydown = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return
      event.preventDefault()
      if (event.key === "Home") reset()
      if (event.key === "ArrowLeft") brain.rotation.y -= .15
      if (event.key === "ArrowRight") brain.rotation.y += .15
      if (event.key === "ArrowUp") brain.rotation.x = Math.max(-.8, brain.rotation.x - .15)
      if (event.key === "ArrowDown") brain.rotation.x = Math.min(.8, brain.rotation.x + .15)
      render()
    }
    canvas.addEventListener("pointerdown", down)
    canvas.addEventListener("pointermove", move)
    canvas.addEventListener("pointerup", up)
    canvas.addEventListener("pointercancel", up)
    canvas.addEventListener("keydown", keydown)
    const lost = (event: Event) => { event.preventDefault(); update(false, false); setStatus("Visualização 3D pausada. Reabra esta seção para recarregar.") }
    canvas.addEventListener("webglcontextlost", lost)
    return () => {
      disposed = true
      controls.current = null
      abort.abort()
      resize.disconnect()
      cancelAnimationFrame(frame)
      canvas.removeEventListener("pointerdown", down)
      canvas.removeEventListener("pointermove", move)
      canvas.removeEventListener("pointerup", up)
      canvas.removeEventListener("pointercancel", up)
      canvas.removeEventListener("keydown", keydown)
      canvas.removeEventListener("webglcontextlost", lost)
      brain.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() })
      material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [])

  useEffect(() => { controls.current?.update(active, animate, stage) }, [active, animate, stage])

  return <div ref={host} className="neural-brain-view">
    {status ? <div className="neural-brain-placeholder" role="status">{status}</div> : <span className="neural-brain-help">ARRASTE PARA EXPLORAR</span>}
  </div>
}

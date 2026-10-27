import { useEffect, useRef, useState } from "react"
import { Download, RotateCcw } from "lucide-react"
import type { VehicleType } from "../../api/types"
import { vehicleModelDimensions } from "../mapa/map/vehicle-models"
import type { VehicleModelOptions } from "../mapa/map/vehicle-models"
import { DEFAULT_INSPECTION, VEHICLE_VIEWS, VehicleViewerRuntime } from "./viewer-runtime"
import type { Inspection, VehicleView } from "./viewer-runtime"
import { useVisualMotion } from "../../hooks/use-visual-motion"

interface Props {
  model: VehicleModelOptions
  comparison?: VehicleModelOptions
  onThumbnail: (type: VehicleType, url: string) => void
  presentation?: boolean
}
const inspections: { key: keyof Inspection; label: string; animated?: boolean }[] = [
  { key: "signals", label: "Giroflex", animated: true }, { key: "headlights", label: "Faróis" },
  { key: "doors", label: "Portas da cabine" }, { key: "compartments", label: "Compartimentos" },
  { key: "ladder", label: "Escada / plataforma" }, { key: "wheels", label: "Rodas", animated: true },
  { key: "exploded", label: "Vista explodida" }, { key: "wireframe", label: "Raio-X" }, { key: "dimensions", label: "Medidas" },
]
const measure = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function VehicleViewer({ model, comparison, onThumbnail, presentation = false }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const runtime = useRef<VehicleViewerRuntime | null>(null)
  const [inspection, setInspection] = useState<Inspection>({ ...DEFAULT_INSPECTION, rotate: presentation })
  const [view, setView] = useState<VehicleView>("3/4")
  const [part, setPart] = useState("")
  const [parts, setParts] = useState<string[]>([])
  const [error, setError] = useState("")
  const [transparent, setTransparent] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { reduced } = useVisualMotion()

  useEffect(() => {
    if (!container.current) return
    try {
      runtime.current = new VehicleViewerRuntime(container.current, {
        onPart: setPart, onParts: setParts, onThumbnail, onError: setError,
        onRotateStopped: () => setInspection((value) => ({ ...value, rotate: false })),
      })
    } catch {
      // The textual catalogue and editing remain usable without WebGL.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("Não foi possível iniciar o 3D neste dispositivo. A ficha da frota continua disponível.")
    }
    return () => { runtime.current?.dispose(); runtime.current = null }
  }, [onThumbnail])
  useEffect(() => { runtime.current?.setModels(model, comparison) }, [model, comparison])
  useEffect(() => { runtime.current?.setInspection(inspection) }, [inspection])
  useEffect(() => {
    if (!presentation) return
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ step: string; paused: boolean }>).detail
      setInspection((value) => ({ ...value, rotate: detail.step === "garage" && !detail.paused }))
    }
    window.addEventListener("zeno:presentation", listener)
    return () => window.removeEventListener("zeno:presentation", listener)
  }, [presentation])

  function selectView(next: VehicleView) { setView(next); runtime.current?.setView(next) }
  async function download() {
    setExporting(true)
    try { await runtime.current?.exportPng(transparent) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao gerar a imagem.") }
    finally { setExporting(false) }
  }

  return <section className="garage-viewer" aria-label="Inspeção tridimensional">
    <div className="garage-stage"
      role="group" aria-label="Visualizador 3D. Setas giram, mais e menos alteram o zoom. Shift e setas deslocam. Teclas 1 a 7 escolhem vistas."
      tabIndex={0} onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        const index = Number(event.key) - 1
        if (index >= 0 && index < VEHICLE_VIEWS.length) { event.preventDefault(); selectView(VEHICLE_VIEWS[index]); return }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) {
          event.preventDefault(); runtime.current?.keyboard(event.key, event.shiftKey)
        }
      }}>
      <div className="garage-canvas" ref={container} />
      <div className="garage-stage-caption"><span>INSPEÇÃO DA FROTA</span><strong>{model.prefix ?? model.type}{comparison ? ` / ${comparison.prefix ?? comparison.type}` : ""}</strong></div>
      <div className="garage-stage-axis" aria-hidden="true">Z ↑ · FRENTE +Y</div>
      {error && <p className="garage-viewer-error" role="alert">{error}</p>}
      {inspection.dimensions && <div className="garage-measures">
        {[model, ...(comparison ? [comparison] : [])].map((item, index) => {
          const d = vehicleModelDimensions(item.type)
          return <div key={index}><strong>{item.type}</strong> C {measure(d.length)} m · L {measure(d.width)} m · A {measure(d.height)} m</div>
        })}
        <small>Proporções ilustrativas dos modelos 3D.</small>
      </div>}
      <p className="garage-canvas-help">Arraste para girar · Roda para aproximar · Botão direito para mover</p>
    </div>
    <div className="garage-views" aria-label="Vistas da viatura">
      {VEHICLE_VIEWS.map((name, index) => <button type="button" key={name} aria-pressed={view === name} title={`Tecla ${index + 1}`} onClick={() => selectView(name)}>{name}</button>)}
      <button type="button" disabled={reduced} aria-pressed={inspection.rotate} onClick={() => setInspection((value) => ({ ...value, rotate: !value.rotate }))}><RotateCcw size={14} /> Girar</button>
    </div>
    <div className="garage-inspection">
      <div className="garage-section-title"><h2>Inspecionar montagem</h2><span>Selecione uma peça no modelo</span></div>
      <div className="garage-toggles">
        {inspections.map(({ key, label, animated }) => <label key={key}><input type="checkbox" checked={inspection[key]}
          disabled={animated && key === "wheels" && reduced || key === "ladder" && ![model.type, comparison?.type].some((type) => type === "AEM" || type === "APM") || ["doors", "compartments"].includes(key) && model.type === "MOB" && !comparison}
          onChange={(event) => setInspection((value) => ({ ...value, [key]: event.target.checked }))} />{label}</label>)}
      </div>
      <div className="garage-inspection-bottom">
        <label className="garage-piece">Peça <select aria-label="Selecionar peça do modelo" value={parts.includes(part) ? part : ""} onChange={(event) => runtime.current?.selectPart(event.target.value)}>
          <option value="">Nenhuma selecionada</option>{parts.map((name) => <option key={name}>{name}</option>)}
        </select></label>
        <div className="garage-export"><label><input type="checkbox" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} />Fundo transparente</label>
          <button type="button" disabled={!!error || exporting} onClick={() => void download()}><Download size={15} />{exporting ? "Gerando…" : "Baixar PNG"}</button></div>
      </div>
      <p className="garage-viewer-note" aria-live="polite">{part ? `Peça selecionada: ${part}. ` : ""}{reduced ? "Movimento reduzido ativo: peças em posição fixa." : "Giro automático pausa ao interagir. Sem animação ativa, a cena fica em repouso."}</p>
    </div>
  </section>
}

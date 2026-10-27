import { useEffect, useMemo, useRef, useState } from "react"
import { Crosshair, Pause, Play, RotateCcw } from "lucide-react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import type { EdgeCosts, RoutePreview } from "@/api/types"
import { ai } from "@/api/endpoints"
import { ActionButton } from "@/components/layout/kit"
import { ErrorBox } from "@/components/layout/feedback"
import { useMutation } from "@/hooks/use-resource"
import { useVisualMotion } from "@/hooks/use-visual-motion"
import { mapStyle } from "./constants/constants"
import { explorationFeatures, localStreetGraph } from "./coverage-ai-policy"
import "./coverage-ai.css"

type Coordinate = [number, number]
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] }

export function NeuralStreetsMap({ data }: { data: EdgeCosts }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [origin, setOrigin] = useState<Coordinate | null>(null)
  const [destination, setDestination] = useState<Coordinate | null>(null)
  const [picking, setPicking] = useState<"origin" | "destination" | null>(null)
  const pickRef = useRef(picking)
  const [route, setRoute] = useState<RoutePreview | null>(null)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState<{ street: string; cost: number | null } | null>(null)
  const elapsed = useRef(0)
  const motion = useVisualMotion()
  const graph = useMemo(() => localStreetGraph(data.features), [data])
  const first = graph.nodes[0], last = graph.nodes[graph.nodes.length - 1]
  const start: Coordinate | null = origin ?? (first ? [first.longitude, first.latitude] : null)
  const end: Coordinate | null = destination ?? (last ? [last.longitude, last.latitude] : null)
  const startKey = start?.join(","), endKey = end?.join(",")
  const costs = useMemo(() => data.features.map(feature => feature.properties?.cost_seconds).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0).sort((a, b) => a - b), [data])
  const upper = Math.max(.1, costs[Math.floor((costs.length - 1) * .95)] ?? 1)
  const request = useMutation((input: { origin: Coordinate; destination: Coordinate }) => ai.calculateRoute({
    origin_latitude: input.origin[1], origin_longitude: input.origin[0], destination_latitude: input.destination[1], destination_longitude: input.destination[0], trace: true,
  }))
  const trace = route?.exploration ?? []
  const shownProgress = motion.reduced ? 1 : progress

  useEffect(() => { pickRef.current = picking }, [picking])
  useEffect(() => {
    if (!container.current) return
    const map = new maplibregl.Map({ container: container.current, style: mapStyle(), center: [-45.5551, -23.0264], zoom: 12, pixelRatio: Math.min(window.devicePixelRatio, 1.5) })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")
    map.on("load", () => {
      for (const name of ["ai-streets", "ai-exploration", "ai-result", "ai-endpoints"]) map.addSource(name, { type: "geojson", data: EMPTY })
      map.addLayer({ id: "ai-costs", type: "line", source: "ai-streets", paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 15, 4], "line-color": "#6CA4B8", "line-opacity": 0, "line-opacity-transition": { duration: 450 } } })
      map.addLayer({ id: "ai-exploration", type: "circle", source: "ai-exploration", paint: { "circle-radius": ["case", ["get", "frontier"], 4, 2], "circle-color": ["case", ["get", "frontier"], "#D4B076", "#78ADC3"], "circle-opacity": .8 } })
      map.addLayer({ id: "ai-result", type: "line", source: "ai-result", paint: { "line-color": "#76C7A2", "line-width": 5, "line-opacity": .95 } })
      map.addLayer({ id: "ai-endpoints", type: "circle", source: "ai-endpoints", paint: { "circle-color": ["get", "color"], "circle-radius": 7, "circle-stroke-color": "#192B37", "circle-stroke-width": 2 } })
      setReady(true)
    })
    const pick = (point: maplibregl.LngLat) => {
      if (!pickRef.current) return
      const value: Coordinate = [point.lng, point.lat]
      if (pickRef.current === "origin") setOrigin(value); else setDestination(value)
      setPicking(null); setRoute(null); setPlaying(false); setProgress(0)
    }
    map.on("click", event => pick(event.lngLat))
    const keyboard = (event: KeyboardEvent) => {
      if (!pickRef.current || !["Enter", " "].includes(event.key)) return
      event.preventDefault(); pick(map.getCenter())
    }
    map.getCanvas().addEventListener("keydown", keyboard)
    map.on("mousemove", "ai-costs", event => {
      const properties = event.features?.[0]?.properties
      setHover(properties ? { street: String(properties.street || "Via sem nome"), cost: typeof properties.cost_seconds === "number" ? properties.cost_seconds : null } : null)
    })
    map.on("mouseleave", "ai-costs", () => setHover(null))
    return () => { map.getCanvas().removeEventListener("keydown", keyboard); map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource("ai-streets") as maplibregl.GeoJSONSource).setData(data)
    map.setPaintProperty("ai-costs", "line-color", ["case", ["==", ["get", "cost_seconds"], null], "#85939E", ["interpolate", ["linear"], ["get", "cost_seconds"], 0, "#6CA4B8", upper / 2, "#C3B388", upper, "#CA9271"]])
    map.setPaintProperty("ai-costs", "line-opacity-transition", { duration: motion.animate ? 450 : 0 })
    map.setPaintProperty("ai-costs", "line-opacity", .85)
  }, [data, ready, upper, motion.animate])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const features: GeoJSON.Feature<GeoJSON.Point>[] = []
    if (startKey) features.push({ type: "Feature", properties: { color: "#78ADC3" }, geometry: { type: "Point", coordinates: startKey.split(",").map(Number) } })
    if (endKey) features.push({ type: "Feature", properties: { color: "#D4B076" }, geometry: { type: "Point", coordinates: endKey.split(",").map(Number) } })
    ;(map.getSource("ai-endpoints") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features })
  }, [startKey, endKey, ready])

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas()
    if (!canvas) return
    canvas.style.cursor = picking ? "crosshair" : ""
    canvas.setAttribute("aria-label", picking ? "Mova o mapa com as setas e pressione Enter para escolher o ponto central." : "Custos previstos nas ruas. Use as setas para mover o mapa.")
    if (picking) canvas.focus({ preventScroll: true })
  }, [picking])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource("ai-exploration") as maplibregl.GeoJSONSource).setData(explorationFeatures(route?.exploration ?? [], shownProgress))
    ;(map.getSource("ai-result") as maplibregl.GeoJSONSource).setData(route && shownProgress >= 1 ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.geometry.map(([latitude, longitude]) => [longitude, latitude]) } } : EMPTY)
  }, [route, shownProgress, ready])

  useEffect(() => {
    if (!playing || !motion.animate || !trace.length) return
    let frame = 0, previous = 0, painted = 0
    const tick = (now: number) => {
      if (previous) elapsed.current += Math.min(100, now - previous)
      previous = now
      if (now - painted >= 80 || elapsed.current >= 6000) { setProgress(Math.min(1, elapsed.current / 6000)); painted = now }
      if (elapsed.current >= 6000) { setPlaying(false); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, motion.animate, trace.length])

  useEffect(() => {
    const presentation = (event: Event) => {
      const detail = (event as CustomEvent<{ step: string; paused: boolean }>).detail
      if (detail?.step === "ai") setPlaying(!detail.paused)
    }
    window.addEventListener("zeno:presentation", presentation)
    return () => window.removeEventListener("zeno:presentation", presentation)
  }, [])

  async function calculate() {
    if (!start || !end) return
    setPicking(null); setRoute(null); setPlaying(false); setProgress(0)
    const result = await request.run({ origin: start, destination: end })
    if (!result) return
    elapsed.current = 0
    setRoute(result.neural)
    setProgress(motion.reduced || !result.neural.exploration?.length ? 1 : 0)
    setPlaying(!motion.reduced && Boolean(result.neural.exploration?.length))
    const bounds = new maplibregl.LngLatBounds()
    for (const [latitude, longitude] of result.neural.geometry) bounds.extend([longitude, latitude])
    if (!bounds.isEmpty()) mapRef.current?.fitBounds(bounds, { padding: 55, duration: motion.animate ? 450 : 0, maxZoom: 15 })
  }

  return <div className="ai-streets">
    <div className="ai-streets-toolbar">
      <p>{data.features.length.toLocaleString("pt-BR")} arestas · modelo {data.model_version ?? "não informado"}. Escolha dois pontos para acompanhar a busca real.</p>
      <ActionButton disabled={request.submitting} aria-pressed={picking === "origin"} onClick={() => setPicking(value => value === "origin" ? null : "origin")}><Crosshair size={15} />Origem</ActionButton>
      <ActionButton disabled={request.submitting} aria-pressed={picking === "destination"} onClick={() => setPicking(value => value === "destination" ? null : "destination")}><Crosshair size={15} />Destino</ActionButton>
      <ActionButton tone="primary" onClick={calculate} disabled={request.submitting || !start || !end}>{request.submitting ? "Calculando…" : "Mostrar busca"}</ActionButton>
    </div>
    {request.error && <ErrorBox message={request.error} />}
    <div className="ai-streets-map">
      <div ref={container} className="absolute inset-0" />
      {picking && <><span className="coverage-pick-target" aria-hidden /><p className="coverage-pick-hint" role="status">{picking === "origin" ? "Origem" : "Destino"}: clique no mapa ou use setas e Enter no ponto central.</p></>}
      {hover && <p className="coverage-gap-tooltip">{hover.street} · {hover.cost === null ? "sem custo reportado" : `${hover.cost.toFixed(1).replace(".", ",")} s previstos`}</p>}
    </div>
    <div className="ai-streets-legend" aria-label="Legenda de custo por aresta">
      <span><i style={{ background: "#6CA4B8" }} />0 s</span><span><i style={{ background: "#C3B388" }} />{(upper / 2).toFixed(1)} s</span><span><i style={{ background: "#CA9271" }} />≥ {upper.toFixed(1)} s</span><span><i style={{ background: "#76C7A2" }} />Rota encontrada</span>
    </div>
    <p className="text-sm text-ink-muted">Custo = tempo total previsto para atravessar a aresta, incluindo seu comprimento. Cor não representa trânsito ao vivo. Origem azul; destino âmbar.</p>
    {route && <div className="ai-streets-toolbar">
      <ActionButton disabled={motion.reduced || !trace.length} onClick={() => { if (progress >= 1) { elapsed.current = 0; setProgress(0) }; setPlaying(value => progress >= 1 || !value) }}>{playing && progress < 1 ? <Pause size={15} /> : <Play size={15} />}{playing && progress < 1 ? "Pausar busca" : "Reproduzir busca"}</ActionButton>
      <ActionButton onClick={() => { setPlaying(false); setProgress(1); elapsed.current = 6000 }}><RotateCcw size={15} />Resultado final</ActionButton>
      <p role="status">{Math.floor(trace.length * shownProgress).toLocaleString("pt-BR")} / {trace.length.toLocaleString("pt-BR")} nós do rastro · {route.estimated_time_seconds.toFixed(1)} s previstos</p>
      <p>Ordem de visita registrada pela busca bidirecional; nós claros mostram as visitas mais recentes. Reprodução didática de 6 s, independente do tempo de cálculo. O serviço limita o rastro a 4.000 nós.{!trace.length && " Esta resposta não trouxe rastro de exploração."}{motion.reduced && " Movimento reduzido: resultado estático."}</p>
    </div>}
  </div>
}

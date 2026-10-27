/**
 * The route laboratory.
 *
 * Asks the AI for a route between two points without touching a dispatch —
 * `POST /ai/routes` without `dispatch_id` answers both variants and persists
 * nothing. It is the screen that demonstrates the model outside of a real
 * incident: pick a station, pick a destination, compare.
 */

import { useMemo, useState } from "react"
import type { FormEvent } from "react"
import { Ban, Brain, Compass, ListOrdered, MapPin, Play, Route as RouteIcon, Sparkles, X } from "lucide-react"

import { ai, units } from "@/api/endpoints"
import type { Closure, RoutePreview, RouteStep } from "@/api/types"
import {
  ActionButton, Field, Page, PageHeader, Panel, Select, TextInput,
} from "@/components/layout/kit"
import { ErrorBox, ErrorDetails } from "@/components/layout/feedback"
import RouteMap from "@/components/mapa/route-map"
import { COMPARISON_COLOR, CRITICAL_COLOR, ROUTE_COLOR } from "@/components/mapa/constants/constants"
import { RouteBenchmark } from "@/components/route/route-benchmark"
import { RouteInsight } from "@/components/route/route-insight"
import { RouteSteps } from "@/components/route/route-steps"
import { useMutation, useResource } from "@/hooks/use-resource"
import { formatCoordinate, formatDistance, formatDuration } from "@/lib/format"
import { nearestTo, stationsOf } from "@/lib/geo"

/** Taubaté's centre — a sane starting point for the destination fields. */
const DEFAULT_DESTINATION = { latitude: "-23.0330", longitude: "-45.5620" }

export default function Rotas() {
  const unitList = useResource(() => units.list({ active: true }), [])

  const [originMode, setOriginMode] = useState<"unit" | "coords">("unit")
  const [unitId, setUnitId] = useState("")
  const [originLatitude, setOriginLatitude] = useState("-23.0264")
  const [originLongitude, setOriginLongitude] = useState("-45.5551")
  const [destinationLatitude, setDestinationLatitude] = useState(DEFAULT_DESTINATION.latitude)
  const [destinationLongitude, setDestinationLongitude] = useState(DEFAULT_DESTINATION.longitude)
  const [criticalMode, setCriticalMode] = useState(false)

  // A click on the map either moves the destination or blocks a street,
  // depending on which tool is armed. Closures are local to this screen and
  // travel with every calculation until removed.
  const [tool, setTool] = useState<"destination" | "closure">("destination")
  const [closureRadius, setClosureRadius] = useState("40")
  const [closures, setClosures] = useState<Closure[]>([])
  const [explain, setExplain] = useState(false)
  const [stepsOf, setStepsOf] = useState<"neural" | "critical" | "shortest">("neural")
  const [focus, setFocus] = useState<{ latitude: number, longitude: number, key: number } | null>(null)

  const calculate = useMutation(ai.calculateRoute)
  const [result, setResult] = useState<{
    neural: RoutePreview
    critical: RoutePreview | null
    shortest: RoutePreview
    criticalMode: boolean
    originLabel: string
    blockedEdges: number
    closureCount: number
  } | null>(null)
  const [comparisonSimulationRequest, setComparisonSimulationRequest] = useState(0)

  // Theater gives the map the page's whole width, laid out the way the
  // statistics map already is, and pushes the comparison underneath instead of
  // beside it. The map keeps its element and therefore its camera and its 3D
  // state; only the box around it changes shape.
  const [theater, setTheater] = useState(false)

  const model = useResource(() => ai.model(), [])
  const coverage = model.data?.bounds ?? null

  const destination = {
    latitude: Number(destinationLatitude),
    longitude: Number(destinationLongitude),
  }

  const destinationValid =
    Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)
    && destinationLatitude.trim() !== "" && destinationLongitude.trim() !== ""

  // Warned before the request, not after it comes back rejected. The rectangle
  // is the extent of the street graph; the AI still refuses a point inside it
  // that is more than `max_snap_distance_m` from an actual mapped street, so
  // this catches the obvious mistake and the service catches the subtle one.
  const outsideCoverage = Boolean(
    coverage && destinationValid && (
      destination.latitude < coverage.min_latitude
      || destination.latitude > coverage.max_latitude
      || destination.longitude < coverage.min_longitude
      || destination.longitude > coverage.max_longitude
    ),
  )

  /**
   * Every station that can be plotted, ready for the map.
   *
   * They are drawn from the moment the screen opens, before any destination
   * exists, which is the whole point: the dispatcher can see the layout of the
   * city's stations and judge which one is worth departing from.
   */
  const stations = useMemo(() => stationsOf(unitList.data?.items), [unitList.data])

  const nearest = useMemo(
    () => (destinationValid ? nearestTo(destination, stations) : null),
    // The destination object is rebuilt every render; its two numbers are what
    // actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destinationValid, destination.latitude, destination.longitude, stations],
  )

  const nearestIsOrigin = originMode === "unit" && nearest?.item.id === unitId

  function handlePick(latitude: number, longitude: number) {
    if (tool === "closure") {
      setClosures((current) => [...current, { latitude, longitude, radius_m: Number(closureRadius) }].slice(-20))
      return
    }
    setDestinationLatitude(latitude.toFixed(6))
    setDestinationLongitude(longitude.toFixed(6))
  }

  function focusStep(step: RouteStep) {
    setFocus({ latitude: step.location[0], longitude: step.location[1], key: Date.now() })
  }

  function handleStationSelect(id: string) {
    setOriginMode("unit")
    setUnitId(id)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const answer = await calculate.run({
      origin_unit_id: originMode === "unit" ? unitId : undefined,
      origin_latitude: originMode === "coords" ? Number(originLatitude) : undefined,
      origin_longitude: originMode === "coords" ? Number(originLongitude) : undefined,
      destination_latitude: Number(destinationLatitude),
      destination_longitude: Number(destinationLongitude),
      critical_mode: criticalMode,
      closures: closures.length > 0 ? closures : undefined,
    })

    if (answer) {
      setResult({
        neural: answer.neural,
        critical: answer.critical,
        shortest: answer.shortest,
        criticalMode: answer.critical_mode,
        originLabel: originMode === "unit" ? stations.find((station) => station.id === unitId)?.acronym ?? "Origem" : "Origem",
        blockedEdges: answer.closures?.blocked_edges ?? 0,
        closureCount: answer.closures?.count ?? 0,
      })
      setStepsOf(answer.critical_mode && answer.critical ? "critical" : "neural")
    }
  }

  const originReady = originMode === "unit" ? Boolean(unitId) : Boolean(originLatitude && originLongitude)

  return (
    <Page>
      <PageHeader
        title="Rotas"
        subtitle="Planeje o deslocamento, compare os percursos e acompanhe a simulação das viaturas."
      />

      <Panel title="Planejar deslocamento" icon={<Compass className="h-5 w-5" />} className="route-setup">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {calculate.error && <ErrorBox message={calculate.error} />}
          <ErrorDetails details={calculate.details} />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Origem">
              <Select
                value={originMode}
                onChange={(value) => setOriginMode(value as "unit" | "coords")}
                options={[
                  { value: "unit", label: "Partir de uma unidade" },
                  { value: "coords", label: "Coordenadas manuais" },
                ]}
              />
            </Field>

            {originMode === "unit" ? (
              <Field label="Unidade" required>
                <Select
                  value={unitId}
                  onChange={setUnitId}
                  placeholder={unitList.loading ? "Carregando..." : "Selecione o quartel"}
                  options={(unitList.data?.items ?? []).map((unit) => ({
                    value: unit.id,
                    label: `${unit.acronym} — ${unit.name}`,
                  }))}
                />
              </Field>
            ) : (
              <>
                <Field label="Latitude de origem" required>
                  <TextInput value={originLatitude} onChange={(event) => setOriginLatitude(event.target.value)} />
                </Field>
                <Field label="Longitude de origem" required>
                  <TextInput value={originLongitude} onChange={(event) => setOriginLongitude(event.target.value)} />
                </Field>
              </>
            )}

            <Field label="Latitude do destino" required hint="Ou clique direto no mapa">
              <TextInput value={destinationLatitude} onChange={(event) => setDestinationLatitude(event.target.value)} />
            </Field>

            <Field label="Longitude do destino" required hint="Use ponto decimal, não vírgula">
              <TextInput value={destinationLongitude} onChange={(event) => setDestinationLongitude(event.target.value)} />
            </Field>
          </div>

          <div className="route-tools-row">
          <div className="route-critical-option" data-active={criticalMode}>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={criticalMode}
              onChange={(event) => setCriticalMode(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0"
            />
            <span className="flex flex-col gap-1">
              <strong className="text-sm text-ink">Incluir modo crítico</strong>
              <span className="text-sm text-ink-muted">
                Compare também a alternativa com exceções operacionais.
              </span>
            </span>
          </label>
          <details className="route-detail-note"><summary>Critérios do modo crítico</summary><p>Considera contrafluxo e vantagens de acostamento quando a malha indicar viabilidade física, sem atravessar barreiras, túneis, pontes, rotatórias ou acessos explicitamente restritos.</p></details>
          </div>

          <ClosureTools
            tool={tool}
            onTool={setTool}
            radius={closureRadius}
            onRadius={setClosureRadius}
            closures={closures}
            onRemove={(index) => setClosures((current) => current.filter((_, position) => position !== index))}
            onClear={() => setClosures([])}
          />
          </div>

          {nearest && !outsideCoverage && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-accent/30 bg-accent-soft px-4 py-2 text-ink">
              <MapPin className="h-4 w-4 shrink-0 text-accent" />
              <span>
                Quartel mais próximo do destino: <strong>{nearest.item.acronym}</strong> —{" "}
                {nearest.item.name}, a {formatDistance(nearest.meters)} em linha reta.
              </span>
              {nearestIsOrigin
                ? <span className="text-sm font-semibold text-accent">Já é a origem selecionada.</span>
                : (
                  <button
                    type="button"
                    onClick={() => handleStationSelect(nearest.item.id)}
                    className="text-sm font-semibold text-accent underline underline-offset-2 hover:text-accent-strong"
                  >
                    Usar como origem
                  </button>
                )}
            </p>
          )}

          {outsideCoverage && coverage && (
            <p className="rounded-sm border border-warn/30 bg-warn-soft px-4 py-2 text-ink">
              Esse destino está fora do retângulo tracejado no mapa, que é toda a malha viária
              que o modelo conhece. A malha vai de {formatCoordinate(coverage.min_latitude)} a{" "}
              {formatCoordinate(coverage.max_latitude)} de latitude e de{" "}
              {formatCoordinate(coverage.min_longitude)} a {formatCoordinate(coverage.max_longitude)} de
              longitude.
            </p>
          )}

          <div className="route-submit-row">
            <details className="route-detail-note"><summary>{model.data ? `Área de cálculo · ${model.data.city}` : "Sobre a área de cálculo"}</summary><p>
              {model.data
                ? `Malha de ${model.data.city}: ${model.data.graph_nodes.toLocaleString("pt-BR")} nós e ${model.data.graph_edges.toLocaleString("pt-BR")} ruas. Pontos a mais de ${((coverage?.max_snap_distance_m ?? 2000) / 1000).toLocaleString("pt-BR")} km de uma rua mapeada são recusados — o norte rural do município quase não tem ruas no OpenStreetMap.`
                : "O ponto precisa cair dentro da malha viária de Taubaté."}
            </p></details>

            <ActionButton tone="primary" type="submit" disabled={calculate.submitting || !originReady}>
              <RouteIcon className="h-5 w-5" />
              {calculate.submitting ? "Calculando..." : "Calcular rota"}
            </ActionButton>
          </div>
        </form>
      </Panel>

      <div className={theater ? "flex flex-col gap-5" : "grid items-start gap-5 xl:grid-cols-[minmax(0,2.1fr)_minmax(310px,1fr)]"}>
        <Panel
          title="Mapa de deslocamento"
          className="route-map-panel"
          icon={<RouteIcon className="h-5 w-5" />}
          actions={result ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton
                tone={explain ? "primary" : "neutral"}
                className="px-3 py-1.5 text-sm"
                aria-pressed={explain}
                onClick={() => setExplain((value) => !value)}
                title="Pinta a rota da IA pela velocidade que a rede prevê em cada trecho"
              >
                <Sparkles className="h-4 w-4" />
                Explicar
              </ActionButton>
              <ActionButton
                tone="neutral"
                className="px-3 py-1.5 text-sm"
                onClick={() => setComparisonSimulationRequest((value) => value + 1)}
              >
                <Play className="h-4 w-4" />
                Comparar viaturas
              </ActionButton>
            </div>
          ) : undefined}
        >
          {result && (
            <div className="route-legend">
              <span className="flex items-center gap-2">
                <span className="h-[3px] w-5" style={{ backgroundColor: ROUTE_COLOR }} />
                IA
              </span>
              {result.critical && (
                <span className="flex items-center gap-2">
                  <span className="h-[3px] w-5" style={{ backgroundColor: CRITICAL_COLOR }} />
                  Modo crítico
                </span>
              )}
              <span className="flex items-center gap-2">
                <span className="h-[3px] w-5" style={{ backgroundColor: COMPARISON_COLOR }} />
                Padrão
              </span>
              <small>{result.critical ? 3 : 2} percursos calculados</small>
            </div>
          )}

          <RouteMap
            route={result?.neural.geometry ?? null}
            critical={result?.critical?.geometry ?? null}
            comparison={result?.shortest.geometry ?? null}
            coverage={coverage}
            onPick={handlePick}
            pin={!result && destinationValid ? destination : null}
            stations={stations}
            selectedStationId={originMode === "unit" ? unitId : null}
            nearestStationId={nearest?.item.id ?? null}
            onStationSelect={handleStationSelect}
            originLabel={result?.originLabel ?? "Origem"}
            destinationLabel="Destino"
            theater={theater}
            onTheaterToggle={() => setTheater((current) => !current)}
            comparisonSimulationRequest={comparisonSimulationRequest}
            routeSegments={result?.neural.segments}
            routeFeatures={result?.neural.route_features}
            destinationPoint={destinationValid ? destination : null}
            onAlternativeSelect={(kind) => setStepsOf(kind === 'ai' ? 'neural' : kind === 'standard' ? 'shortest' : 'critical')}
            routeSteps={result?.neural.steps}
            comparisonSteps={result?.shortest.steps}
            criticalSteps={result?.critical?.steps}
            comparisonSegments={result?.shortest.segments}
            criticalSegments={result?.critical?.segments}
            sharedWithComparison={result?.neural.shared_with_shortest}
            speedSegments={explain ? result?.neural.segments ?? null : null}
            closures={closures}
            focus={focus}
            comparisonSimulationTimes={result ? {
              primarySeconds: result.neural.estimated_time_seconds,
              comparisonSeconds: result.shortest.estimated_time_seconds,
              criticalSeconds: result.critical?.estimated_time_seconds,
            } : undefined}
            className={theater
              ? "h-[78vh] min-h-[420px] w-full"
              : "h-[60vh] max-h-[640px] min-h-[340px] w-full"}
            emptyMessage="Informe origem e destino e calcule para ver o traçado."
          />
        </Panel>

        <Panel title="Análise dos percursos" icon={<Brain className="h-5 w-5" />}>
          {!result && (
            <div className="route-empty-analysis"><span>ANTES DE COMPARAR</span><h3>Defina o percurso no mapa</h3><ol><li><strong>Origem</strong><p>Escolha o quartel de partida ou informe as coordenadas.</p></li><li><strong>Destino</strong><p>Marque o ponto no mapa e calcule a rota.</p></li><li><strong>Comparação</strong><p>Consulte tempo e distância e acompanhe as viaturas em 3D.</p></li></ol></div>
          )}

          {result && (
            <>
              <RoutePerformance neural={result.neural} critical={result.critical} shortest={result.shortest} />

              {result.closureCount > 0 && (
                <p className="rounded-sm border border-alert/25 bg-alert-soft px-3 py-2 text-sm text-ink">
                  {result.closureCount} interdição(ões) respeitada(s): {result.blockedEdges} trecho(s) de rua fora do cálculo.
                </p>
              )}

              {result.critical && <CriticalSummary preview={result.critical} />}

              <RouteInsight neural={result.neural} shortest={result.shortest} />

              <RouteBenchmark key={`${result.neural.distance_meters}-${result.neural.estimated_time_seconds}`} neural={result.neural} />

            </>
          )}
        </Panel>
      </div>

      {result && (
        <Panel
          title="Manobras"
          icon={<ListOrdered className="h-5 w-5" />}
          actions={(
            <div className="route-metric-tabs" aria-label="Percurso das manobras">
              <button type="button" aria-pressed={stepsOf === "neural"} onClick={() => setStepsOf("neural")}>IA</button>
              {result.critical && (
                <button type="button" aria-pressed={stepsOf === "critical"} onClick={() => setStepsOf("critical")}>Modo crítico</button>
              )}
              <button type="button" aria-pressed={stepsOf === "shortest"} onClick={() => setStepsOf("shortest")}>Padrão</button>
            </div>
          )}
        >
          <RouteSteps
            steps={(stepsOf === "critical" ? result.critical ?? result.neural : result[stepsOf]).steps ?? []}
            title={`${result.originLabel} → destino (${stepsOf === "critical" ? "modo crítico" : stepsOf === "neural" ? "IA" : "rota padrão"})`}
            summary={`${formatDistance((stepsOf === "critical" ? result.critical ?? result.neural : result[stepsOf]).distance_meters)} · ${formatDuration((stepsOf === "critical" ? result.critical ?? result.neural : result[stepsOf]).estimated_time_seconds)} estimados`}
            onSelect={focusStep}
          />
        </Panel>
      )}
    </Page>
  )
}

const CLOSURE_RADII = [
  { value: "25", label: "25 m — um trecho de quadra" },
  { value: "40", label: "40 m — um cruzamento" },
  { value: "80", label: "80 m — uma quadra" },
  { value: "150", label: "150 m — várias quadras" },
  { value: "300", label: "300 m — uma área" },
]

/**
 * The closure tool: arm it, click the map where the street is blocked. Each
 * circle hides every street segment inside it from the next calculation.
 */
function ClosureTools({ tool, onTool, radius, onRadius, closures, onRemove, onClear }: {
  tool: "destination" | "closure"
  onTool: (tool: "destination" | "closure") => void
  radius: string
  onRadius: (value: string) => void
  closures: Closure[]
  onRemove: (index: number) => void
  onClear: () => void
}) {
  return (
    <div className="route-closures flex flex-col gap-3 rounded-sm border border-line bg-surface-muted px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="label-caps text-ink-muted">Clique no mapa para</span>
          <div className="route-metric-tabs" aria-label="Ferramenta do mapa">
            <button type="button" aria-pressed={tool === "destination"} onClick={() => onTool("destination")}>
              Marcar destino
            </button>
            <button type="button" aria-pressed={tool === "closure"} onClick={() => onTool("closure")}>
              Interditar via
            </button>
          </div>
        </div>

        {tool === "closure" && (
          <Field label="Raio da interdição">
            <Select value={radius} onChange={onRadius} options={CLOSURE_RADII} />
          </Field>
        )}

        {closures.length > 0 && (
          <button type="button" onClick={onClear} className="ml-auto text-sm font-semibold text-alert underline underline-offset-2">
            Remover todas
          </button>
        )}
      </div>

      {closures.length === 0 ? (
        <p className="text-sm text-ink-muted">
          <Ban className="mr-1 inline h-4 w-4 text-ink-soft" />
          Nenhuma via interditada. Use “Interditar via” para marcar desabamento, alagamento ou acidente: a rota contorna o trecho.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {closures.map((closure, index) => (
            <li key={`${closure.latitude}-${closure.longitude}-${index}`} className="inline-flex items-center gap-2 rounded-sm border border-alert/30 bg-alert-soft px-2 py-1 text-sm text-ink">
              <Ban className="h-3.5 w-3.5 text-alert" />
              {closure.latitude.toFixed(4)}, {closure.longitude.toFixed(4)} · {closure.radius_m} m
              <button type="button" onClick={() => onRemove(index)} aria-label="Remover interdição" className="text-ink-muted hover:text-alert">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RoutePerformance({ neural, critical, shortest }: {
  neural: RoutePreview
  critical: RoutePreview | null
  shortest: RoutePreview
}) {
  const [metric, setMetric] = useState<"time" | "distance">("time")
  const variants = [
    { label: "IA", color: ROUTE_COLOR, route: neural },
    ...(critical ? [{ label: "Modo crítico", color: CRITICAL_COLOR, route: critical }] : []),
    { label: "Padrão", color: COMPARISON_COLOR, route: shortest },
  ]
  const valueOf = (route: RoutePreview) => metric === "time" ? route.estimated_time_seconds : route.distance_meters
  const max = Math.max(...variants.map((entry) => valueOf(entry.route)), 1)
  const formatted = (route: RoutePreview) => metric === "time" ? formatDuration(valueOf(route)) : formatDistance(valueOf(route))
  return (
    <figure className="route-performance">
      <figcaption>
        <span>MESMA ORIGEM · MESMO DESTINO</span>
        <p>Compare o custo de cada percurso</p>
      </figcaption>
      <div className="route-metric-tabs" aria-label="Métrica da comparação">
        <button type="button" aria-pressed={metric === "time"} onClick={() => setMetric("time")}>Tempo estimado</button>
        <button type="button" aria-pressed={metric === "distance"} onClick={() => setMetric("distance")}>Distância</button>
      </div>
      <div className="route-performance-axis"><span>0</span><span>{metric === "time" ? formatDuration(max) : formatDistance(max)}</span></div>
      {variants.map((entry) => (
        <div className="route-performance-row" key={entry.label}>
          <div><strong>{entry.label}</strong><span>{formatted(entry.route)}</span></div>
          <div className="route-performance-track" role="img" aria-label={`${entry.label}: ${formatted(entry.route)}`}>
            <div style={{ width: `${valueOf(entry.route) / max * 100}%`, backgroundColor: entry.color }} />
          </div>
          <p>{metric === "time" ? formatDistance(entry.route.distance_meters) : formatDuration(entry.route.estimated_time_seconds)} · {entry.route.node_count} cruzamentos</p>
        </div>
      ))}
      <p className="route-performance-note">Escala comum, a partir de zero. Tempos estimados pelo modelo; a reprodução preserva a proporção entre as chegadas.</p>
    </figure>
  )
}

function CriticalSummary({ preview }: { preview: RoutePreview }) {
  const maneuvers = preview.critical_maneuvers
  const counterflow = maneuvers?.counterflow_segments ?? 0
  const shoulder = maneuvers?.shoulder_segments ?? 0

  return (
    <div className="rounded-sm border border-alert/25 bg-alert-soft px-4 py-3 text-sm text-ink">
      <p className="font-semibold">Exceções operacionais consideradas</p>
      <p className="mt-1 text-ink-muted">
        {counterflow} trecho(s) de contrafluxo elegível · {shoulder} trecho(s) com
        benefício de acostamento mapeado. A simulação usa atributos do OpenStreetMap;
        a viabilidade real continua dependendo das condições da via e da decisão operacional.
      </p>
    </div>
  )
}

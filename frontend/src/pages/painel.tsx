/**
 * The dispatcher's home screen.
 *
 * The first version showed the same four figures from hard-coded values. They
 * now come from the API, and the live feed refreshes them as incidents are
 * opened and vehicles are committed, because a number that goes stale during a
 * shift is worse than no number at all.
 */

import { useCallback, useMemo, useState } from "react"
import { Activity, Brain, Car, Clock, MapPin, Radio, TriangleAlert, Users } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import { ai, dispatches, firefighters, occurrences, units, vehicles } from "@/api/endpoints"
import {
  NATURE_LABEL, OCCURRENCE_STATUS_LABEL, OCCURRENCE_STATUS_TONE,
  PRIORITY_LABEL, PRIORITY_TEXT_TONE, PRIORITY_TONE, TONE,
} from "@/api/labels"
import type { Occurrence } from "@/api/types"
import { Badge, Page, PageHeader, Panel, StatBox } from "@/components/layout/kit"
import { EmptyState, ErrorBox, LoadingBlock } from "@/components/layout/feedback"
import IncidentMap, { IncidentLegend } from "@/components/mapa/incident-map"
import type { IncidentMapMode, IncidentPoint, RecurrenceCluster } from "@/components/mapa/incident-map"
import { UNIT_COLORS } from "@/components/mapa/constants/incident-palette"
import { useRealtime } from "@/hooks/use-realtime"
import { useResource } from "@/hooks/use-resource"
import { formatElapsed, formatShort, toNumber } from "@/lib/format"
import { stationsOf } from "@/lib/geo"
import { AnimatedNumber } from "@/components/operational/animated-number"
import { useNewOccurrences } from "@/components/operational/use-new-occurrences"

export default function Painel() {
  const navigate = useNavigate()
  const newCalls = useNewOccurrences()
  const [mapMode, setMapMode] = useState<IncidentMapMode>("points")
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = useCallback(() => setRefreshKey((value) => value + 1), [])

  // Any incident or dispatch event invalidates every figure on this screen.
  useRealtime((event) => {
    if (event.type === "connected") return
    bump()
  })

  // An incident is only off the board once it is closed or cancelled. Counting
  // the severity over ABERTA alone made every figure read "Leves", because a
  // serious call is dispatched within seconds and leaves that bucket at once.
  const open = useResource(
    () => occurrences.list({ status: "ABERTA", per_page: 100 }),
    [refreshKey],
  )

  const dispatched = useResource(
    () => occurrences.list({ status: "DESPACHADA", per_page: 100 }),
    [refreshKey],
  )

  const inProgress = useResource(
    () => occurrences.list({ status: "EM_ATENDIMENTO", per_page: 100 }),
    [refreshKey],
  )

  // "Últimas ocorrências" means the latest ones. The list endpoint defaults to
  // the dispatcher's queue — most serious first, oldest waiting first — which
  // over a year of history puts the oldest critical calls at the top and made
  // this panel show incidents from the previous year.
  const recent = useResource(
    () => occurrences.list({ per_page: 8, sort: "recent" }),
    [refreshKey],
  )

  const fleet = useResource(() => vehicles.list({ per_page: 100 }), [refreshKey])
  const crewOnDuty = useResource(() => firefighters.list({ status: "ATIVO", per_page: 1 }), [refreshKey])
  const openDispatches = useResource(() => dispatches.list({ open: true, per_page: 100 }), [refreshKey])
  const model = useResource(() => ai.model(), [])
  const unitList = useResource(() => units.list({ active: true }), [])

  const activeList = useMemo(() => [
    ...(open.data?.items ?? []),
    ...(dispatched.data?.items ?? []),
    ...(inProgress.data?.items ?? []),
  ], [open.data, dispatched.data, inProgress.data])

  const incidentsReady = Boolean(open.data && dispatched.data && inProgress.data)
  const incidentsLoading = open.loading || dispatched.loading || inProgress.loading
  const incidentsError = open.error ?? dispatched.error ?? inProgress.error
  const activeTotal = (open.data?.total ?? 0) + (dispatched.data?.total ?? 0) + (inProgress.data?.total ?? 0)
  const incidentsTruncated = incidentsReady && activeList.length < activeTotal
  const fleetTruncated = Boolean(fleet.data && fleet.data.items.length < fleet.data.total)
  const unitsTruncated = Boolean(unitList.data && unitList.data.items.length < unitList.data.total)
  const unitColors = useMemo(() => {
    const acronyms = [...new Set((unitList.data?.items ?? []).map((unit) => unit.acronym))].sort()
    return new Map(acronyms.map((acronym, index) => [acronym, UNIT_COLORS[index % UNIT_COLORS.length]]))
  }, [unitList.data])

  const points: IncidentPoint[] = useMemo(() => activeList.flatMap((call) => {
    const latitude = toNumber(call.latitude)
    const longitude = toNumber(call.longitude)
    if (latitude === null || longitude === null) return []
    return [{
      id: call.id, protocol: call.protocol, nature: call.nature, priority: call.priority,
      address: call.address, openedAt: call.opened_at, latitude, longitude,
      unitLabel: call.unit?.acronym ?? "Sem unidade",
      unitColor: unitColors.get(call.unit?.acronym ?? "") ?? "#55636F",
    }]
  }), [activeList, unitColors])
  const legendUnits = useMemo(() => [...new Map(points.map((point) => [point.unitLabel, {
    label: point.unitLabel, color: point.unitColor,
  }])).values()].sort((a, b) => a.label.localeCompare(b.label)), [points])
  const clusters = useMemo<RecurrenceCluster[]>(() => {
    const groups = new Map<string, RecurrenceCluster>()
    for (const point of points) {
      const id = point.address.trim().toLocaleLowerCase("pt-BR")
      const group = groups.get(id) ?? { id, label: point.address.trim(), latitude: 0, longitude: 0, count: 0 }
      group.count += 1
      group.latitude += point.latitude
      group.longitude += point.longitude
      groups.set(id, group)
    }
    return [...groups.values()].filter((group) => group.count >= 3).map((group) => ({
      ...group, latitude: group.latitude / group.count, longitude: group.longitude / group.count,
    }))
  }, [points])
  const stations = useMemo(() => stationsOf(unitList.data?.items), [unitList.data])
  const liveVehicles = useMemo(() => (fleet.data?.items ?? []).flatMap((vehicle) => {
    const latitude = toNumber(vehicle.current_latitude)
    const longitude = toNumber(vehicle.current_longitude)
    if (latitude === null || longitude === null || vehicle.status !== "EMPENHADA") return []
    return [{ id: vehicle.id, prefix: vehicle.prefix, status: vehicle.status, latitude, longitude, recorded_at: vehicle.last_position_at, type: vehicle.type, appearance: vehicle.appearance, arrived_at: openDispatches.data?.items.find((entry) => entry.vehicle_id === vehicle.id && entry.status === "NO_LOCAL")?.arrived_at }]
  }), [fleet.data, openDispatches.data])

  const severe = activeList.filter((item) => item.priority === "ALTA" || item.priority === "CRITICA").length
  const medium = activeList.filter((item) => item.priority === "MEDIA").length
  const light = activeList.filter((item) => item.priority === "BAIXA").length

  const available = (fleet.data?.items ?? []).filter((vehicle) => vehicle.status === "DISPONIVEL").length
  const committed = (fleet.data?.items ?? []).filter((vehicle) => vehicle.status === "EMPENHADA").length

  return (
    <Page>
      <PageHeader
        title="Painel operacional"
        subtitle="Situação corrente do atendimento em Taubaté"
        actions={<Link to="/telao" className="text-sm font-semibold text-accent hover:underline">Abrir painel da central →</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox
          icon={<TriangleAlert className="h-5 w-5" />}
          label="Ocorrências em aberto"
          value={<AnimatedNumber value={incidentsError || !incidentsReady ? null : activeTotal} />}
          hint={!incidentsReady || incidentsError
            ? incidentsError ? "Dados de ocorrências indisponíveis" : "Carregando ocorrências…"
            : `${severe} graves · ${medium} médias · ${light} leves ${incidentsTruncated ? "no recorte carregado" : "em acompanhamento"}`}
          tone="text-alert"
        />

        <StatBox
          icon={<Car className="h-5 w-5" />}
          label="Viaturas disponíveis"
          value={<AnimatedNumber value={!fleet.data || fleet.error ? null : available} />}
          hint={`${committed} empenhada${committed === 1 ? "" : "s"} de ${fleet.data?.total ?? 0} no total`}
          tone="text-ok"
        />

        <StatBox
          icon={<Activity className="h-5 w-5" />}
          label="Despachos em andamento"
          value={<AnimatedNumber value={openDispatches.error ? null : openDispatches.data?.total ?? null} />}
          hint={`${inProgress.data?.total ?? 0} ocorrência(s) em atendimento`}
          tone="text-accent"
        />

        <StatBox
          icon={<Users className="h-5 w-5" />}
          label="Efetivo ativo"
          value={<AnimatedNumber value={crewOnDuty.error ? null : crewOnDuty.data?.total ?? null} />}
          hint="Bombeiros com situação ATIVO"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Mapa operacional em tempo real" icon={<MapPin />} className="operation-map-panel">
          {incidentsError && <div className="p-4"><ErrorBox message={`Ocorrências: ${incidentsError}${incidentsReady ? " Os pontos exibidos podem estar desatualizados." : ""}`} onRetry={bump} /></div>}
          {fleet.error && <div className="px-4 py-2"><ErrorBox message={`Frota: ${fleet.error}`} onRetry={fleet.reload} /></div>}
          {unitList.error && <div className="px-4 py-2"><ErrorBox message={`Quartéis: ${unitList.error}`} onRetry={unitList.reload} /></div>}
          {!incidentsReady && incidentsLoading && <LoadingBlock label="Carregando ocorrências do mapa…" />}
          {incidentsReady && <IncidentMap
            incidents={points}
            operational
            dispatches={openDispatches.data?.items}
            clusters={clusters}
            stations={stations}
            vehicles={liveVehicles}
            unlocatedVehicles={(fleet.data?.items ?? []).filter((vehicle) => vehicle.current_latitude == null || vehicle.current_longitude == null).map((vehicle) => vehicle.prefix)}
            mode={mapMode}
            onModeChange={setMapMode}
            onOpen={(id) => navigate(`/ocorrencias/${id}`)}
            className="operation-map w-full"
          />}
          {incidentsReady && <div className="px-4 py-3"><IncidentLegend mode={mapMode} units={legendUnits} /></div>}
          <div className="operation-map-summary">
            <span>{incidentsReady ? `${points.length} ocorrências localizadas` : incidentsError ? "Ocorrências indisponíveis" : "Carregando ocorrências…"} · {fleet.error ? "Frota indisponível" : !fleet.data ? "Carregando frota…" : `${liveVehicles.length} viaturas em campo`}</span>
            <span>{mapMode === "recurrence" ? "Endereços com 3 ou mais chamados ativos no recorte" : "Ocorrências aguardando, despachadas ou em atendimento"}</span>
            {unitList.loading && !unitList.data && <span>Carregando quartéis…</span>}
            {incidentsTruncated && <span>Recorte parcial: {activeList.length} de {activeTotal} ocorrências carregadas. Mapa e prioridades consideram até 100 por situação.</span>}
            {fleetTruncated && <span>Frota parcial: {fleet.data!.items.length} de {fleet.data!.total} viaturas carregadas.</span>}
            {unitsTruncated && <span>Quartéis parciais: {unitList.data!.items.length} de {unitList.data!.total} unidades carregadas.</span>}
          </div>
        </Panel>
        <Panel
          title="Últimas ocorrências"
          icon={<Clock className="h-5 w-5" />}
          actions={<Link to="/ocorrencias" className="font-semibold text-accent hover:underline">Ver todas</Link>}
        >
          {recent.loading && !recent.data && <LoadingBlock />}
          {recent.error && <ErrorBox message={recent.error} onRetry={recent.reload} />}

          {recent.data && recent.data.items.length === 0 && (
            <EmptyState
              title="Nenhuma ocorrência registrada"
              description="Quando uma ocorrência for aberta ela aparece aqui em tempo real."
            />
          )}

          <div className="flex flex-col">
            {(recent.data?.items ?? []).map((occurrence) => (
              <OccurrenceRow key={occurrence.id} occurrence={occurrence} highlight={newCalls.has(occurrence.id)} />
            ))}
          </div>
        </Panel>

      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <Panel title="IA" icon={<Brain className="h-5 w-5" />}>
            {model.loading && <LoadingBlock label="Consultando o modelo..." />}

            {model.error && (
              <ErrorBox
                message={`Serviço de IA indisponível: ${model.error}`}
                onRetry={model.reload}
              />
            )}

            {model.data && (
              <dl className="flex flex-col gap-2 text-ink">
                <Line term="Situação" value={
                  <Badge tone={model.data.loaded ? TONE.ok : TONE.alert}>
                    {model.data.loaded ? "Modelo carregado" : "Sem modelo"}
                  </Badge>
                } />
                <Line term="Cidade" value={model.data.city} />
                <Line term="Grafo" value={`${model.data.graph_nodes.toLocaleString("pt-BR")} nós · ${model.data.graph_edges.toLocaleString("pt-BR")} ruas`} />
                <Line term="Versão" value={<span className="font-mono text-sm">{model.data.model_version ?? "—"}</span>} />
              </dl>
            )}

            <Link to="/rede-neural" className="font-semibold text-accent hover:underline">
              Abrir IA
            </Link>
          </Panel>

          <Panel title="Tempo real" icon={<Radio className="h-5 w-5" />}>
            <LiveFeed />
          </Panel>
      </div>
    </Page>
  )
}

function Line({ term, value }: { term: string, value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-1.5">
      <dt className="text-ink-muted">{term}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  )
}

function OccurrenceRow({ occurrence, highlight }: { occurrence: Occurrence; highlight: boolean }) {
  return (
    <Link
      to={`/ocorrencias/${occurrence.id}`}
      className={`flex items-start gap-3 border-b border-line py-3 pl-0 pr-1 last:border-b-0 hover:bg-accent-soft${highlight ? ' op-new-call' : ''}`}
    >
      <span aria-hidden className={`h-11 w-1 shrink-0 ${PRIORITY_TONE[occurrence.priority]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{NATURE_LABEL[occurrence.nature]}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{occurrence.address}</p>
        <p className="mt-2 text-xs text-ink-soft">{formatShort(occurrence.opened_at)} · {formatElapsed(occurrence.opened_at)}</p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <Badge tone={OCCURRENCE_STATUS_TONE[occurrence.status]}>
          {OCCURRENCE_STATUS_LABEL[occurrence.status]}
        </Badge>
        <span className={`label-caps ${PRIORITY_TEXT_TONE[occurrence.priority]}`}>
          {PRIORITY_LABEL[occurrence.priority]}
        </span>
      </div>

    </Link>
  )
}

/** A rolling window of the last events, so the socket is visibly alive. */
function LiveFeed() {
  const [events, setEvents] = useState<{ id: number, text: string, at: Date }[]>([])

  const { connected } = useRealtime((event) => {
    // The timeline ping only tells a detail screen to refetch; it is not news.
    if (event.type === "connected" || event.type === "occurrence.timeline" || event.type === "vehicle.alert_snapshot") return

    const text =
      event.type === "occurrence.created" ? `Nova ocorrência ${event.payload.protocol}` :
      event.type === "occurrence.updated" ? `Ocorrência ${event.payload.protocol}: ${event.payload.status}` :
      event.type === "dispatch.created" ? `Viatura ${event.payload.vehicle_prefix} despachada` :
      event.type === "dispatch.updated" ? `Despacho: ${event.payload.status}` :
      event.type === "vehicle.alert" ? `${event.payload.prefix}: ${event.payload.kind === "parada" ? "parada fora do esperado" : "sem sinal"}` :
      event.type === "vehicle.alert_cleared" ? "Sinal da viatura normalizado" :
      `Viatura ${event.payload.prefix} em movimento`

    setEvents((current) => [{ id: Date.now() + Math.random(), text, at: new Date() }, ...current].slice(0, 12))
  })

  if (!connected) {
    return <p className="text-ink-muted">Sem conexão com o canal de tempo real.</p>
  }

  if (events.length === 0) {
    return <p className="text-ink-muted">Conectado. Aguardando eventos do plantão.</p>
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {events.map((event) => (
        <li key={event.id} className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5 text-sm">
          <span className="text-ink">{event.text}</span>
          <span className="shrink-0 text-ink-soft">
            {event.at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </li>
      ))}
    </ul>
  )
}

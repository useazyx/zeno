/**
 * The wallboard for the operations room (COBOM).
 *
 * Read from across the room, not operated: big figures, the open calls in
 * order of severity with how long each has been waiting, where they are, and
 * how much of the fleet is free. It refreshes itself from the live feed and,
 * as a safety net, every thirty seconds.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Maximize, Radio } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import { dispatches, occurrences, units, vehicles } from "@/api/endpoints"
import {
  DISPATCH_STATUS_LABEL, NATURE_LABEL, OCCURRENCE_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TEXT_TONE, PRIORITY_TONE,
} from "@/api/labels"
import type { Occurrence, OccurrencePriority } from "@/api/types"
import { ErrorBox, LoadingBlock } from "@/components/layout/feedback"
import IncidentMap from "@/components/mapa/incident-map"
import type { IncidentMapMode, IncidentPoint } from "@/components/mapa/incident-map"
import type { LiveVehicle } from "@/components/mapa/map/vehicle-markers"
import { useRealtime } from "@/hooks/use-realtime"
import { useResource } from "@/hooks/use-resource"
import { toNumber } from "@/lib/format"
import { stationsOf } from "@/lib/geo"
import { cn } from "@/lib/utils"
import { AnimatedNumber } from "@/components/operational/animated-number"
import { useOperationClock } from "@/components/operational/use-operation-clock"
import { useNewOccurrences } from "@/components/operational/use-new-occurrences"

const SEVERITY: Record<OccurrencePriority, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 }
const OPEN_STATUSES = ["ABERTA", "DESPACHADA", "EM_ATENDIMENTO"] as const

/** "12:04" since the call was opened — the number that matters on the wall. */
function waited(from: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (value: number) => String(value).padStart(2, "0")
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  return hours > 0 ? `${hours}h${pad(minutes)}` : `${pad(minutes)}:${pad(rest)}`
}

export default function Telao() {
  const navigate = useNavigate()
  const now = useOperationClock()
  const newCalls = useNewOccurrences()
  const [mode, setMode] = useState<IncidentMapMode>("points")

  const open = useResource(async () => {
    const pages = await Promise.all(OPEN_STATUSES.map((status) => occurrences.list({ status, per_page: 100 })))
    return pages.flatMap((page) => page.items)
  }, [])
  const fleet = useResource(() => vehicles.list({ per_page: 100 }), [])
  const active = useResource(() => dispatches.list({ open: true, per_page: 100 }), [])
  const unitList = useResource(() => units.list({ active: true }), [])

  // The `.reload` functions are stable; the resource objects are not, and
  // depending on them would restart the 30 s interval on every clock tick.
  const reloadOpen = open.reload
  const reloadFleet = fleet.reload
  const reloadActive = active.reload
  const reload = useCallback(() => { reloadOpen(); reloadFleet(); reloadActive() }, [reloadOpen, reloadFleet, reloadActive])

  // Position reports move the chips in place; refetching the whole fleet on
  // every GPS ping would be wasteful.
  const [moved, setMoved] = useState<Record<string, { latitude: number, longitude: number, recorded_at?: string, heading?: number | null }>>({})

  const { connected } = useRealtime(useCallback((event) => {
    if (event.type === "vehicle.moved") {
      setMoved((current) => ({ ...current, [event.payload.id]: { latitude: Number(event.payload.latitude), longitude: Number(event.payload.longitude), recorded_at: event.payload.recorded_at, heading: event.payload.heading } }))
      return
    }
    if (event.type !== "connected" && event.type !== "occurrence.timeline") reload()
  }, [reload]))

  useEffect(() => {
    const refresh = window.setInterval(() => { if (!document.hidden) reload() }, 30_000)
    const visible = () => { if (!document.hidden) reload() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(refresh); document.removeEventListener('visibilitychange', visible) }
  }, [reload])

  const calls = useMemo(() => [...(open.data ?? [])].sort((a, b) =>
    SEVERITY[a.priority] - SEVERITY[b.priority]
    || new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime()), [open.data])

  const byOccurrence = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const dispatch of active.data?.items ?? []) {
      map.set(dispatch.occurrence_id, [...(map.get(dispatch.occurrence_id) ?? []), `${dispatch.vehicle?.prefix ?? "?"} ${DISPATCH_STATUS_LABEL[dispatch.status].toLowerCase()}`])
    }
    return map
  }, [active.data])

  const fleetCounts = useMemo(() => {
    const items = fleet.data?.items ?? []
    return {
      free: items.filter((item) => item.status === "DISPONIVEL").length,
      busy: items.filter((item) => item.status === "EMPENHADA").length,
      down: items.filter((item) => item.status === "MANUTENCAO" || item.status === "INDISPONIVEL").length,
    }
  }, [fleet.data])

  const points: IncidentPoint[] = useMemo(() => calls.flatMap((call: Occurrence) => {
    const latitude = toNumber(call.latitude)
    const longitude = toNumber(call.longitude)
    if (latitude === null || longitude === null) return []
    return [{
      id: call.id, protocol: call.protocol, nature: call.nature, priority: call.priority, address: call.address,
      openedAt: call.opened_at, latitude, longitude,
      unitLabel: call.unit?.acronym ?? "—", unitColor: "#0B63A5",
    }]
  }), [calls])

  const stations = useMemo(() => stationsOf(unitList.data?.items), [unitList.data])

  // Vehicles out of the station: on a call, or free but reporting a position
  // away from home. A vehicle parked at its station adds nothing to the map.
  const liveVehicles: LiveVehicle[] = useMemo(() => (fleet.data?.items ?? []).flatMap((vehicle) => {
    const latest = moved[vehicle.id]
    const latitude = latest?.latitude ?? toNumber(vehicle.current_latitude)
    const longitude = latest?.longitude ?? toNumber(vehicle.current_longitude)
    if (latitude === null || longitude === null) return []
    if (vehicle.status !== "EMPENHADA" && !latest) return []
    return [{ id: vehicle.id, prefix: vehicle.prefix, status: vehicle.status, latitude, longitude, recorded_at: latest?.recorded_at ?? vehicle.last_position_at, heading: latest?.heading, type: vehicle.type, appearance: vehicle.appearance, arrived_at: active.data?.items.find((entry) => entry.vehicle_id === vehicle.id && entry.status === "NO_LOCAL")?.arrived_at }]
  }), [fleet.data, moved, active.data])
  const critical = calls.filter((call) => call.priority === "CRITICA").length
  const clock = new Date(now)
  const failures = [
    open.error && `Ocorrências: ${open.error}`,
    fleet.error && `Frota: ${fleet.error}`,
    active.error && `Despachos: ${active.error}`,
    unitList.error && `Quartéis: ${unitList.error}`,
  ].filter(Boolean)

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink lg:h-dvh lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-chrome-line bg-chrome px-4 py-3 text-chrome-ink sm:gap-5 sm:px-6">
        <div className="mr-auto">
          <Link to="/" className="flex items-center gap-3 text-chrome-muted"><img src="/zeno-logo.svg" alt="ZENO · Início" width={101} height={24} /><span className="label-caps">COBOM Taubaté</span></Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Painel da central</h1>
        </div>
        <span className={cn("label-caps inline-flex max-w-full items-center gap-1.5 border px-2 py-1", connected ? "border-ok/30 bg-ok-soft text-ok" : "border-alert/40 bg-alert-soft text-alert")}>
          <Radio className={cn("h-3.5 w-3.5", connected && "animate-pulse")} />
          {connected ? "Ao vivo" : "Sem conexão — dados podem estar desatualizados"}
        </span>
        <div className="flex flex-col sm:items-end">
          <time className="text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{clock.toLocaleTimeString("pt-BR")}</time>
          <span className="text-xs text-chrome-muted">{clock.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</span>
        </div>
        <button
          type="button"
          onClick={() => document.documentElement.requestFullscreen?.()}
          className="ml-auto border border-chrome-line p-2.5 text-chrome-muted hover:border-accent hover:text-chrome-ink sm:ml-0"
          aria-label="Tela cheia"
        >
          <Maximize className="h-5 w-5" />
        </button>
      </header>

      {failures.length > 0 && (
        <div className="shrink-0 px-4 pt-4 sm:px-6">
          <ErrorBox
            message={`${failures.join(" · ")} Os dados já carregados permanecem visíveis e podem estar desatualizados.`}
            onRetry={() => { reload(); unitList.reload() }}
          />
        </div>
      )}

      <div className="grid shrink-0 grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-3 sm:px-6 lg:grid-cols-5">
        <Figure label="Ocorrências em aberto" value={open.data ? calls.length : null} />
        <Figure label="Críticas" value={open.data ? critical : null} tone={critical > 0 ? "text-alert border-t-alert" : undefined} />
        <Figure label="Viaturas livres" value={fleet.data ? fleetCounts.free : null} tone="text-ok border-t-ok" />
        <Figure label="Viaturas empenhadas" value={fleet.data ? fleetCounts.busy : null} tone="text-accent border-t-accent" />
        <Figure label="Fora de operação" value={fleet.data ? fleetCounts.down : null} />
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="order-2 flex min-h-0 min-w-0 flex-col border border-line bg-surface lg:order-1" aria-label="Mapa operacional">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-muted px-4 py-3">
            <h2 className="text-sm font-semibold">Mapa operacional</h2>
            <span className="text-xs text-ink-muted">Ocorrências e frota em campo</span>
          </header>
          <IncidentMap
            incidents={points}
            operational
            wallboard
            dispatches={active.data?.items}
            stations={stations}
            mode={mode}
            onModeChange={setMode}
            onOpen={(id) => navigate(`/ocorrencias/${id}`)}
            vehicles={liveVehicles}
            unlocatedVehicles={(fleet.data?.items ?? []).filter((vehicle) => vehicle.current_latitude == null || vehicle.current_longitude == null).map((vehicle) => vehicle.prefix)}
            className="h-[380px] w-full lg:h-full lg:min-h-0 lg:flex-1"
          />
        </section>
        <section className="order-1 flex min-h-0 min-w-0 flex-col border border-line bg-surface lg:order-2" aria-label="Fila de ocorrências">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-muted px-4 py-3">
            <h2 className="text-sm font-semibold">Fila de ocorrências</h2>
            <span className="text-xs text-ink-muted">Prioridade · tempo desde a abertura</span>
          </header>
          <ol className="min-h-0 overflow-y-auto" aria-busy={open.loading}>
          {open.loading && !open.data && <li className="p-4"><LoadingBlock label="Carregando a fila de ocorrências…" /></li>}
          {!open.loading && open.error && !open.data && <li className="px-5 py-10 text-lg text-ink-muted">Fila indisponível. Tente atualizar os dados.</li>}
          {open.data && !open.error && calls.length === 0 && <li className="px-5 py-10 text-lg text-ink-muted">Nenhuma ocorrência em aberto.</li>}
          {calls.map((call) => (
            <li key={call.id} className={newCalls.has(call.id) ? 'op-new-call' : undefined}>
              <button
                type="button"
                onClick={() => navigate(`/ocorrencias/${call.id}`)}
                className="flex w-full min-w-0 items-stretch border-b border-line text-left transition-colors hover:bg-accent-soft"
              >
                <span aria-hidden className={cn("my-4 w-0.5 shrink-0", PRIORITY_TONE[call.priority])} />
                <span className="flex min-w-0 flex-1 items-start gap-3 px-3 py-4 sm:px-4">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("label-caps mb-1", PRIORITY_TEXT_TONE[call.priority])}>{PRIORITY_LABEL[call.priority]}</span>
                    <span className="text-base font-semibold leading-snug lg:text-lg">{NATURE_LABEL[call.nature]}</span>
                    <span className="mt-1 text-sm text-ink-muted">{call.address}</span>
                    <span className="mt-2 text-xs leading-relaxed text-ink-soft">
                      {call.protocol} · {OCCURRENCE_STATUS_LABEL[call.status]}
                      {byOccurrence.get(call.id)?.length ? ` · ${byOccurrence.get(call.id)!.join(", ")}` : call.status === "ABERTA" ? " · aguardando viatura" : ""}
                    </span>
                  </span>
                  <span className={cn("shrink-0 pt-4 text-xl font-semibold tabular-nums tracking-tight lg:text-3xl", call.status === "ABERTA" && call.priority !== "BAIXA" ? "text-warn" : "text-ink")}>
                    {waited(call.opened_at, now)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          </ol>
        </section>
      </main>
    </div>
  )
}

function Figure({ label, value, tone }: { label: string, value: number | null, tone?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 border border-line border-t-2 bg-surface px-4 py-4 last:col-span-2 sm:last:col-span-1", tone)}>
      <span className="label-caps text-ink-muted">{label}</span>
      <span className="text-4xl font-semibold tabular-nums tracking-tight lg:text-5xl"><AnimatedNumber value={value} /></span>
    </div>
  )
}

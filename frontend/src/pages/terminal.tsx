/**
 * The vehicle terminal (MDT).
 *
 * What runs on the tablet mounted in the cab: the call this vehicle was sent
 * to, the route and its manoeuvres, and big buttons for the crew to report
 * "on the way", "on scene", "returning" without radioing the dispatcher. The
 * tablet can share its GPS, which moves the vehicle on every console.
 *
 * It lives outside the console's chrome on purpose: large targets, high
 * contrast, nothing to navigate. A gloved finger has to hit every control.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Crosshair, Droplets, Hospital, LocateFixed, LocateOff, MessageSquare, Radio, Truck } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { dispatches, occurrences, vehicles } from "@/api/endpoints"
import {
  DISPATCH_NEXT_STATUSES, DISPATCH_STATUS_LABEL, DISPATCH_STATUS_TONE, NATURE_LABEL, PRIORITY_LABEL,
  PRIORITY_TONE, VEHICLE_STATUS_LABEL, VEHICLE_STATUS_TONE, VEHICLE_TYPE_LABEL,
} from "@/api/labels"
import type { DispatchStatus, Vehicle } from "@/api/types"
import { Badge } from "@/components/layout/kit"
import { EmptyState, ErrorBox, FullPageSpinner, LoadingBlock } from "@/components/layout/feedback"
import RouteMap from "@/components/mapa/route-map"
import { RouteGuide } from "@/components/route/route-guide"
import { RouteSteps } from "@/components/route/route-steps"
import { useRouteSimulation } from "@/hooks/use-route-simulation"
import { useRealtime } from "@/hooks/use-realtime"
import { useMutation, useResource } from "@/hooks/use-resource"
import { formatDistance, formatDuration, formatElapsed, toNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

const LAST_VEHICLE_KEY = "zeno.terminal.vehicle"

/** Ready-made lines the crew can log with one tap. */
const QUICK_NOTES = [
  "Solicito apoio de outra viatura",
  "Vítima encaminhada ao hospital",
  "Situação controlada",
  "Área isolada",
]

/** Buttons say what the crew does, not the state it ends in. */
const ACTION_LABEL: Record<DispatchStatus, string> = {
  DESPACHADO: "Despachado",
  A_CAMINHO: "A caminho",
  NO_LOCAL: "Cheguei ao local",
  RETORNANDO: "Retornando ao quartel",
  FINALIZADO: "Finalizar atendimento",
  CANCELADO: "Cancelar empenho",
}

/** Position reports are throttled: the console does not need more than this. */
const GPS_INTERVAL_MS = 10_000

export default function Terminal() {
  const { vehicleId } = useParams()
  return vehicleId ? <VehicleTerminal vehicleId={vehicleId} /> : <ChooseVehicle />
}

function ChooseVehicle() {
  const fleet = useResource(() => vehicles.list({ per_page: 100 }), [])
  const navigate = useNavigate()
  const last = (() => { try { return window.localStorage.getItem(LAST_VEHICLE_KEY) } catch { return null } })()

  const grouped = useMemo(() => {
    const groups = new Map<string, Vehicle[]>()
    for (const vehicle of fleet.data?.items ?? []) {
      const key = vehicle.unit?.acronym ?? "Sem unidade"
      groups.set(key, [...(groups.get(key) ?? []), vehicle])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [fleet.data])

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-chrome-line bg-chrome px-4 py-3 text-chrome-ink">
        <div>
          <p className="label-caps text-chrome-muted">Terminal da viatura</p>
          <h1 className="text-xl font-semibold">Qual viatura é esta?</h1>
        </div>
        <Link to="/" className="text-sm text-chrome-muted underline underline-offset-2 hover:text-chrome-ink">Voltar ao console</Link>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6">
        {fleet.loading && !fleet.data && <LoadingBlock label="Carregando a frota…" />}
        {fleet.error && <ErrorBox message={fleet.error} onRetry={fleet.reload} />}
        {fleet.data && !fleet.error && grouped.length === 0 && <EmptyState title="Nenhuma viatura cadastrada" description="As viaturas cadastradas no console aparecem aqui para iniciar o terminal." />}
        {grouped.map(([unit, items]) => (
          <section key={unit} className="flex flex-col gap-2">
            <h2 className="label-caps text-ink-muted">{unit}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {items.map((vehicle) => (
                <button
                  key={vehicle.id}
                  type="button"
                  onClick={() => {
                    try { window.localStorage.setItem(LAST_VEHICLE_KEY, vehicle.id) } catch { /* private window */ }
                    navigate(`/terminal/${vehicle.id}`)
                  }}
                  className={cn(
                    "flex min-h-20 flex-col items-start justify-between rounded-sm border bg-surface px-3 py-2 text-left transition-colors hover:border-accent",
                    vehicle.id === last ? "border-accent" : "border-line",
                  )}
                >
                  <span className="text-lg font-semibold">{vehicle.prefix}</span>
                  {vehicle.id === last && <span className="label-caps text-accent">Última utilizada</span>}
                  <span className="text-xs text-ink-muted">{VEHICLE_TYPE_LABEL[vehicle.type]} · {VEHICLE_STATUS_LABEL[vehicle.status]}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}

function VehicleTerminal({ vehicleId }: { vehicleId: string }) {
  const vehicle = useResource(() => vehicles.get(vehicleId), [vehicleId])
  const open = useResource(() => dispatches.list({ vehicle_id: vehicleId, open: true, per_page: 1 }), [vehicleId])
  const current = open.data?.items[0] ?? null
  const occurrence = useResource(
    () => occurrences.get(current!.occurrence_id),
    [current?.occurrence_id],
    { enabled: Boolean(current) },
  )
  const reloadAll = () => { vehicle.reload(); open.reload(); occurrence.reload() }

  // `useRealtime` keeps the latest handler in a ref, so an inline one is fine.
  const { connected } = useRealtime((event) => {
    if (event.type === "dispatch.created" && event.payload.vehicle_id === vehicleId) reloadAll()
    if (event.type === "dispatch.updated" && event.payload.id === current?.id) reloadAll()
    if (event.type === "occurrence.updated" && event.payload.id === current?.occurrence_id) occurrence.reload()
    // The route is saved after the dispatch is announced; the timeline ping
    // (ROTA) is the signal that it now exists.
    if (event.type === "occurrence.timeline" && event.payload.occurrence_id === current?.occurrence_id) occurrence.reload()
  })

  const advance = useMutation((status: DispatchStatus) => dispatches.updateStatus(current!.id, status))
  const note = useMutation((message: string) => occurrences.addNote(current!.occurrence_id, { message, dispatch_id: current!.id }))
  const [noted, setNoted] = useState<string | null>(null)

  const gps = useGpsShare(vehicleId)

  // Declared before the early returns: the route is read through the latest
  // occurrence detail, so the hooks see it as soon as it loads.
  const loadedDispatch = occurrence.data?.dispatches?.find((item) => item.id === current?.id) ?? null
  const loadedRoute = loadedDispatch?.used_route ?? loadedDispatch?.routes?.find((item) => item.id === loadedDispatch.used_route_id) ?? null
  const simulation = useRouteSimulation(loadedRoute?.geometry ?? null, loadedRoute?.estimated_time_seconds ?? 0, loadedRoute?.segments)
  const livePosition = simulation.position ?? gps.position
  useReportSimulatedPosition(vehicleId, simulation.position)

  if (vehicle.loading && !vehicle.data) return <div className="min-h-screen bg-canvas"><FullPageSpinner label="Abrindo terminal..." /></div>
  if (vehicle.error && !vehicle.data) return <div className="min-h-screen bg-canvas p-4"><ErrorBox message={vehicle.error} onRetry={vehicle.reload} /></div>
  if (!vehicle.data) return null

  const detail = occurrence.data
  const dispatch = detail?.dispatches?.find((item) => item.id === current?.id) ?? null
  const route = dispatch?.used_route ?? dispatch?.routes?.find((item) => item.id === dispatch.used_route_id) ?? null
  const next = current ? DISPATCH_NEXT_STATUSES[current.status] : []

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-chrome-line bg-chrome px-3 py-2 text-chrome-ink sm:px-4">
        <Link to="/terminal" className="flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-chrome-line p-2 text-chrome-muted hover:text-chrome-ink" aria-label="Trocar de viatura">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Truck className="h-6 w-6 text-chrome-muted" />
        <div className="mr-auto">
          <p className="text-lg font-semibold leading-tight">{vehicle.data.prefix}</p>
          <p className="text-xs text-chrome-muted">{VEHICLE_TYPE_LABEL[vehicle.data.type]} · {vehicle.data.unit?.acronym}</p>
        </div>
        <Badge tone={VEHICLE_STATUS_TONE[vehicle.data.status]}>{VEHICLE_STATUS_LABEL[vehicle.data.status]}</Badge>
        <button
          type="button"
          onClick={gps.toggle}
          aria-pressed={gps.sharing}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-sm border px-3 py-2 text-sm font-semibold",
            gps.sharing ? "border-ok bg-ok-soft text-ok" : "border-chrome-line text-chrome-ink hover:bg-chrome-soft",
          )}
        >
          {gps.sharing ? <LocateFixed className="h-4 w-4" /> : <LocateOff className="h-4 w-4" />}
          {gps.sharing ? "GPS ativo" : "Compartilhar GPS"}
        </button>
        <span className={cn("label-caps inline-flex items-center gap-1 rounded-sm border px-2 py-1", connected ? "border-ok/40 bg-ok-soft text-ok" : "border-alert/50 bg-alert-soft text-alert")}>
          <Radio className="h-3.5 w-3.5" />
          {connected ? "Online" : "Offline"}
        </span>
      </header>

      {gps.error && <p className="bg-warn-soft px-4 py-2 text-sm text-ink">{gps.error}</p>}
      {gps.sharing && gps.lastSent && (
        <p className="bg-ok-soft px-4 py-1 text-xs text-ink">Posição enviada {formatElapsed(gps.lastSent.toISOString())} · precisão {Math.round(gps.accuracy ?? 0)} m</p>
      )}

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-3 py-4 sm:px-4">
        {vehicle.error && <ErrorBox message={`Não foi possível atualizar a viatura. ${vehicle.error}`} onRetry={vehicle.reload} />}
        {open.loading && !open.data && <LoadingBlock label="Consultando o empenho da viatura…" />}
        {open.error && <ErrorBox message={`Não foi possível atualizar o empenho. ${open.error}${current ? " O último despacho carregado permanece visível." : ""}`} onRetry={open.reload} />}
        {current && occurrence.loading && !occurrence.data && <LoadingBlock label="Carregando detalhes e rota da ocorrência…" />}
        {current && occurrence.error && <ErrorBox message={`Detalhes da ocorrência: ${occurrence.error}`} onRetry={occurrence.reload} />}
        {!current && open.data && !open.loading && !open.error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
            <Crosshair className="h-10 w-10 text-ink-soft" />
            <p className="text-xl font-semibold text-ink">Sem empenho no momento</p>
            <p className="max-w-md text-ink-muted">Quando o despacho enviar esta viatura, a ocorrência aparece aqui sozinha, com a rota e as manobras.</p>
          </div>
        )}

        {current && (
          <>
            <section className="flex overflow-hidden rounded-sm border border-line bg-surface">
              <span aria-hidden className={cn("w-2 shrink-0", detail ? PRIORITY_TONE[detail.priority] : "bg-line")} />
              <div className="flex flex-1 flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="label-caps text-ink-muted">Ocorrência {current.occurrence?.protocol}</p>
                  <Badge tone={DISPATCH_STATUS_TONE[current.status]}>{DISPATCH_STATUS_LABEL[current.status]}</Badge>
                </div>
                <p className="text-2xl font-semibold text-ink">{current.occurrence ? NATURE_LABEL[current.occurrence.nature] : "—"}</p>
                <p className="text-lg text-ink">{current.occurrence?.address}</p>
                {detail && (
                  <p className="text-sm text-ink-muted">
                    Prioridade {PRIORITY_LABEL[detail.priority].toLowerCase()} · aberta {formatElapsed(detail.opened_at)}
                    {detail.caller_phone && <> · solicitante <a className="font-semibold text-accent" href={`tel:${detail.caller_phone}`}>{detail.caller_phone}</a></>}
                  </p>
                )}
                {detail?.description && <p className="mt-1 whitespace-pre-line text-ink">{detail.description}</p>}
              </div>
            </section>

            {advance.error && <ErrorBox message={advance.error} />}
            {next.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {next.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={advance.submitting}
                    onClick={async () => { if (await advance.run(status)) reloadAll() }}
                    className={cn(
                      "min-h-16 rounded-sm border text-xl font-semibold transition-colors disabled:opacity-50",
                      status === "CANCELADO"
                        ? "border-line-strong bg-surface text-ink-muted hover:bg-surface-muted"
                        : "border-action bg-action text-white hover:bg-action-hover",
                    )}
                  >
                    {ACTION_LABEL[status]}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <RouteMap
                route={route?.geometry ?? null}
                routeSegments={route?.segments}
                routeSteps={route?.steps}
                routeSeconds={route?.estimated_time_seconds}
                criticalMode={route?.algorithm === 'CRITICAL'}
                pin={!route && detail ? { latitude: toNumber(detail.latitude) ?? 0, longitude: toNumber(detail.longitude) ?? 0, label: "Ocorrência" } : null}
                originLabel={vehicle.data.prefix}
                livePosition={livePosition ? { latitude: livePosition[0], longitude: livePosition[1], label: `${vehicle.data.prefix} agora` } : null}
                destinationLabel="Ocorrência"
                className="h-[55vh] min-h-[320px] w-full"
                emptyMessage="A rota aparece assim que a IA calcular o trajeto."
              />
              <div className="flex min-w-0 flex-col gap-3">
                {route && (
                  <div className="flex items-baseline justify-between rounded-sm border border-line bg-surface px-4 py-3">
                    <span className="text-3xl font-semibold tabular-nums text-ink">{formatDuration(route.estimated_time_seconds)}</span>
                    <span className="text-ink-muted">{formatDistance(route.distance_meters)}</span>
                  </div>
                )}
                {route && (
                  <RouteGuide geometry={route.geometry} steps={route.steps ?? []} position={livePosition} simulation={simulation} />
                )}
                {route && (
                  <div className="rounded-sm border border-line bg-surface p-3">
                    <RouteSteps
                      compact
                      steps={route.steps ?? []}
                      title={`${vehicle.data.prefix} → ${current.occurrence?.protocol ?? "ocorrência"}`}
                      summary={current.occurrence?.address}
                    />
                  </div>
                )}
                <NearbyForCrew occurrenceId={current.occurrence_id} />
              </div>
            </div>

            <section className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-3" aria-label="Informar ao despacho">
              <p className="label-caps flex items-center gap-1.5 text-ink-muted"><MessageSquare className="h-4 w-4" /> Informar ao despacho</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {QUICK_NOTES.map((message) => (
                  <button
                    key={message}
                    type="button"
                    disabled={note.submitting}
                    onClick={async () => { if (await note.run(message)) { setNoted(message); window.setTimeout(() => setNoted(null), 3000) } }}
                    className="min-h-12 rounded-sm border border-line-strong bg-surface-muted px-3 text-left font-semibold text-ink hover:border-accent"
                  >
                    {message}
                  </button>
                ))}
              </div>
              {noted && <p role="status" className="text-sm text-ok">Registrado na linha do tempo: “{noted}”.</p>}
              {note.error && <ErrorBox message={note.error} />}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function NearbyForCrew({ occurrenceId }: { occurrenceId: string }) {
  const water = useResource(() => occurrences.waterSources(occurrenceId, 3), [occurrenceId])
  const hospitals = useResource(() => occurrences.hospitals(occurrenceId), [occurrenceId])

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-3 text-sm">
      <div>
        <p className="label-caps mb-1 flex items-center gap-1.5 text-ink-muted"><Droplets className="h-4 w-4" /> Hidrantes</p>
        {water.loading && !water.data && <p role="status" className="text-ink-muted">Consultando pontos de água…</p>}
        {water.error && <p className="text-warn">Pontos de água indisponíveis no momento.</p>}
        {(water.data ?? []).map((source) => (
          <p key={source.id} className="flex justify-between gap-2">
            <span className="min-w-0 truncate text-ink">{source.code} · {source.address}</span>
            <span className={cn("shrink-0 tabular-nums", source.status === "INOPERANTE" ? "text-alert line-through" : "text-ink")}>{formatDistance(source.distance_meters ?? null)}</span>
          </p>
        ))}
        {water.data?.length === 0 && !water.error && <p className="text-ink-muted">Nenhum cadastrado.</p>}
      </div>
      <div>
        <p className="label-caps mb-1 flex items-center gap-1.5 text-ink-muted"><Hospital className="h-4 w-4" /> Hospital mais rápido</p>
        {hospitals.data?.[0] ? (
          <p className="flex justify-between gap-2">
            <span className="min-w-0 truncate text-ink">{hospitals.data[0].name}</span>
            <span className="shrink-0 tabular-nums text-ink">{formatDuration(hospitals.data[0].eta_seconds)}</span>
          </p>
        ) : <p className="text-ink-muted">{hospitals.error ? "Hospitais indisponíveis no momento." : hospitals.loading ? "Calculando…" : "Nenhum hospital encontrado na região."}</p>}
      </div>
    </div>
  )
}

/**
 * Sends the simulated position like a tablet would, every few seconds, so the
 * wallboard and the occurrence screens see the vehicle move.
 */
function useReportSimulatedPosition(vehicleId: string, position: [number, number] | null) {
  const lastSent = useRef(0)
  useEffect(() => {
    if (!position || Date.now() - lastSent.current < 3000) return
    lastSent.current = Date.now()
    vehicles.update(vehicleId, { current_latitude: position[0], current_longitude: position[1] }).catch(() => undefined)
  }, [vehicleId, position])
}

/** Shares the tablet's GPS with the backend while the crew keeps it on. */
function useGpsShare(vehicleId: string) {
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<Date | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [position, setPosition] = useState<[number, number] | null>(null)
  const lastSentAt = useRef(0)

  useEffect(() => {
    if (!sharing || !("geolocation" in navigator)) return

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setError(null)
        setAccuracy(position.coords.accuracy)
        setPosition([position.coords.latitude, position.coords.longitude])
        if (Date.now() - lastSentAt.current < GPS_INTERVAL_MS) return
        lastSentAt.current = Date.now()
        vehicles.update(vehicleId, {
          current_latitude: position.coords.latitude,
          current_longitude: position.coords.longitude,
        })
          .then(() => setLastSent(new Date()))
          .catch(() => setError("Não foi possível enviar a posição. Tentando de novo na próxima leitura."))
      },
      (failure) => setError(failure.code === failure.PERMISSION_DENIED
        ? "Permissão de localização negada no navegador."
        : "Sem sinal de GPS no momento."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )

    return () => navigator.geolocation.clearWatch(watch)
  }, [sharing, vehicleId])

  const toggle = () => {
    if (!sharing && !("geolocation" in navigator)) {
      setError("Este dispositivo não informa a posição.")
      return
    }
    setSharing((value) => !value)
  }

  return { sharing, error, lastSent, accuracy, toggle, position: sharing ? position : null }
}

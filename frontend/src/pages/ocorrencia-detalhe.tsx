/**
 * One incident, end to end.
 *
 * This is where the project's thesis becomes visible: the route the network
 * chose and the shortest route in metres are drawn on the same map and put
 * side by side in numbers, for the very dispatch that was sent.
 */

import { useCallback, useMemo, useState } from "react"
import type { FormEvent } from "react"
import { ArrowLeft, Brain, ListOrdered, MapPin, Pencil, Play, Printer, Route as RouteIcon, Send, Sparkles, Truck } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router-dom"

import { crews, dispatches, occurrences, units, vehicles } from "@/api/endpoints"
import { translateMessage } from "@/api/messages"
import {
  DISPATCH_NEXT_STATUSES, DISPATCH_STATUS_LABEL, DISPATCH_STATUS_TONE,
  NATURE_LABEL, OCCURRENCE_NEXT_STATUSES, OCCURRENCE_STATUS_LABEL, OCCURRENCE_STATUS_TONE,
  PRIORITY_LABEL, PRIORITY_TEXT_TONE, PRIORITY_TONE, VEHICLE_TYPE_LABEL, optionsOf,
} from "@/api/labels"
import type {
  Dispatch, DispatchStatus, Occurrence, OccurrencePriority, OccurrenceStatus, RouteStep, RouteVariant,
} from "@/api/types"
import {
  ActionButton, Badge, ConfirmButton, Field, Modal, Page, PageHeader, Panel, Select,
  TextArea, TextInput,
} from "@/components/layout/kit"
import { EmptyState, ErrorBox, ErrorDetails, FullPageSpinner } from "@/components/layout/feedback"
import RouteMap from "@/components/mapa/route-map"
import { OccurrenceAvatar } from "@/components/occurrence-icon"
import { printOccurrenceReport } from "@/components/occurrence/print-report"
import { SceneSupport } from "@/components/occurrence/scene-support"
import { OccurrenceReplay } from "@/components/operational/occurrence-replay"
import { OccurrenceStages } from "@/components/operational/occurrence-stages"
import { useTimeline } from "@/hooks/use-timeline"
import { VehicleRecommendations } from "@/components/occurrence/vehicle-recommendations"
import { RouteInsight } from "@/components/route/route-insight"
import { RouteSteps } from "@/components/route/route-steps"
import { useRealtime } from "@/hooks/use-realtime"
import { useMutation, useResource } from "@/hooks/use-resource"
import {
  formatCoordinate, formatDateTime, formatDistance, formatDuration, formatElapsed, toNumber,
} from "@/lib/format"
import { stationsOf } from "@/lib/geo"

export default function OcorrenciaDetalhe() {
  const { id = "" } = useParams()
  const [searchParams] = useSearchParams()
  const [dispatching, setDispatching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [theater, setTheater] = useState(false)
  const [replayRequest, setReplayRequest] = useState(0)
  const [explain, setExplain] = useState(false)
  const [focus, setFocus] = useState<{ latitude: number, longitude: number, key: number } | null>(null)

  const detail = useResource(() => occurrences.get(id), [id], { enabled: Boolean(id) })
  const reload = detail.reload

  useRealtime(useCallback((event) => {
    const touchesThis =
      (event.type === "occurrence.updated" && event.payload.id === id) ||
      (event.type === "dispatch.created" && event.payload.occurrence_id === id) ||
      (event.type === "dispatch.updated" && event.payload.occurrence_id === id)

    if (touchesThis) reload()
  }, [id, reload]))

  // Declared before the early returns below: hooks cannot be conditional.
  const changeStatus = useMutation(
    (status: OccurrenceStatus) => occurrences.update(id, { status }),
  )

  const unitList = useResource(() => units.list({ active: true }), [])

  const stations = useMemo(() => stationsOf(unitList.data?.items), [unitList.data])

  const timeline = useTimeline(id)

  if (detail.loading && !detail.data) return <FullPageSpinner label="Carregando ocorrência..." />
  if (detail.error) return <Page><ErrorBox message={detail.error} onRetry={detail.reload} /></Page>
  if (!detail.data) return null

  const occurrence = detail.data
  const dispatchList = occurrence.dispatches ?? []

  // The map shows the newest dispatch, which is the one being driven now.
  const current = dispatchList[dispatchList.length - 1] ?? null
  const neural = current?.routes?.find((route) => route.algorithm === "NEURAL") ?? null
  const critical = current?.routes?.find((route) => route.algorithm === "CRITICAL") ?? null
  const shortest = current?.routes?.find((route) => route.algorithm === "DIJKSTRA") ?? null

  const closed = occurrence.status === "ENCERRADA" || occurrence.status === "CANCELADA"
  const usedRoute = current?.used_route
    ?? current?.routes?.find((route) => route.id === current.used_route_id)
    ?? (closed ? (current?.critical_mode ? critical : neural) : null)
  const displayedRoute = closed && usedRoute ? usedRoute : neural

  return (
    <Page>
      <Link to="/ocorrencias" className="flex w-fit items-center gap-1 font-semibold text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Voltar para as ocorrências
      </Link>

      <PageHeader
        title={`Ocorrência ${occurrence.protocol}`}
        subtitle={`${NATURE_LABEL[occurrence.nature]} — aberta ${formatElapsed(occurrence.opened_at)}`}
        actions={(
          <>
            <ActionButton
              tone="ghost"
              onClick={() => printOccurrenceReport(occurrence, timeline.data ?? [])}
              title="Relatório de atendimento para arquivo ou assinatura"
            >
              <Printer className="h-4 w-4" />
              Imprimir relatório
            </ActionButton>
            {!closed && <>
            <ActionButton tone="neutral" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Editar
            </ActionButton>

            {OCCURRENCE_NEXT_STATUSES[occurrence.status].map((status) => (
              <ConfirmButton
                key={status}
                label={status === "ENCERRADA" ? "Encerrar" : "Cancelar ocorrência"}
                confirmLabel={status === "ENCERRADA" ? "Confirmar encerramento" : "Confirmar cancelamento"}
                disabled={changeStatus.submitting}
                onConfirm={async () => {
                  const updated = await changeStatus.run(status)
                  if (updated) detail.reload()
                }}
              />
            ))}

            <ActionButton tone="primary" onClick={() => setDispatching(true)}>
              <Send className="h-5 w-5" />
              Despachar viatura
            </ActionButton>
            </>}
          </>
        )}
      />

      {changeStatus.error && <ErrorBox message={changeStatus.error} />}
      <OccurrenceStages occurrence={occurrence} events={timeline.data ?? []} />

      {/* The severity band of the first version filled this whole strip. One
          incident deserves the emphasis, but as a rail down the side, so the
          same language reads here and on the list it was opened from. */}
      <div className="flex rounded-sm border border-line bg-surface">
        <span aria-hidden className={`w-1.5 shrink-0 rounded-l-sm ${PRIORITY_TONE[occurrence.priority]}`} />

        <div className="flex flex-1 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <OccurrenceAvatar
              nature={occurrence.nature}
              size="lg"
              tone={PRIORITY_TEXT_TONE[occurrence.priority]}
            />

            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-ink sm:text-xl">{NATURE_LABEL[occurrence.nature]}</p>
              <p className="break-words text-ink-muted">{occurrence.address}</p>
            </div>
          </div>

          <div className="flex flex-row-reverse flex-wrap items-center justify-end gap-2 sm:ml-auto sm:flex-col sm:items-end">
            <Badge tone={OCCURRENCE_STATUS_TONE[occurrence.status]}>
              {OCCURRENCE_STATUS_LABEL[occurrence.status]}
            </Badge>
            <span className={`label-caps ${PRIORITY_TEXT_TONE[occurrence.priority]}`}>
              Prioridade {PRIORITY_LABEL[occurrence.priority]}
            </span>
          </div>
        </div>
      </div>

      <div className={theater
        ? "flex flex-col gap-4 sm:gap-5"
        : "grid items-stretch gap-4 sm:gap-5 lg:grid-cols-[1fr_1.4fr]"}>
        <Panel title="Detalhes" icon={<MapPin className="h-5 w-5" />}>
          <Detail term="Solicitante" value={occurrence.caller_name ?? "Não informado"} />
          <Detail term="Telefone" value={occurrence.caller_phone ?? "Não informado"} />
          <Detail term="Unidade responsável" value={occurrence.unit ? `${occurrence.unit.acronym} — ${occurrence.unit.name}` : "—"} />
          <Detail term="Aberta em" value={formatDateTime(occurrence.opened_at)} />
          {occurrence.closed_at && <Detail term="Encerrada em" value={formatDateTime(occurrence.closed_at)} />}
          <Detail
            term="Coordenadas"
            value={`${formatCoordinate(occurrence.latitude)}, ${formatCoordinate(occurrence.longitude)}`}
          />

          <div className="pt-1">
            <p className="font-semibold text-ink">Relato</p>
            <p className="mt-1 whitespace-pre-line text-ink">{occurrence.description}</p>
          </div>
        </Panel>

        <Panel
          title={closed && usedRoute ? "Rota utilizada" : "Rota calculada"}
          icon={<RouteIcon className="h-5 w-5" />}
          actions={displayedRoute ? (
            <div className="flex flex-wrap gap-2">
              {(displayedRoute.segments?.length ?? 0) > 0 && (
                <ActionButton
                  tone={explain ? "primary" : "neutral"}
                  className="px-3 py-1.5 text-sm"
                  aria-pressed={explain}
                  onClick={() => setExplain((value) => !value)}
                  title="Pinta a rota pela velocidade que a rede prevê em cada trecho"
                >
                  <Sparkles className="h-4 w-4" />
                  Explicar
                </ActionButton>
              )}
              {closed && usedRoute && (
                <ActionButton
                  tone="neutral"
                  className="px-3 py-1.5 text-sm"
                  onClick={() => setReplayRequest((value) => value + 1)}
                >
                  <Play className="h-4 w-4" />
                  Simular novamente
                </ActionButton>
              )}
            </div>
          ) : undefined}
        >
          {closed && usedRoute && (
            <p className="rounded-sm border border-accent/25 bg-accent-soft px-3 py-2 text-sm text-ink">
              Rota registrada no atendimento: <strong>{routeAlgorithmLabel(usedRoute.algorithm)}</strong>.
              O trajeto abaixo é o histórico salvo, não um novo cálculo.
            </p>
          )}

          <RouteMap
            route={displayedRoute?.geometry ?? null}
            critical={!closed ? critical?.geometry ?? null : null}
            comparison={shortest?.geometry ?? null}
            stations={stations}
            selectedStationId={occurrence.unit_id}
            pin={displayedRoute ? null : {
              latitude: toNumber(occurrence.latitude) ?? 0,
              longitude: toNumber(occurrence.longitude) ?? 0,
              label: `Ocorrência ${occurrence.protocol}`,
            }}
            theater={theater}
            onTheaterToggle={() => setTheater((current) => !current)}
            simulationRequest={replayRequest}
            presentationStep={searchParams.get('presentation')}
            routeSegments={displayedRoute?.segments}
            routeFeatures={displayedRoute?.route_features}
            destinationPoint={toNumber(occurrence.latitude) !== null && toNumber(occurrence.longitude) !== null ? { latitude: Number(occurrence.latitude), longitude: Number(occurrence.longitude) } : undefined}
            occurrenceNature={occurrence.nature}
            occurrencePriority={occurrence.priority}
            vehicleVisual={current?.vehicle ? { type: current.vehicle.type, prefix: current.vehicle.prefix, unit_acronym: occurrence.unit?.acronym } : undefined}
            routeSteps={displayedRoute?.steps}
            routeSeconds={displayedRoute?.estimated_time_seconds}
            criticalMode={displayedRoute?.algorithm === 'CRITICAL'}
            speedSegments={explain ? displayedRoute?.segments ?? null : null}
            focus={focus}
            originLabel="Saída da viatura"
            destinationLabel={`Ocorrência ${occurrence.protocol}`}
            className={theater
              ? "h-[78vh] min-h-[420px] w-full"
              : "h-[45vh] min-h-[320px] w-full sm:h-[420px]"}
            emptyMessage="Nenhum despacho com rota calculada para esta ocorrência."
          />
        </Panel>

        <RouteComparison neural={neural} shortest={shortest} />

        {displayedRoute && (
          <Panel title="Manobras" icon={<ListOrdered className="h-5 w-5" />}>
            <RouteSteps
              steps={displayedRoute.steps ?? []}
              title={`${current?.vehicle?.prefix ?? "Viatura"} → Ocorrência ${occurrence.protocol}`}
              summary={`${occurrence.address} · ${formatDistance(displayedRoute.distance_meters)} · ${formatDuration(displayedRoute.estimated_time_seconds)} estimados (${routeAlgorithmLabel(displayedRoute.algorithm)})`}
              onSelect={(step: RouteStep) => setFocus({ latitude: step.location[0], longitude: step.location[1], key: Date.now() })}
            />
          </Panel>
        )}

        <SceneSupport occurrence={occurrence} />

        <OccurrenceReplay occurrence={occurrence} timeline={timeline} stations={stations} />

        <Panel title="Despachos" icon={<Truck className="h-5 w-5" />}>
          {dispatchList.length === 0 && (
            <EmptyState
              title="Nenhuma viatura despachada"
              description="Despache uma viatura para que a IA calcule a rota operacional."
            />
          )}

          <div className="flex flex-col gap-3">
            {dispatchList.map((dispatch) => (
              <DispatchCard key={dispatch.id} dispatch={dispatch} onChanged={detail.reload} />
            ))}
          </div>
        </Panel>
      </div>

      {editing && (
        <EditOccurrenceModal
          occurrence={occurrence}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); detail.reload() }}
        />
      )}

      {dispatching && (
        <DispatchModal
          occurrence={occurrence}
          onClose={() => setDispatching(false)}
          onDispatched={() => { setDispatching(false); detail.reload() }}
        />
      )}
    </Page>
  )
}

function routeAlgorithmLabel(algorithm: RouteVariant["algorithm"]) {
  if (algorithm === "CRITICAL") return "Modo crítico"
  if (algorithm === "NEURAL") return "IA"
  return "Rota padrão"
}

function Detail({ term, value }: { term: string, value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-1.5">
      <span className="text-ink-muted">{term}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  )
}

/**
 * The side-by-side the project exists to demonstrate. The gain is stated in
 * seconds and in percent, and it is honest about a negative result: if the
 * network picked a slower path, that is what the panel says.
 */
function RouteComparison({ neural, shortest }: { neural: RouteVariant | null, shortest: RouteVariant | null }) {
  if (!neural || !shortest) {
    return (
      <Panel title="Comparação de rotas" icon={<Brain className="h-5 w-5" />}>
        <p className="text-ink-muted">
          A comparação aparece assim que uma viatura for despachada e a IA responder.
        </p>
      </Panel>
    )
  }

  const savedSeconds = shortest.estimated_time_seconds - neural.estimated_time_seconds
  const percent = shortest.estimated_time_seconds > 0
    ? (savedSeconds / shortest.estimated_time_seconds) * 100
    : 0

  return (
    <Panel title="Comparação de rotas" icon={<Brain className="h-5 w-5" />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Variant title="IA" accent="border-accent" route={neural} />
        <Variant title="Menor distância" accent="border-line-strong" route={shortest} />
      </div>

      <div className="rounded-sm border border-line bg-surface-muted px-4 py-3">
        {savedSeconds > 0 ? (
          <p className="text-ink">
            A rota da IA chega{" "}
            <strong className="text-ok">{formatDuration(savedSeconds)} antes</strong>{" "}
            ({percent.toFixed(1).replace(".", ",")}% mais rápida), percorrendo{" "}
            {formatDistance(neural.distance_meters - shortest.distance_meters)} a mais.
          </p>
        ) : savedSeconds < 0 ? (
          <p className="text-ink">
            Neste trajeto a rota mais curta em metros foi{" "}
            <strong className="text-alert">{formatDuration(Math.abs(savedSeconds))} mais rápida</strong>{" "}
            que a escolhida pela IA.
          </p>
        ) : (
          <p className="text-ink">As duas rotas levam o mesmo tempo estimado.</p>
        )}

        {neural.model_version && (
          <p className="mt-1 text-sm text-ink-muted">
            Modelo <span className="font-mono">{neural.model_version}</span>
          </p>
        )}
      </div>

      <RouteInsight neural={neural} shortest={shortest} />
    </Panel>
  )
}

function Variant({ title, accent, route }: { title: string, accent: string, route: RouteVariant }) {
  return (
    <div className={`flex flex-col gap-1 rounded-sm border-l-4 bg-surface px-3 py-2 ${accent}`}>
      <p className="font-semibold text-ink">{title}</p>
      <p className="text-2xl font-semibold text-ink">{formatDuration(route.estimated_time_seconds)}</p>
      <p className="text-ink-muted">{formatDistance(route.distance_meters)}</p>
      <p className="text-sm text-ink-soft">{route.node_count} cruzamentos</p>
    </div>
  )
}

function DispatchCard({ dispatch, onChanged }: { dispatch: Dispatch, onChanged: () => void }) {
  const advance = useMutation((status: DispatchStatus) => dispatches.updateStatus(dispatch.id, status))
  const next = DISPATCH_NEXT_STATUSES[dispatch.status]
  const usedRoute = dispatch.used_route
    ?? dispatch.routes?.find((route) => route.id === dispatch.used_route_id)
    ?? null

  async function handleAdvance(status: DispatchStatus) {
    const updated = await advance.run(status)
    if (updated) onChanged()
  }

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-ink">
            {dispatch.vehicle?.prefix ?? "Viatura"}
            {dispatch.vehicle && (
              <span className="ml-2 text-sm font-normal text-ink-muted">
                {VEHICLE_TYPE_LABEL[dispatch.vehicle.type]}
              </span>
            )}
          </p>
          <p className="text-sm text-ink-muted">
            Despachada em {formatDateTime(dispatch.dispatched_at)}
          </p>
        </div>

        <Badge tone={DISPATCH_STATUS_TONE[dispatch.status]}>
          {DISPATCH_STATUS_LABEL[dispatch.status]}
        </Badge>
      </div>

      {dispatch.crew && (
        <p className="text-sm text-ink-muted">
          Guarnição <strong>{dispatch.crew.name}</strong>
          {dispatch.crew.commander && ` — comandante ${dispatch.crew.commander.war_name}`}
        </p>
      )}

      {usedRoute && (
        <p className="text-sm text-ink-muted">
          Rota utilizada:{" "}
          <strong className="text-ink">
            {routeAlgorithmLabel(usedRoute.algorithm)}
          </strong>
          {" · "}
          {formatDistance(usedRoute.distance_meters)}
          {" · "}
          {formatDuration(usedRoute.estimated_time_seconds)}
        </p>
      )}

      {advance.error && <ErrorBox message={advance.error} />}

      {next.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {next.map((status) => (
            <ActionButton
              key={status}
              tone={status === "CANCELADO" ? "ghost" : "neutral"}
              className="px-3 py-1.5 text-sm"
              disabled={advance.submitting}
              onClick={() => handleAdvance(status)}
            >
              {DISPATCH_STATUS_LABEL[status]}
            </ActionButton>
          ))}
        </div>
      )}
    </div>
  )
}

function DispatchModal({ occurrence, onClose, onDispatched }: {
  occurrence: Occurrence
  onClose: () => void
  onDispatched: () => void
}) {
  const fleet = useResource(() => vehicles.list({ status: "DISPONIVEL", per_page: 100 }), [])
  const [vehicleId, setVehicleId] = useState("")
  const [crewId, setCrewId] = useState("")
  const [criticalMode, setCriticalMode] = useState(false)

  // Only the crews already assigned to the chosen vehicle can be sent with it,
  // which is exactly what the backend enforces.
  const crewList = useResource(
    () => crews.list({ vehicle_id: vehicleId, active: true, per_page: 50 }),
    [vehicleId],
    { enabled: Boolean(vehicleId) },
  )

  const send = useMutation(dispatches.create)
  const [warning, setWarning] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const result = await send.run({
      occurrence_id: occurrence.id,
      vehicle_id: vehicleId,
      crew_id: crewId || undefined,
      critical_mode: criticalMode,
    })

    if (!result) return

    // A dispatch without routes means the AI was unreachable. The vehicle is
    // on its way regardless, so this is a warning, not a failure.
    if (result.routes.length === 0) {
      setWarning(translateMessage(result.message ?? "Viatura despachada, mas a rota não pôde ser calculada."))
      window.setTimeout(onDispatched, 2500)
      return
    }

    onDispatched()
  }

  return (
    <Modal title={`Despachar para ${occurrence.protocol}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {send.error && <ErrorBox message={send.error} />}
        <ErrorDetails details={send.details} />

        {warning && (
          <div className="rounded-sm border border-warn/30 bg-warn-soft px-4 py-3 text-ink">
            {warning}
          </div>
        )}

        <VehicleRecommendations
          occurrenceId={occurrence.id}
          criticalMode={criticalMode}
          selectedId={vehicleId}
          onChoose={(item) => { setVehicleId(item.vehicle.id); setCrewId(item.crew?.id ?? "") }}
        />

        <Field label="Viatura disponível" required>
          <Select
            value={vehicleId}
            onChange={(value) => { setVehicleId(value); setCrewId("") }}
            placeholder={fleet.loading ? "Carregando..." : "Selecione a viatura"}
            options={(fleet.data?.items ?? []).map((vehicle) => ({
              value: vehicle.id,
              label: `${vehicle.prefix} — ${VEHICLE_TYPE_LABEL[vehicle.type]}`,
            }))}
          />
        </Field>

        {fleet.data && fleet.data.items.length === 0 && (
          <p className="text-alert">Nenhuma viatura disponível no momento.</p>
        )}

        <Field label="Guarnição" hint="Opcional — apenas guarnições ligadas à viatura escolhida">
          <Select
            value={crewId}
            onChange={setCrewId}
            placeholder={vehicleId ? "Sem guarnição definida" : "Escolha a viatura primeiro"}
            disabled={!vehicleId}
            options={(crewList.data?.items ?? []).map((crew) => ({ value: crew.id, label: crew.name }))}
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-alert/30 bg-alert-soft px-4 py-3">
          <input
            type="checkbox"
            checked={criticalMode}
            onChange={(event) => setCriticalMode(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span className="flex flex-col gap-1">
            <strong className="text-ink">Usar modo crítico de deslocamento</strong>
            <span className="text-sm text-ink-muted">
              Calcula uma alternativa operacional crítica além da IA e da rota
              padrão, usando exceções de trânsito apenas quando a malha indicar viabilidade.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <ActionButton tone="ghost" type="button" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton tone="primary" type="submit" disabled={send.submitting || !vehicleId}>
            {send.submitting ? "Despachando..." : "Confirmar despacho"}
          </ActionButton>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Editing is limited to what `UpdateOccurrenceService` accepts: the priority,
 * the address and the report. Nature and coordinates are immutable — a wrong
 * one is a different incident, not an edit.
 */
function EditOccurrenceModal({ occurrence, onClose, onSaved }: {
  occurrence: Occurrence
  onClose: () => void
  onSaved: () => void
}) {
  const [priority, setPriority] = useState<string>(occurrence.priority)
  const [address, setAddress] = useState(occurrence.address)
  const [description, setDescription] = useState(occurrence.description)

  const save = useMutation(() => occurrences.update(occurrence.id, {
    priority: priority as OccurrencePriority,
    address: address.trim(),
    description: description.trim(),
  }))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const updated = await save.run(undefined)
    if (updated) onSaved()
  }

  return (
    <Modal title={`Editar ${occurrence.protocol}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {save.error && <ErrorBox message={save.error} />}
        <ErrorDetails details={save.details} />

        <Field label="Prioridade" required>
          <Select value={priority} onChange={setPriority} options={optionsOf(PRIORITY_LABEL)} />
        </Field>

        <Field label="Endereço" required>
          <TextInput required value={address} onChange={(event) => setAddress(event.target.value)} />
        </Field>

        <Field label="Relato" required>
          <TextArea required value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <ActionButton tone="ghost" type="button" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton tone="primary" type="submit" disabled={save.submitting}>
            {save.submitting ? "Salvando..." : "Salvar"}
          </ActionButton>
        </div>
      </form>
    </Modal>
  )
}

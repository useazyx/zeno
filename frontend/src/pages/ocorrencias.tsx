/** Operational incident register, refreshed by the dispatch live feed. */

import { useCallback, useMemo, useState } from "react"
import type { FormEvent } from "react"
import { Filter, MapPin, Plus, Search } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"

import { ai, geo, occurrences, units } from "@/api/endpoints"
import {
  NATURE_LABEL, OCCURRENCE_STATUS_LABEL, OCCURRENCE_STATUS_TONE,
  PRIORITY_LABEL, PRIORITY_TEXT_TONE, PRIORITY_TONE, optionsOf,
} from "@/api/labels"
import type { Occurrence, OccurrenceNature, OccurrencePriority, OccurrenceStatus } from "@/api/types"
import {
  ActionButton, Badge, Field, FieldButton, Modal, Page, PageHeader, Pagination, Panel, Select,
  TextArea, TextInput,
} from "@/components/layout/kit"
import { EmptyState, ErrorBox, ErrorDetails, LoadingBlock } from "@/components/layout/feedback"
import RouteMap from "@/components/mapa/route-map"
import { AddressSearch } from "@/components/occurrence/address-search"
import { useRealtime } from "@/hooks/use-realtime"
import { useMutation, useResource } from "@/hooks/use-resource"
import { formatDistance, formatElapsed, formatShort } from "@/lib/format"
import { nearestTo, stationsOf } from "@/lib/geo"
import { PaginatedExport } from "@/components/layout/export-button"
import { occurrenceReport } from "@/lib/report-builders"

const PER_PAGE = 12

export default function Ocorrencias() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("")
  const [nature, setNature] = useState("")
  const [priority, setPriority] = useState("")
  const [search, setSearch] = useState("")
  const [applied, setApplied] = useState("")
  // `?nova=1` opens the form straight away: it is where the keyboard shortcut
  // and the command palette land when a call comes in.
  const [searchParams, setSearchParams] = useSearchParams()
  const [creatingState, setCreatingState] = useState(false)
  const creating = creatingState || searchParams.get("nova") === "1"
  const setCreating = useCallback((value: boolean) => {
    setCreatingState(value)
    if (!value && searchParams.has("nova")) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  const list = useResource(
    () => occurrences.list({
      page,
      per_page: PER_PAGE,
      status: (status || undefined) as OccurrenceStatus | undefined,
      nature: (nature || undefined) as OccurrenceNature | undefined,
      priority: (priority || undefined) as OccurrencePriority | undefined,
      search: applied || undefined,
    }),
    [page, status, nature, priority, applied],
  )

  const reload = list.reload

  // A new incident has to appear without the dispatcher reaching for refresh.
  useRealtime(useCallback((event) => {
    if (event.type === "occurrence.created" || event.type === "occurrence.updated") reload()
  }, [reload]))

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setApplied(search.trim())
  }

  return (
    <Page>
      <PageHeader
        title="Ocorrências"
        subtitle="Chamados registrados e seu andamento"
        actions={
          <>
          <PaginatedExport title="ocorrências" description="PDF para leitura e Excel para análise, com os filtros aplicados nesta lista."
            data={list.data} disabled={list.loading || Boolean(list.error)}
            fetchPage={(page, per_page) => occurrences.list({ page, per_page, status: (status || undefined) as OccurrenceStatus | undefined, nature: (nature || undefined) as OccurrenceNature | undefined, priority: (priority || undefined) as OccurrencePriority | undefined, search: applied || undefined })}
            report={(rows, scope) => occurrenceReport(rows, `${scope} | Situação: ${OCCURRENCE_STATUS_LABEL[status as OccurrenceStatus] ?? "Todas"} | Natureza: ${NATURE_LABEL[nature as OccurrenceNature] ?? "Todas"} | Prioridade: ${PRIORITY_LABEL[priority as OccurrencePriority] ?? "Todas"} | Busca: ${applied || "Sem busca"}`)} />
          <ActionButton tone="primary" onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" />
            Nova ocorrência
          </ActionButton>
          </>
        }
      />

      <Panel title="Filtros operacionais" icon={<Filter className="h-4 w-4" />}>
        <form onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Field label="Situação">
            <Select
              value={status}
              onChange={(value) => { setStatus(value); setPage(1) }}
              placeholder="Todas"
              options={optionsOf(OCCURRENCE_STATUS_LABEL)}
            />
          </Field>

          <Field label="Natureza">
            <Select
              value={nature}
              onChange={(value) => { setNature(value); setPage(1) }}
              placeholder="Todas"
              options={optionsOf(NATURE_LABEL)}
            />
          </Field>

          <Field label="Prioridade">
            <Select
              value={priority}
              onChange={(value) => { setPriority(value); setPage(1) }}
              placeholder="Todas"
              options={optionsOf(PRIORITY_LABEL)}
            />
          </Field>

          <Field label="Busca">
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Protocolo, endereço ou descrição"
            />
          </Field>

          <FieldButton>
            <ActionButton tone="neutral" type="submit" className="w-full py-2">
              <Search className="h-4 w-4" />
              Buscar
            </ActionButton>
          </FieldButton>
        </form>
      </Panel>

      {list.loading && !list.data && <LoadingBlock label="Carregando ocorrências..." />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

      {list.data && list.data.items.length === 0 && (
        <EmptyState
          title="Nenhuma ocorrência encontrada"
          description="Ajuste os filtros ou registre um novo chamado."
          action={<ActionButton tone="primary" onClick={() => setCreating(true)}><Plus className="h-5 w-5" /> Nova ocorrência</ActionButton>}
        />
      )}

      {Boolean(list.data?.items.length) && (
        <section aria-label="Chamados registrados" className="min-w-0 border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-muted px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-ink">Chamados registrados</h2>
            <span className="text-xs tabular-nums text-ink-muted">{list.data?.total.toLocaleString("pt-BR")} registros · mais recentes primeiro</span>
          </header>
          <div aria-hidden className="label-caps hidden gap-4 border-b border-line px-5 py-3 text-ink-soft lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.8fr)_100px_160px_130px]">
            <span>Ocorrência</span><span>Local</span><span>Prioridade</span><span>Situação</span><span>Abertura</span>
          </div>
          <ul>
            {(list.data?.items ?? []).map((occurrence) => (
              <li key={occurrence.id} className="border-b border-line last:border-b-0">
                <OccurrenceRow occurrence={occurrence} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {list.data && (
        <Pagination page={list.data.page} perPage={list.data.per_page} total={list.data.total} onPage={setPage} />
      )}

      {creating && (
        <CreateOccurrenceModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); list.reload() }}
        />
      )}
    </Page>
  )
}

function OccurrenceRow({ occurrence }: { occurrence: Occurrence }) {
  return (
    <Link
      to={`/ocorrencias/${occurrence.id}`}
      className="relative grid min-w-0 grid-cols-2 items-center gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-accent-soft focus-visible:bg-accent-soft sm:px-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.8fr)_100px_160px_130px]"
    >
      <span
        aria-hidden
        className={`absolute inset-y-3 left-0 w-0.5 ${PRIORITY_TONE[occurrence.priority]}`}
      />
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <p className="font-mono text-sm font-semibold text-ink">{occurrence.protocol}</p>
        <p className="mt-1 text-sm text-ink-muted">{NATURE_LABEL[occurrence.nature]}</p>
      </div>
      <p className="col-span-2 min-w-0 text-sm leading-relaxed text-ink lg:col-span-1">{occurrence.address}</p>
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <span className="label-caps text-ink-soft lg:hidden">Prioridade</span>
        <span className={`label-caps inline-flex border border-current/25 px-2 py-0.5 ${PRIORITY_TEXT_TONE[occurrence.priority]}`}>
          {PRIORITY_LABEL[occurrence.priority]}
        </span>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <span className="label-caps text-ink-soft lg:hidden">Situação</span>
        <Badge tone={OCCURRENCE_STATUS_TONE[occurrence.status]}>
          {OCCURRENCE_STATUS_LABEL[occurrence.status]}
        </Badge>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-2 border-t border-line pt-3 text-xs tabular-nums text-ink-muted lg:col-span-1 lg:flex-col lg:items-start lg:gap-1 lg:border-0 lg:pt-0">
        <time dateTime={occurrence.opened_at}>{formatShort(occurrence.opened_at)}</time>
        <span className="text-ink-soft">{formatElapsed(occurrence.opened_at)}</span>
      </div>
    </Link>
  )
}

function CreateOccurrenceModal({ onClose, onCreated }: { onClose: () => void, onCreated: () => void }) {
  const unitList = useResource(() => units.list({ active: true }), [])
  const model = useResource(() => ai.model(), [])

  const [nature, setNature] = useState<string>("INCENDIO_EDIFICACAO")
  const [priority, setPriority] = useState<string>("ALTA")
  const [unitId, setUnitId] = useState("")
  const [address, setAddress] = useState("")
  const [addressFromMap, setAddressFromMap] = useState(false)
  const [latitude, setLatitude] = useState("-23.0264")
  const [longitude, setLongitude] = useState("-45.5551")
  const [description, setDescription] = useState("")
  const [callerName, setCallerName] = useState("")
  const [callerPhone, setCallerPhone] = useState("")

  const create = useMutation(occurrences.create)

  const stations = useMemo(() => stationsOf(unitList.data?.items), [unitList.data])

  const point = { latitude: Number(latitude), longitude: Number(longitude) }
  const pointValid =
    latitude.trim() !== "" && longitude.trim() !== ""
    && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)

  // The unit that answers a call is normally the one that can get there first,
  // so the form offers the nearest station instead of leaving the operator to
  // work it out from a dropdown of acronyms.
  const nearest = useMemo(
    () => (pointValid ? nearestTo(point, stations) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointValid, point.latitude, point.longitude, stations],
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const created = await create.run({
      nature: nature as OccurrenceNature,
      priority: priority as OccurrencePriority,
      description: description.trim(),
      address: address.trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      unit_id: unitId,
      caller_name: callerName.trim() || undefined,
      caller_phone: callerPhone.trim() || undefined,
    })

    if (created) onCreated()
  }

  return (
    <Modal title="Registrar ocorrência" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {create.error && <ErrorBox message={create.error} />}
        <ErrorDetails details={create.details} />

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Natureza" required>
            <Select value={nature} onChange={setNature} options={optionsOf(NATURE_LABEL)} />
          </Field>

          <Field label="Prioridade" required>
            <Select value={priority} onChange={setPriority} options={optionsOf(PRIORITY_LABEL)} />
          </Field>

          <Field label="Unidade responsável" required>
            <Select
              value={unitId}
              onChange={setUnitId}
              placeholder={unitList.loading ? "Carregando..." : "Selecione"}
              options={(unitList.data?.items ?? []).map((unit) => ({
                value: unit.id,
                label: `${unit.acronym} — ${unit.name}`,
              }))}
            />
          </Field>
        </div>

        <Field label="Endereço" required hint="Digite a rua e escolha na lista: o ponto vai para o mapa">
          <AddressSearch
            required
            value={address}
            onChange={(value) => { setAddress(value); setAddressFromMap(false) }}
            onPick={(place) => {
              setLatitude(place.latitude.toFixed(6))
              setLongitude(place.longitude.toFixed(6))
            }}
            placeholder="Rua Jacques Félix, 451, Centro, Taubaté"
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Latitude" required hint="Precisa cair dentro da malha de Taubaté">
            <TextInput required value={latitude} onChange={(event) => setLatitude(event.target.value)} />
          </Field>

          <Field label="Longitude" required>
            <TextInput required value={longitude} onChange={(event) => setLongitude(event.target.value)} />
          </Field>
        </div>

        {/* Typing coordinates blind is how an incident ends up in the middle of
            a field. The map shows where the point landed and where the stations
            are around it, and a click moves the point. */}
        <RouteMap
          route={null}
          coverage={model.data?.bounds ?? null}
          onPick={(pickedLatitude, pickedLongitude) => {
            setLatitude(pickedLatitude.toFixed(6))
            setLongitude(pickedLongitude.toFixed(6))
            // A click on the map fills the address too, unless the operator
            // already typed one of their own.
            if (address.trim() === "" || addressFromMap) {
              geo.reverse(pickedLatitude, pickedLongitude)
                .then((place) => {
                  if (place) { setAddress(place.label); setAddressFromMap(true) }
                })
                .catch(() => undefined)
            }
          }}
          pin={pointValid ? { ...point, label: "Local da ocorrência" } : null}
          stations={stations}
          selectedStationId={unitId}
          nearestStationId={nearest?.item.id ?? null}
          onStationSelect={setUnitId}
          className="h-[220px] w-full sm:h-[300px] lg:h-[340px]"
        />

        {nearest && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-accent/30 bg-accent-soft px-4 py-2 text-ink">
            <MapPin className="h-4 w-4 shrink-0 text-accent" />
            <span>
              Quartel mais próximo do local: <strong>{nearest.item.acronym}</strong> —{" "}
              {nearest.item.name}, a {formatDistance(nearest.meters)} em linha reta.
            </span>
            {nearest.item.id === unitId
              ? <span className="text-sm font-semibold text-accent">Já é a unidade responsável.</span>
              : (
                <button
                  type="button"
                  onClick={() => setUnitId(nearest.item.id)}
                  className="text-sm font-semibold text-accent underline underline-offset-2 hover:text-accent-strong"
                >
                  Definir como unidade responsável
                </button>
              )}
          </p>
        )}

        <Field label="Descrição" required hint="O que o solicitante relatou">
          <TextArea
            required
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Fogo em residência de dois andares, com vítimas no interior"
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome do solicitante">
            <TextInput value={callerName} onChange={(event) => setCallerName(event.target.value)} />
          </Field>

          <Field label="Telefone do solicitante">
            <TextInput
              value={callerPhone}
              onChange={(event) => setCallerPhone(event.target.value)}
              placeholder="12991110000"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <ActionButton tone="ghost" type="button" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton tone="primary" type="submit" disabled={create.submitting}>
            {create.submitting ? "Registrando..." : "Registrar ocorrência"}
          </ActionButton>
        </div>
      </form>
    </Modal>
  )
}

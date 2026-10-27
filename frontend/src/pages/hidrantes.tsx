/**
 * Water sources: hydrants, cisterns, reservoirs and intake points.
 *
 * The registry the crews keep up to date after each inspection. The incident
 * screen reads it to list the nearest working points, and the coverage map
 * can draw it. OpenStreetMap has no hydrants mapped in Taubaté, so this is the
 * only source.
 */

import { useMemo, useState } from "react"
import type { FormEvent } from "react"
import { Droplets, Pencil, Plus } from "lucide-react"

import { ai, units, waterSources } from "@/api/endpoints"
import { WATER_STATUS_LABEL, WATER_STATUS_TONE, WATER_TYPE_LABEL, optionsOf } from "@/api/labels"
import type { WaterSource, WaterSourceStatus } from "@/api/types"
import {
  ActionButton, Badge, Cell, ConfirmButton, Field, Modal, Page, PageHeader, Panel, Row, Select, StatBox, Table,
  TextArea, TextInput,
} from "@/components/layout/kit"
import { EmptyState, ErrorBox, ErrorDetails, LoadingBlock } from "@/components/layout/feedback"
import RouteMap from "@/components/mapa/route-map"
import { AddressSearch } from "@/components/occurrence/address-search"
import { useMutation, useResource } from "@/hooks/use-resource"
import { formatDate, toNumber } from "@/lib/format"
import { stationsOf } from "@/lib/geo"
import { ExportButton } from "@/components/layout/export-button"
import { waterReport } from "@/lib/report-builders"



/** An inspection older than a year is due again. */
const OVERDUE_MS = 365 * 86_400_000

export default function Hidrantes() {
  const [status, setStatus] = useState("")
  const [editing, setEditing] = useState<WaterSource | "new" | null>(null)

  const list = useResource(() => waterSources.list({ status: (status || undefined) as WaterSourceStatus | undefined }), [status])
  const all = useResource(() => waterSources.list(), [])
  const remove = useMutation((id: string) => waterSources.remove(id))
  // Read once: whether an inspection is overdue does not change while the page is open.
  const [now] = useState(() => Date.now())

  const counts = useMemo(() => {
    const items = all.data ?? []
    return {
      total: items.length,
      working: items.filter((item) => item.status === "OPERANTE").length,
      broken: items.filter((item) => item.status === "INOPERANTE").length,
      overdue: items.filter((item) => !item.last_inspection_at || now - new Date(item.last_inspection_at).getTime() > OVERDUE_MS).length,
    }
  }, [all.data, now])

  return (
    <Page>
      <PageHeader
        title="Pontos de água"
        subtitle="Hidrantes, cisternas e pontos de captação disponíveis às guarnições."
        actions={(
          <>
          <ExportButton title="pontos de água" description={`Todos os ${list.data?.length.toLocaleString("pt-BR") ?? "—"} pontos do filtro atual, com vazão e data da última inspeção.`}
            disabled={list.loading || Boolean(list.error) || !list.data?.length}
            createReport={() => waterReport(list.data ?? [], `Todos os resultados filtrados | Situação: ${WATER_STATUS_LABEL[status as WaterSourceStatus] ?? "Todas"}`)} />
          <ActionButton tone="primary" onClick={() => setEditing("new")}>
            <Plus className="h-5 w-5" />
            Novo ponto
          </ActionButton>
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBox icon={<Droplets className="h-4 w-4" />} label="Cadastrados" value={all.data ? counts.total : "—"} />
        <StatBox label="Operantes" value={all.data ? counts.working : "—"} tone="text-ok" />
        <StatBox label="Inoperantes" value={all.data ? counts.broken : "—"} tone="text-alert" />
        <StatBox label="Inspeção vencida" value={all.data ? counts.overdue : "—"} hint="Sem teste há mais de um ano" tone="text-warn" />
      </div>
      {all.error && <ErrorBox message={`Indicadores indisponíveis. ${all.error}`} onRetry={all.reload} />}

      <Panel
        title="Cadastro"
        actions={(
          <Select
            value={status}
            onChange={setStatus}
            placeholder="Todas as situações"
            options={optionsOf(WATER_STATUS_LABEL)}
            aria-label="Filtrar por situação"
          />
        )}
      >
        {remove.error && <ErrorBox message={remove.error} />}
        {list.loading && !list.data && <LoadingBlock />}
        {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
        {list.data && list.data.length === 0 && (
          <EmptyState title="Nenhum ponto de água" description="Cadastre hidrantes e cisternas para que o despacho mostre os mais próximos de cada ocorrência." />
        )}
        {list.data && list.data.length > 0 && (
          <Table headers={["Código", "Tipo", "Situação", "Endereço", "Vazão", "Última inspeção", "Unidade", "Ações"]}>
            {list.data.map((source) => {
              const overdue = !source.last_inspection_at || now - new Date(source.last_inspection_at).getTime() > OVERDUE_MS
              return (
                <Row key={source.id}>
                  <Cell className="whitespace-nowrap font-mono font-semibold">{source.code}</Cell>
                  <Cell>{WATER_TYPE_LABEL[source.type]}</Cell>
                  <Cell><Badge tone={WATER_STATUS_TONE[source.status]}>{WATER_STATUS_LABEL[source.status]}</Badge></Cell>
                  <Cell>{source.address}</Cell>
                  <Cell className="whitespace-nowrap tabular-nums">{source.flow_lpm !== null ? `${source.flow_lpm.toLocaleString("pt-BR")} L/min` : "—"}</Cell>
                  <Cell className={overdue ? "text-warn" : undefined}>{formatDate(source.last_inspection_at)}</Cell>
                  <Cell>{source.unit?.acronym ?? "—"}</Cell>
                  <Cell>
                    <div className="flex gap-1">
                      <ActionButton tone="ghost" className="px-2 py-1" onClick={() => setEditing(source)} aria-label={`Editar ${source.code}`}>
                        <Pencil className="h-4 w-4" />
                      </ActionButton>
                      <ConfirmButton
                        label="Excluir"
                        confirmLabel="Confirmar"
                        className="px-2 py-1 text-sm"
                        disabled={remove.submitting}
                        onConfirm={async () => {
                          await remove.run(source.id)
                          list.reload()
                          all.reload()
                        }}
                      />
                    </div>
                  </Cell>
                </Row>
              )
            })}
          </Table>
        )}
      </Panel>

      {editing && (
        <WaterSourceModal
          source={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); list.reload(); all.reload() }}
        />
      )}
    </Page>
  )
}

function WaterSourceModal({ source, onClose, onSaved }: {
  source: WaterSource | null
  onClose: () => void
  onSaved: () => void
}) {
  const unitList = useResource(() => units.list({ active: true }), [])
  const model = useResource(() => ai.model(), [])
  const stations = useMemo(() => stationsOf(unitList.data?.items), [unitList.data])

  const [type, setType] = useState<string>(source?.type ?? "HIDRANTE_COLUNA")
  const [status, setStatus] = useState<string>(source?.status ?? "NAO_VERIFICADO")
  const [address, setAddress] = useState(source?.address ?? "")
  const [latitude, setLatitude] = useState(source ? String(toNumber(source.latitude)) : "")
  const [longitude, setLongitude] = useState(source ? String(toNumber(source.longitude)) : "")
  const [flow, setFlow] = useState(source?.flow_lpm != null ? String(source.flow_lpm) : "")
  const [inspection, setInspection] = useState(source?.last_inspection_at ? source.last_inspection_at.slice(0, 10) : "")
  const [notes, setNotes] = useState(source?.notes ?? "")
  const [unitId, setUnitId] = useState(source?.unit_id ?? "")

  const save = useMutation(() => {
    const body = {
      type,
      status,
      address: address.trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      flow_lpm: flow !== "" ? Number(flow) : null,
      last_inspection_at: inspection ? new Date(`${inspection}T12:00:00`).toISOString() : null,
      notes: notes.trim() || null,
      unit_id: unitId,
    }
    return source ? waterSources.update(source.id, body) : waterSources.create(body)
  })

  const pointValid = latitude !== "" && longitude !== "" && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const saved = await save.run(undefined)
    if (saved) onSaved()
  }

  return (
    <Modal title={source ? `Editar ${source.code}` : "Novo ponto de água"} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {save.error && <ErrorBox message={save.error} />}
        <ErrorDetails details={save.details} />

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Tipo" required>
            <Select value={type} onChange={setType} options={optionsOf(WATER_TYPE_LABEL)} />
          </Field>
          <Field label="Situação" required>
            <Select value={status} onChange={setStatus} options={optionsOf(WATER_STATUS_LABEL)} />
          </Field>
          <Field label="Unidade responsável" required>
            <Select
              value={unitId}
              onChange={setUnitId}
              placeholder="Selecione"
              options={stations.map((station) => ({ value: station.id, label: `${station.acronym} — ${station.name}` }))}
            />
          </Field>
        </div>

        <Field label="Endereço" required>
          <AddressSearch
            required
            value={address}
            onChange={setAddress}
            onPick={(place) => { setLatitude(place.latitude.toFixed(6)); setLongitude(place.longitude.toFixed(6)) }}
            placeholder="Rua, número ou cruzamento"
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Latitude" required>
            <TextInput required value={latitude} onChange={(event) => setLatitude(event.target.value)} />
          </Field>
          <Field label="Longitude" required>
            <TextInput required value={longitude} onChange={(event) => setLongitude(event.target.value)} />
          </Field>
        </div>

        <RouteMap
          route={null}
          coverage={model.data?.bounds ?? null}
          onPick={(pickedLatitude, pickedLongitude) => {
            setLatitude(pickedLatitude.toFixed(6))
            setLongitude(pickedLongitude.toFixed(6))
          }}
          pin={pointValid ? { latitude: Number(latitude), longitude: Number(longitude), label: "Ponto de água" } : null}
          stations={stations}
          className="h-[220px] w-full sm:h-[280px]"
        />

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Vazão medida (L/min)">
            <TextInput type="number" min={0} max={20000} value={flow} onChange={(event) => setFlow(event.target.value)} />
          </Field>
          <Field label="Última inspeção">
            <TextInput type="date" value={inspection} onChange={(event) => setInspection(event.target.value)} />
          </Field>
        </div>

        <Field label="Observações">
          <TextArea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Acesso, rosca, pressão, obstruções..." />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <ActionButton tone="ghost" type="button" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton tone="primary" type="submit" disabled={save.submitting || !unitId || !pointValid}>
            {save.submitting ? "Salvando..." : "Salvar"}
          </ActionButton>
        </div>
      </form>
    </Modal>
  )
}

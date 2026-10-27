/**
 * The fleet.
 *
 * The status is what the dispatch screen reads to decide which vehicles can be
 * sent, so it is editable here — a truck that goes into maintenance has to
 * leave the available pool immediately.
 */

import { useState } from "react"
import { Car, Plus } from "lucide-react"
import type { FormEvent } from "react"
import { Link } from 'react-router-dom'

import { units, vehicles } from "@/api/endpoints"
import {
  VEHICLE_STATUS_LABEL, VEHICLE_STATUS_TONE, VEHICLE_TYPE_LABEL, optionsOf,
} from "@/api/labels"
import type { Vehicle, VehicleStatus, VehicleType } from "@/api/types"
import {
  ActionButton, Badge, Cell, ConfirmButton, Field, Modal, Page, PageHeader, Pagination,
  Panel, Row, Select, Table, TextInput,
} from "@/components/layout/kit"
import { EmptyState, ErrorBox, ErrorDetails, LoadingBlock } from "@/components/layout/feedback"
import { useMutation, useResource } from "@/hooks/use-resource"
import { PaginatedExport } from "@/components/layout/export-button"
import { vehicleReport } from "@/lib/report-builders"
import { FleetReplay } from '@/components/operational/fleet-replay'

export default function Viaturas() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("")
  const [type, setType] = useState("")
  const [creating, setCreating] = useState(false)

  const unitList = useResource(() => units.list({ active: true }), [])

  const list = useResource(
    () => vehicles.list({
      page,
      per_page: 15,
      status: (status || undefined) as VehicleStatus | undefined,
      type: (type || undefined) as VehicleType | undefined,
    }),
    [page, status, type],
  )

  return (
    <Page>
      <PageHeader
        title="Viaturas"
        subtitle="Frota e disponibilidade para despacho"
        actions={(
          <>
          <PaginatedExport title="viaturas" description="Relação da frota com disponibilidade, unidade e capacidade da guarnição."
            data={list.data} disabled={list.loading || Boolean(list.error)}
            fetchPage={(page, per_page) => vehicles.list({ page, per_page, status: (status || undefined) as VehicleStatus | undefined, type: (type || undefined) as VehicleType | undefined })}
            report={(rows, scope) => vehicleReport(rows, `${scope} | Situação: ${VEHICLE_STATUS_LABEL[status as VehicleStatus] ?? "Todas"} | Tipo: ${VEHICLE_TYPE_LABEL[type as VehicleType] ?? "Todos"}`)} />
          <ActionButton tone="primary" onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" />
            Nova viatura
          </ActionButton>
          </>
        )}
      />

      <Panel title="Filtros">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Situação">
            <Select
              value={status}
              onChange={(value) => { setStatus(value); setPage(1) }}
              placeholder="Todas"
              options={optionsOf(VEHICLE_STATUS_LABEL)}
            />
          </Field>

          <Field label="Tipo">
            <Select
              value={type}
              onChange={(value) => { setType(value); setPage(1) }}
              placeholder="Todos"
              options={optionsOf(VEHICLE_TYPE_LABEL)}
            />
          </Field>
        </div>
      </Panel>

      {list.loading && !list.data && <LoadingBlock />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && list.data.items.length === 0 && <EmptyState title="Nenhuma viatura encontrada" />}

      {list.data && list.data.items.length > 0 && (
        <Panel title="Frota" icon={<Car className="h-5 w-5" />}>
          <Table headers={[
            "Prefixo", "Tipo", "Placa", "Modelo", "Ano", "Guarnição", "Unidade", "Situação",
            "Ações",
          ]}>
            {list.data.items.map((vehicle) => (
              <VehicleRow key={vehicle.id} vehicle={vehicle} onChanged={list.reload} />
            ))}
          </Table>

          <Pagination page={list.data.page} perPage={list.data.per_page} total={list.data.total} onPage={setPage} />
        </Panel>
      )}

      <FleetReplay />

      {creating && (
        <CreateVehicleModal
          unitOptions={(unitList.data?.items ?? []).map((unit) => ({ value: unit.id, label: `${unit.acronym} — ${unit.name}` }))}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); list.reload() }}
        />
      )}
    </Page>
  )
}

function VehicleRow({ vehicle, onChanged }: {
  vehicle: Vehicle
  onChanged: () => void
}) {
  const update = useMutation((status: VehicleStatus) => vehicles.update(vehicle.id, { status }))
  const remove = useMutation(() => vehicles.remove(vehicle.id))

  // A committed vehicle is released by the dispatch flow, not by hand: letting
  // it be freed here would leave a crew attending an incident with no truck.
  const locked = vehicle.status === "EMPENHADA"

  async function handleStatus(next: string) {
    const updated = await update.run(next as VehicleStatus)
    if (updated) onChanged()
  }

  return (
    <Row>
      <Cell className="font-semibold">{vehicle.prefix}</Cell>
      <Cell title={VEHICLE_TYPE_LABEL[vehicle.type]}>{vehicle.type}</Cell>
      <Cell className="font-mono text-sm">{vehicle.plate}</Cell>
      <Cell>{vehicle.model}</Cell>
      <Cell>{vehicle.year}</Cell>
      <Cell>{vehicle.crew_capacity} lugares</Cell>
      <Cell>{vehicle.unit?.acronym ?? "—"}</Cell>
      <Cell>
        {locked ? (
          <Badge tone={VEHICLE_STATUS_TONE[vehicle.status]}>{VEHICLE_STATUS_LABEL[vehicle.status]}</Badge>
        ) : (
          <Select
            value={vehicle.status}
            onChange={handleStatus}
            disabled={update.submitting}
            options={optionsOf(VEHICLE_STATUS_LABEL).filter((option) => option.value !== "EMPENHADA")}
            className="py-1 text-sm"
          />
        )}
        {update.error && <span className="mt-1 block text-sm text-alert">{update.error}</span>}
      </Cell>

      <Cell>
        <Link to={`/garagem?vehicle=${encodeURIComponent(vehicle.id)}`} className="mr-3 inline-block py-2 text-sm font-semibold text-accent hover:underline">Ver em 3D</Link>
        <ConfirmButton
          label="Excluir"
          confirmLabel="Confirmar"
          className="px-2.5 py-1 text-sm"
          disabled={remove.submitting || locked}
          onConfirm={async () => {
            const done = await remove.run(undefined)
            if (done) onChanged()
          }}
        />
        {remove.error && <span className="mt-1 block max-w-xs text-sm text-alert">{remove.error}</span>}
      </Cell>
    </Row>
  )
}

function CreateVehicleModal({ unitOptions, onClose, onCreated }: {
  unitOptions: { value: string, label: string }[]
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    prefix: "", type: "ABT", plate: "", model: "",
    year: String(new Date().getFullYear()), water_capacity_liters: "",
    crew_capacity: "6", unit_id: "",
  })

  const create = useMutation(vehicles.create)
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const created = await create.run({
      prefix: form.prefix.trim(),
      type: form.type,
      plate: form.plate.trim().toUpperCase(),
      model: form.model.trim(),
      year: Number(form.year),
      crew_capacity: Number(form.crew_capacity),
      water_capacity_liters: form.water_capacity_liters ? Number(form.water_capacity_liters) : undefined,
      unit_id: form.unit_id,
    })

    if (created) onCreated()
  }

  return (
    <Modal title="Cadastrar viatura" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {create.error && <ErrorBox message={create.error} />}
        <ErrorDetails details={create.details} />

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Prefixo" required>
            <TextInput required value={form.prefix} onChange={(event) => set("prefix")(event.target.value)} placeholder="ABT-01" />
          </Field>

          <Field label="Tipo" required>
            <Select value={form.type} onChange={set("type")} options={optionsOf(VEHICLE_TYPE_LABEL)} />
          </Field>

          <Field label="Placa" required hint="Padrão antigo (ABC1234) ou Mercosul (ABC1D23)">
            <TextInput required value={form.plate} onChange={(event) => set("plate")(event.target.value)} placeholder="ABC1D23" />
          </Field>

          <Field label="Modelo" required>
            <TextInput required value={form.model} onChange={(event) => set("model")(event.target.value)} placeholder="Mercedes Atego" />
          </Field>

          <Field label="Ano" required>
            <TextInput type="number" required value={form.year} onChange={(event) => set("year")(event.target.value)} />
          </Field>

          <Field label="Lugares na guarnição" required>
            <TextInput type="number" min={1} required value={form.crew_capacity} onChange={(event) => set("crew_capacity")(event.target.value)} />
          </Field>

          <Field label="Capacidade de água (litros)" hint="Apenas para viaturas com tanque">
            <TextInput type="number" min={0} value={form.water_capacity_liters} onChange={(event) => set("water_capacity_liters")(event.target.value)} />
          </Field>

          <Field label="Unidade" required>
            <Select value={form.unit_id} onChange={set("unit_id")} placeholder="Selecione" options={unitOptions} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <ActionButton tone="ghost" type="button" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton tone="primary" type="submit" disabled={create.submitting}>
            {create.submitting ? "Salvando..." : "Cadastrar"}
          </ActionButton>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Duty roster: who is on shift and when.
 *
 * The backend rejects overlapping shifts for the same firefighter, so a
 * conflict here comes back as a 409 and is shown as-is — the message it sends
 * already names the problem.
 */

import { useState } from "react"
import type { FormEvent } from "react"
import { CalendarClock, Plus, Trash2 } from "lucide-react"

import { firefighters, shifts, units } from "@/api/endpoints"
import { RANK_LABEL, SHIFT_TYPE_LABEL, optionsOf } from "@/api/labels"
import type { ShiftType } from "@/api/types"
import {
  ActionButton, Cell, Field, Modal, Page, PageHeader, Pagination, Panel,
  Row, Select, Table, TextInput,
} from "@/components/layout/kit"
import { EmptyState, ErrorBox, ErrorDetails, LoadingBlock } from "@/components/layout/feedback"
import { useMutation, useResource } from "@/hooks/use-resource"
import { formatDateTime, toLocalInputValue } from "@/lib/format"
import { PaginatedExport } from "@/components/layout/export-button"
import { shiftReport } from "@/lib/report-builders"

export default function Turnos() {
  const [page, setPage] = useState(1)
  const [type, setType] = useState("")
  const [unitId, setUnitId] = useState("")
  const [creating, setCreating] = useState(false)

  const unitList = useResource(() => units.list({ active: true }), [])

  const list = useResource(
    () => shifts.list({
      page,
      per_page: 15,
      type: (type || undefined) as ShiftType | undefined,
      unit_id: unitId || undefined,
    }),
    [page, type, unitId],
  )

  return (
    <Page>
      <PageHeader
        title="Turnos"
        subtitle="Escala de serviço do efetivo"
        actions={(
          <>
          <PaginatedExport title="turnos" description="Escala de serviço com bombeiro, unidade e horários de início e término."
            data={list.data} disabled={list.loading || Boolean(list.error)}
            fetchPage={(page, per_page) => shifts.list({ page, per_page, type: (type || undefined) as ShiftType | undefined, unit_id: unitId || undefined })}
            report={(rows, scope) => shiftReport(rows, `${scope} | Tipo: ${SHIFT_TYPE_LABEL[type as ShiftType] ?? "Todos"} | Unidade: ${unitId ? unitList.data?.items.find((u) => u.id === unitId)?.acronym ?? unitId : "Todas"}`)} />
          <ActionButton tone="primary" onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" />
            Novo turno
          </ActionButton>
          </>
        )}
      />

      <Panel title="Filtros">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Tipo">
            <Select
              value={type}
              onChange={(value) => { setType(value); setPage(1) }}
              placeholder="Todos"
              options={optionsOf(SHIFT_TYPE_LABEL)}
            />
          </Field>

          <Field label="Unidade">
            <Select
              value={unitId}
              onChange={(value) => { setUnitId(value); setPage(1) }}
              placeholder="Todas"
              options={(unitList.data?.items ?? []).map((unit) => ({ value: unit.id, label: unit.acronym }))}
            />
          </Field>
        </div>
      </Panel>

      {list.loading && !list.data && <LoadingBlock />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && list.data.items.length === 0 && <EmptyState title="Nenhum turno cadastrado" />}

      {list.data && list.data.items.length > 0 && (
        <Panel title="Escala" icon={<CalendarClock className="h-5 w-5" />}>
          <Table headers={["Bombeiro", "Tipo", "Início", "Término", "Unidade", "Ações"]}>
            {list.data.items.map((shift) => (
              <ShiftRow key={shift.id} shift={shift} onChanged={list.reload} />
            ))}
          </Table>

          <Pagination page={list.data.page} perPage={list.data.per_page} total={list.data.total} onPage={setPage} />
        </Panel>
      )}

      {creating && (
        <CreateShiftModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); list.reload() }}
        />
      )}
    </Page>
  )
}

function ShiftRow({ shift, onChanged }: {
  shift: import("@/api/types").Shift

  onChanged: () => void
}) {
  const remove = useMutation(() => shifts.remove(shift.id))

  async function handleRemove() {
    const done = await remove.run(undefined)
    if (done) onChanged()
  }

  return (
    <Row>
      <Cell className="font-semibold">
        {shift.firefighter
          ? `${RANK_LABEL[shift.firefighter.rank]} ${shift.firefighter.war_name}`
          : "—"}
      </Cell>
      <Cell>{SHIFT_TYPE_LABEL[shift.type]}</Cell>
      <Cell className="whitespace-nowrap">{formatDateTime(shift.start_at)}</Cell>
      <Cell className="whitespace-nowrap">{formatDateTime(shift.end_at)}</Cell>
      <Cell>{shift.unit?.acronym ?? "—"}</Cell>

      <Cell>
        <ActionButton
          tone="ghost"
          className="px-2 py-1 text-sm"
          disabled={remove.submitting}
          onClick={handleRemove}
        >
          <Trash2 className="h-4 w-4" />
          Excluir
        </ActionButton>
        {remove.error && <span className="mt-1 block text-sm text-alert">{remove.error}</span>}
      </Cell>
    </Row>
  )
}

function CreateShiftModal({ onClose, onCreated }: { onClose: () => void, onCreated: () => void }) {
  const unitList = useResource(() => units.list({ active: true }), [])
  const [unitId, setUnitId] = useState("")

  const roster = useResource(
    () => firefighters.list({ unit_id: unitId, status: "ATIVO", per_page: 100 }),
    [unitId],
    { enabled: Boolean(unitId) },
  )

  const now = new Date()
  const [type, setType] = useState<string>("PLANTAO_24X72")
  const [firefighterId, setFirefighterId] = useState("")
  const [startAt, setStartAt] = useState(toLocalInputValue(now))
  const [endAt, setEndAt] = useState(toLocalInputValue(new Date(now.getTime() + 24 * 3600 * 1000)))

  const create = useMutation(shifts.create)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const created = await create.run({
      type,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      firefighter_id: firefighterId,
      unit_id: unitId,
    })

    if (created) onCreated()
  }

  return (
    <Modal title="Cadastrar turno" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {create.error && <ErrorBox message={create.error} />}
        <ErrorDetails details={create.details} />

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Unidade" required>
            <Select
              value={unitId}
              onChange={(value) => { setUnitId(value); setFirefighterId("") }}
              placeholder={unitList.loading ? "Carregando..." : "Selecione"}
              options={(unitList.data?.items ?? []).map((unit) => ({ value: unit.id, label: `${unit.acronym} — ${unit.name}` }))}
            />
          </Field>

          <Field label="Bombeiro" required>
            <Select
              value={firefighterId}
              onChange={setFirefighterId}
              disabled={!unitId}
              placeholder={unitId ? "Selecione" : "Escolha a unidade primeiro"}
              options={(roster.data?.items ?? []).map((firefighter) => ({
                value: firefighter.id,
                label: `${RANK_LABEL[firefighter.rank]} ${firefighter.war_name}`,
              }))}
            />
          </Field>

          <Field label="Tipo de escala" required>
            <Select value={type} onChange={setType} options={optionsOf(SHIFT_TYPE_LABEL)} />
          </Field>

          <div />

          <Field label="Início" required>
            <TextInput type="datetime-local" required value={startAt} onChange={(event) => setStartAt(event.target.value)} />
          </Field>

          <Field label="Término" required hint="O backend recusa turnos sobrepostos para o mesmo bombeiro">
            <TextInput type="datetime-local" required value={endAt} onChange={(event) => setEndAt(event.target.value)} />
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

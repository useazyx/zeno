/**
 * Every dispatch in one board, with the status transitions the backend allows.
 *
 * The backend refuses a jump that skips a step (a crew cannot finish without
 * arriving), so the buttons offered here are exactly the ones it will accept.
 */

import { useCallback, useState } from "react"
import { Filter, Truck } from "lucide-react"
import { Link } from "react-router-dom"

import { dispatches } from "@/api/endpoints"
import {
  DISPATCH_NEXT_STATUSES, DISPATCH_STATUS_LABEL, DISPATCH_STATUS_TONE,
  NATURE_LABEL, PRIORITY_LABEL, PRIORITY_TEXT_TONE, VEHICLE_TYPE_LABEL, optionsOf,
} from "@/api/labels"
import type { Dispatch, DispatchStatus } from "@/api/types"
import {
  ActionButton, Badge, Cell, Field, Page, PageHeader, Pagination, Panel, Row, Select, Table,
} from "@/components/layout/kit"
import { EmptyState, ErrorBox, LoadingBlock } from "@/components/layout/feedback"
import { useRealtime } from "@/hooks/use-realtime"
import { useMutation, useResource } from "@/hooks/use-resource"
import { formatDateTime, formatDistance, formatDuration } from "@/lib/format"

const PER_PAGE = 15

export default function Despachos() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("")
  const [onlyOpen, setOnlyOpen] = useState("true")

  const list = useResource(
    () => dispatches.list({
      page,
      per_page: PER_PAGE,
      status: (status || undefined) as DispatchStatus | undefined,
      open: onlyOpen === "true" ? true : undefined,
    }),
    [page, status, onlyOpen],
  )

  const reload = list.reload

  useRealtime(useCallback((event) => {
    if (event.type === "dispatch.created" || event.type === "dispatch.updated") reload()
  }, [reload]))

  return (
    <Page>
      <PageHeader title="Despachos" subtitle="Viaturas empenhadas e o andamento de cada atendimento" />

      <Panel title="Filtros" icon={<Filter className="h-5 w-5" />}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Situação">
            <Select
              value={status}
              onChange={(value) => { setStatus(value); setPage(1) }}
              placeholder="Todas"
              options={optionsOf(DISPATCH_STATUS_LABEL)}
            />
          </Field>

          <Field label="Exibir">
            <Select
              value={onlyOpen}
              onChange={(value) => { setOnlyOpen(value); setPage(1) }}
              options={[
                { value: "true", label: "Somente em andamento" },
                { value: "false", label: "Todos os despachos" },
              ]}
            />
          </Field>
        </div>
      </Panel>

      {list.loading && !list.data && <LoadingBlock label="Carregando despachos..." />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

      {list.data && list.data.items.length === 0 && (
        <EmptyState
          title="Nenhum despacho"
          description="Despachos aparecem aqui assim que uma viatura for enviada a uma ocorrência."
        />
      )}

      {list.data && list.data.items.length > 0 && (
        <Panel title="Despachos" icon={<Truck className="h-5 w-5" />}>
          <Table headers={["Viatura", "Ocorrência", "Situação", "Despachado em", "Rota utilizada", "Ações"]}>
            {list.data.items.map((dispatch) => (
              <DispatchRow key={dispatch.id} dispatch={dispatch} onChanged={list.reload} />
            ))}
          </Table>

          <Pagination page={list.data.page} perPage={list.data.per_page} total={list.data.total} onPage={setPage} />
        </Panel>
      )}
    </Page>
  )
}

function DispatchRow({ dispatch, onChanged }: { dispatch: Dispatch, onChanged: () => void }) {
  const advance = useMutation((status: DispatchStatus) => dispatches.updateStatus(dispatch.id, status))
  const next = DISPATCH_NEXT_STATUSES[dispatch.status]
  const neural = dispatch.routes?.find((route) => route.algorithm === "NEURAL")
  const critical = dispatch.routes?.find((route) => route.algorithm === "CRITICAL")
  const usedRoute = dispatch.used_route
    ?? dispatch.routes?.find((route) => route.id === dispatch.used_route_id)
    ?? (dispatch.critical_mode ? critical : neural)

  async function handleAdvance(status: DispatchStatus) {
    const updated = await advance.run(status)
    if (updated) onChanged()
  }

  return (
    <Row>
      <Cell>
        <span className="font-semibold">{dispatch.vehicle?.prefix ?? "—"}</span>
        {dispatch.vehicle && (
          <span className="block text-sm text-ink-muted">{VEHICLE_TYPE_LABEL[dispatch.vehicle.type]}</span>
        )}
      </Cell>

      <Cell>
        {dispatch.occurrence ? (
          <Link to={`/ocorrencias/${dispatch.occurrence.id}`} className="font-semibold text-accent hover:underline">
            {dispatch.occurrence.protocol}
          </Link>
        ) : "—"}
        {dispatch.occurrence && (
          <>
            <span className="block text-sm text-ink-muted">{NATURE_LABEL[dispatch.occurrence.nature]}</span>
            <span className={`block text-sm font-semibold ${PRIORITY_TEXT_TONE[dispatch.occurrence.priority]}`}>
              {PRIORITY_LABEL[dispatch.occurrence.priority]}
            </span>
          </>
        )}
      </Cell>

      <Cell>
        <Badge tone={DISPATCH_STATUS_TONE[dispatch.status]}>{DISPATCH_STATUS_LABEL[dispatch.status]}</Badge>
        {advance.error && <span className="mt-1 block text-sm text-alert">{advance.error}</span>}
      </Cell>

      <Cell className="whitespace-nowrap">{formatDateTime(dispatch.dispatched_at)}</Cell>

      <Cell className="whitespace-nowrap">
        {usedRoute ? (
          <>
            <span className="font-semibold">
              {usedRoute.algorithm === "CRITICAL"
                ? "Modo crítico"
                : usedRoute.algorithm === "NEURAL"
                  ? "IA"
                  : "Rota padrão"}
            </span>
            <span className="block text-sm text-ink-muted">
              {formatDuration(usedRoute.estimated_time_seconds)} · {formatDistance(usedRoute.distance_meters)}
            </span>
          </>
        ) : <span className="text-ink-soft">sem rota</span>}
      </Cell>

      <Cell>
        <div className="flex flex-wrap gap-1.5">
          {next.map((status) => (
            <ActionButton
              key={status}
              tone={status === "CANCELADO" ? "ghost" : "neutral"}
              className="px-2.5 py-1 text-sm"
              disabled={advance.submitting}
              onClick={() => handleAdvance(status)}
            >
              {DISPATCH_STATUS_LABEL[status]}
            </ActionButton>
          ))}
          {next.length === 0 && <span className="text-sm text-ink-soft">encerrado</span>}
        </div>
      </Cell>
    </Row>
  )
}

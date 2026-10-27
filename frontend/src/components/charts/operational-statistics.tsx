import { useState } from "react"
import { Link } from "react-router-dom"
import { Building2, Route, Users } from "lucide-react"
import type { OperationalStatistics, OccurrenceNature } from "@/api/types"
import { NATURE_LABEL, DISPATCH_STATUS_LABEL } from "@/api/labels"
import { occurrences } from "@/api/endpoints"
import { useResource } from "@/hooks/use-resource"
import { ErrorBox } from "@/components/layout/feedback"
import { Panel, Select } from "@/components/layout/kit"
import { formatDistance, formatDuration } from "@/lib/format"
import { Ranking } from "./distribution-charts"
import "./operational-statistics.css"

const algorithm: Record<string, string> = { NEURAL: "IA", DIJKSTRA: "Padrão", CRITICAL: "Modo crítico" }
const duration = (value: number | null) => value === null ? "Sem registro" : formatDuration(value)
const number = (value: number) => value.toLocaleString("pt-BR")

export function OperationalAnalysis({ data, filters }: { data: OperationalStatistics; filters: Parameters<typeof occurrences.operationalRecords>[0] }) {
  const [unitId, setUnitId] = useState("")
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState("")
  const [recorded, setRecorded] = useState("")
  const [page, setPage] = useState(0)
  const selected = data.units.find((unit) => unit.id === unitId)
  const scoped = selected ? [selected] : data.units
  const sum = (key: "deployments" | "recorded_routes" | "distance_meters" | "critical") => scoped.reduce((n, unit) => n + unit[key], 0)
  const deployments = sum("deployments")
  const routes = sum("recorded_routes")
  const records = useResource(() => occurrences.operationalRecords({ ...filters, unit_id: selected?.id, search: query || undefined, route_recorded: (recorded || undefined) as "yes" | "no" | undefined, page: page + 1 }),
    [filters.from, filters.to, filters.status, filters.nature, filters.priority, selected?.id, query, recorded, page])
  const ledger = records.loading ? [] : records.data?.items ?? []
  const lastPage = Math.max(0, Math.ceil((records.data?.total ?? 0) / 10) - 1)
  const currentPage = page
  const natureCounts = new Map<string, number>()
  scoped.forEach((unit) => unit.natures.forEach((entry) => natureCounts.set(entry.nature, (natureCounts.get(entry.nature) ?? 0) + entry.count)))

  return <div className="operational-analysis">
    <Panel title="Atuação dos postos de bombeiros" icon={<Building2 className="h-5 w-5" />}>
      <div className="operations-intro">
        <p>Participação registrada nos despachos. Uma ocorrência pode mobilizar vários postos e várias viaturas.</p>
        <label>Detalhar posto<Select value={unitId} onChange={(id) => { setUnitId(id); setPage(0) }} placeholder="Todos os postos" options={data.units.map((unit) => ({ value: unit.id, label: unit.acronym }))} /></label>
      </div>
      <div className="operations-kpis">
        <Metric label="Ocorrências com mobilização" value={number(selected?.incidents ?? data.dispatched_incidents)} note="Sem duplicar viaturas da mesma ocorrência" />
        <Metric label="Operações conjuntas" value={number(selected?.joint_operations ?? data.joint_operations)} note="Dois ou mais postos mobilizados" />
        <Metric label="Despachos" value={number(deployments)} note={`${number(sum("critical"))} em modo crítico · cancelados excluídos`} />
        <Metric label="Rotas adotadas registradas" value={`${deployments ? Math.round(routes / deployments * 100) : 0}%`} note={`${number(routes)} de ${number(deployments)} despachos`} />
      </div>
      <div className="operations-table-wrap" tabIndex={0} role="region" aria-label="Comparação dos postos, tabela com rolagem horizontal">
        <table className="operations-table">
          <caption>Responsabilidade, mobilização e resposta por posto</caption>
          <thead><tr><th scope="col">Posto</th><th scope="col">Responsável</th><th scope="col">Mobilizações</th><th scope="col">Chegadas</th><th scope="col">Viaturas</th><th scope="col">Resposta média</th><th scope="col">P90 da resposta</th><th scope="col">Rotas registradas</th></tr></thead>
          <tbody>{data.units.map((unit) => <tr key={unit.id} data-selected={unit.id === selected?.id}>
            <th scope="row"><button type="button" aria-pressed={unit.id === selected?.id} onClick={() => { setUnitId(unit.id === selected?.id ? "" : unit.id); setPage(0) }}>{unit.acronym}</button><small>{number(unit.incidents)} ocorrências · {number(unit.joint_operations)} conjuntas</small></th>
            <td>{number(unit.responsible)}</td><td>{number(unit.deployments)}<small>{number(unit.cancelled)} cancelados</small></td><td>{number(unit.arrived)}</td><td>{number(unit.vehicles)}</td>
            <td>{duration(unit.response_seconds)}<small>{number(unit.response_samples)} registros</small></td><td>{duration(unit.response_p90_seconds)}</td>
            <td><span className="operations-ratio"><span style={{ width: `${unit.deployments ? unit.recorded_routes / unit.deployments * 100 : 0}%` }} /></span>{number(unit.recorded_routes)} / {number(unit.deployments)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="operations-note">Responsável é o posto vinculado à ocorrência; mobilização é um despacho não cancelado. Resposta: abertura até chegada de cada viatura. P90: tempo dentro do qual ocorreram 90% das chegadas registradas. Postos das viaturas refletem a lotação atual do cadastro.</p>
      {selected && <div className="operations-kpis operations-detail">
        <Metric label="Deslocamento médio" value={duration(selected.travel_seconds)} note="Despacho até chegada" />
        <Metric label="Empenho médio" value={duration(selected.commitment_seconds)} note={`${number(selected.commitment_samples)} despachos com término válido`} />
        <Metric label="Guarnições mobilizadas" value={number(selected.crews)} note={`${number(selected.vehicles)} viaturas distintas`} />
        <Metric label="Percursos registrados" value={formatDistance(selected.distance_meters)} note="Soma das rotas adotadas; distância planejada" />
      </div>}
    </Panel>
    <div className="operations-grid">
      <Panel title={selected ? `Naturezas · ${selected.acronym}` : "Participação dos postos por natureza"} icon={<Building2 className="h-5 w-5" />}>
        <Ranking items={[...natureCounts].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, label: NATURE_LABEL[key as OccurrenceNature] ?? key, value }))} emptyMessage="Nenhuma mobilização no recorte." unit="participações" />
        <p className="operations-note">Cada posto conta uma vez por ocorrência. Na visão geral, uma operação conjunta contribui para mais de um posto.</p>
      </Panel>
      <Panel title="Cooperação entre postos" icon={<Users className="h-5 w-5" />}>
        <Ranking items={data.cooperation.filter((entry) => !selected || entry.units.includes(selected.acronym)).map((entry) => ({ key: entry.units.join("|"), label: entry.units.join(" + "), value: entry.incidents }))} emptyMessage="Nenhuma operação conjunta registrada neste recorte." unit="operações conjuntas" />
        <p className="operations-note">Pares de postos com despachos na mesma ocorrência. Participação não implica chegada simultânea.</p>
      </Panel>
    </div>
    <Panel title="Registro operacional de rotas" icon={<Route className="h-5 w-5" />}>
      <div className="operations-route-summary">
        {Object.entries(algorithm).map(([key, label]) => {
          const count = scoped.reduce((n, unit) => n + (unit.algorithms[key] ?? 0), 0)
          return <div key={key} data-algorithm={key}><span>{label}</span><strong>{number(count)}</strong><span className="operations-ratio"><span style={{ width: `${routes ? count / routes * 100 : 0}%` }} /></span><small>{routes ? Math.round(count / routes * 100) : 0}% das rotas registradas</small></div>
        })}
        <div><span>Sem rota adotada registrada</span><strong>{number(deployments - routes)}</strong><small>Ausência de registro não significa ausência de deslocamento.</small></div>
      </div>
      <div className="operations-intro"><p>Consulte todos os despachos do recorte, incluindo cancelados, do mais recente ao mais antigo.</p>
        <label>Registro de rota<Select value={recorded} onChange={(value) => { setRecorded(value); setPage(0) }} placeholder="Todos" options={[{ value: "yes", label: "Com rota adotada" }, { value: "no", label: "Sem rota registrada" }]} /></label>
        <form className="operations-search" onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); setPage(0) }}><label>Buscar no histórico<input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={100} placeholder="Protocolo, viatura ou posto" type="search" /></label><button type="submit">Buscar</button></form></div>
      {records.error && <ErrorBox message={records.error} onRetry={records.reload} />}
      <div className="operations-table-wrap" tabIndex={0} role="region" aria-label="Registro dos despachos e rotas">
        <table className="operations-table operations-ledger">
          <caption>Rotas escolhidas para os despachos · {selected?.acronym ?? "todos os postos"}</caption>
          <thead><tr><th scope="col">Ocorrência / despacho</th><th scope="col">Postos e viatura</th><th scope="col">Rota adotada</th><th scope="col">Estimado / realizado</th><th scope="col">Situação</th></tr></thead>
          <tbody>{ledger.map((row) => <tr key={row.id}>
            <th scope="row"><Link to={`/ocorrencias/${row.occurrence_id}`}>{row.protocol}</Link><small>{new Date(row.dispatched_at).toLocaleString("pt-BR")}</small><small>{NATURE_LABEL[row.nature as OccurrenceNature] ?? row.nature}</small></th>
            <td><strong>{row.unit} · {row.vehicle}</strong><small>Participantes: {row.participants.join(", ") || "Sem mobilização ativa"}</small></td>
            <td>{row.route ? <><strong>{algorithm[row.route.algorithm] ?? row.route.algorithm} · {formatDistance(row.route.distance_meters)}</strong><small title={row.route.id}>Registro {row.route.id.slice(0, 8)} · modelo {row.route.model_version ?? "não informado"}</small></> : "Não registrada"}</td>
            <td>{row.route ? duration(row.route.estimated_time_seconds) : "—"}<small>Realizado: {duration(row.travel_seconds)}</small></td>
            <td>{DISPATCH_STATUS_LABEL[row.status as keyof typeof DISPATCH_STATUS_LABEL] ?? row.status}<small>{row.critical_mode ? "Despacho crítico" : "Despacho regular"}</small></td>
          </tr>)}</tbody>
        </table>
        {!ledger.length && <p className="operations-empty" role="status">{records.loading ? "Consultando despachos…" : "Nenhum despacho encontrado para esta seleção."}</p>}
      </div>
      <div className="operations-pagination"><span>{number(records.data?.total ?? 0)} registros encontrados · página {currentPage + 1} de {lastPage + 1}</span><button disabled={records.loading || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><button disabled={records.loading || currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>Próxima</button></div>
      <p className="operations-note">Rota adotada é somente a selecionada e salva no despacho. Alternativas calculadas não entram nestes indicadores. Abra a ocorrência para consultar o traçado e os registros completos. {number(data.without_dispatch)} ocorrências do recorte não têm despacho não cancelado.</p>
    </Panel>
  </div>
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

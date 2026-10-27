import { useMemo, useState } from 'react'
import { occurrences, units, vehicles } from '@/api/endpoints'
import { useResource } from '@/hooks/use-resource'
import { ErrorBox, LoadingBlock } from '@/components/layout/feedback'
import IncidentMap, { type IncidentMapMode, type IncidentPoint } from '@/components/mapa/incident-map'
import type { LiveVehicle } from '@/components/mapa/map/vehicle-markers'
import { stationsOf } from '@/lib/geo'
import { historicalPosition, historyTrails, orderedPositions } from './operation-state'
import { ReplayControls } from './replay-controls'
import { useReplayClock } from './use-replay-clock'
import './operational.css'

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function FleetReplay() {
  const [date, setDate] = useState(today)
  const [enabled, setEnabled] = useState(false)
  return <section className="op-replay" aria-label="Replay da frota">
    <div className="op-replay-header"><div><h2 className="font-semibold">O dia em 60 segundos</h2><p>Reprodução das posições registradas e das ocorrências abertas no dia.</p></div>
      <div className="op-replay-actions"><label>Dia <input type="date" value={date} max={today()} onChange={(event) => { if (event.target.value) setDate(event.target.value) }} /></label><button type="button" onClick={() => setEnabled((value) => !value)}>{enabled ? 'Fechar replay' : 'Abrir replay'}</button></div>
    </div>
    {enabled && <FleetDay key={date} date={date} />}
  </section>
}

function FleetDay({ date }: { date: string }) {
  const start = new Date(`${date}T00:00:00`).getTime()
  const end = new Date(`${date}T23:59:59.999`).getTime()
  const history = useResource(() => vehicles.history(new Date(start).toISOString(), new Date(end).toISOString()), [date])
  const calls = useResource(() => occurrences.statistics({ from: new Date(start).toISOString(), to: new Date(end).toISOString() }), [date])
  const fleet = useResource(() => vehicles.list({ per_page: 100 }), [])
  const posts = useResource(() => units.list({ active: true }), [])
  const [mode, setMode] = useState<IncidentMapMode>('points')
  const clock = useReplayClock(start, end)
  const groups = useMemo(() => (history.data?.vehicles ?? []).map((group) => ({ ...group, positions: orderedPositions(group.positions) })), [history.data])
  const trails = useMemo(() => historyTrails(groups, clock.at, 30 * 60000), [groups, clock.at])
  const moving = useMemo<LiveVehicle[]>(() => groups.flatMap((group) => {
    const point = historicalPosition(group.positions, clock.at)
    if (!point) return []
    const vehicle = fleet.data?.items.find((item) => item.id === group.vehicle_id)
    return [{ id: group.vehicle_id, prefix: vehicle?.prefix ?? `Viatura ${group.vehicle_id.slice(0, 8)}`, status: point.dispatch_id ? 'EMPENHADA' : 'HISTORICO', latitude: Number(point.latitude), longitude: Number(point.longitude), recorded_at: point.recorded_at, heading: point.heading }]
  }), [groups, clock.at, fleet.data])
  const incidents = useMemo<IncidentPoint[]>(() => (calls.data?.items ?? []).filter((call) => Date.parse(call.opened_at) <= clock.at).flatMap((call) => {
    const latitude = Number(call.latitude), longitude = Number(call.longitude)
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? [{ id: call.id, protocol: call.protocol, nature: call.nature, priority: call.priority, address: call.address, openedAt: call.opened_at, latitude, longitude, unitLabel: call.unit?.acronym ?? 'Sem unidade', unitColor: '#50788b' }] : []
  }), [calls.data, clock.at])
  const stations = useMemo(() => stationsOf(posts.data?.items), [posts.data])
  return <>
    {history.loading && <LoadingBlock label="Buscando histórico de posições…" />}
    {history.error && <ErrorBox message={history.error} onRetry={history.reload} />}
    {calls.error && <ErrorBox message={`Ocorrências: ${calls.error}`} onRetry={calls.reload} />}
    {fleet.error && <ErrorBox message={`Identificação da frota: ${fleet.error}`} onRetry={fleet.reload} />}
    {history.data && <>
      <ReplayControls clock={clock} />
      <p>HISTÓRICO · {history.data.total.toLocaleString('pt-BR')} posições registradas · {groups.length} viaturas.{history.data.sampled ? ' Resposta amostrada pelo servidor; parte dos registros foi omitida.' : ''} Lacunas permanecem visíveis. O status atual da frota não é usado no passado.</p>
      {!groups.length && <p role="status">Nenhuma posição registrada neste dia. As ocorrências continuam disponíveis na linha do tempo.</p>}
      <IncidentMap incidents={incidents} stations={stations} vehicles={moving} mode={mode} onModeChange={setMode} operational historicalAt={clock.at} replayTrails={trails} className="h-[420px] w-full" />
    </>}
  </>
}

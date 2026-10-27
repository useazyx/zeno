import { useMemo, useState } from 'react'
import { vehicles } from '@/api/endpoints'
import type { Occurrence } from '@/api/types'
import { ErrorBox } from '@/components/layout/feedback'
import IncidentMap, { type IncidentMapMode, type IncidentPoint } from '@/components/mapa/incident-map'
import type { LiveVehicle } from '@/components/mapa/map/vehicle-markers'
import type { MapStation } from '@/components/mapa/route-map'
import { TimelinePanel } from '@/components/occurrence/timeline-panel'
import { useResource } from '@/hooks/use-resource'
import type { useTimeline } from '@/hooks/use-timeline'
import { historicalPosition, historyTrails, orderedPositions } from './operation-state'
import { ReplayControls } from './replay-controls'
import { useReplayClock } from './use-replay-clock'
import './operational.css'

interface Props { occurrence: Occurrence; timeline: ReturnType<typeof useTimeline>; stations: MapStation[] }

export function OccurrenceReplay(props: Props) {
  const [enabled, setEnabled] = useState(false)
  const closed = props.occurrence.status === 'ENCERRADA' || props.occurrence.status === 'CANCELADA'
  return <section className="op-replay">
    <div className="op-replay-header"><h2 className="font-semibold">Histórico do atendimento</h2><button type="button" className="border border-line px-3 py-2 text-sm" onClick={() => setEnabled((value) => !value)}>{enabled ? 'Voltar à linha do tempo' : 'Reproduzir ocorrência inteira'}</button></div>
    {enabled ? <HistoricalOccurrence {...props} /> : <TimelinePanel occurrenceId={props.occurrence.id} closed={closed} timeline={props.timeline} />}
  </section>
}

function HistoricalOccurrence({ occurrence, timeline, stations }: Props) {
  const start = Date.parse(occurrence.opened_at)
  const [end] = useState(() => Math.max(start, Date.parse(occurrence.closed_at ?? '') || Date.now()))
  const clock = useReplayClock(start, end)
  const [mode, setMode] = useState<IncidentMapMode>('points')
  const day = new Date(clock.at).toISOString().slice(0, 10)
  const vehicleIds = [...new Set((occurrence.dispatches ?? []).map((dispatch) => dispatch.vehicle_id))].sort().join(',')
  const history = useResource(async () => {
    const from = new Date(`${day}T00:00:00.000Z`).toISOString()
    const to = new Date(`${day}T23:59:59.999Z`).toISOString()
    const groups = await Promise.all(vehicleIds.split(',').filter(Boolean).map(async (id) => {
      const response = await vehicles.positions(id, from, to)
      return { vehicle_id: id, sampled: response.sampled, positions: orderedPositions(response.positions.filter((point) => occurrence.dispatches?.some((dispatch) => dispatch.id === point.dispatch_id))) }
    }))
    return { day, groups }
  }, [occurrence.id, day, vehicleIds])
  const groups = useMemo(() => history.data?.day === day ? history.data.groups : [], [history.data, day])
  const moving = useMemo<LiveVehicle[]>(() => groups.flatMap((group) => {
    const point = historicalPosition(group.positions, clock.at)
    if (!point) return []
    const dispatch = occurrence.dispatches?.find((item) => item.id === point.dispatch_id)
    return [{ id: group.vehicle_id, prefix: dispatch?.vehicle?.prefix ?? group.vehicle_id.slice(0, 8), status: 'EMPENHADA', latitude: Number(point.latitude), longitude: Number(point.longitude), heading: point.heading, recorded_at: point.recorded_at, arrived_at: dispatch?.arrived_at && Date.parse(dispatch.arrived_at) <= clock.at ? dispatch.arrived_at : null }]
  }), [groups, occurrence.dispatches, clock.at])
  const trails = useMemo(() => historyTrails(groups, clock.at, 10 * 60000), [groups, clock.at])
  const incidents = useMemo<IncidentPoint[]>(() => [{ id: occurrence.id, protocol: occurrence.protocol, address: occurrence.address, nature: occurrence.nature, priority: occurrence.priority, openedAt: occurrence.opened_at, latitude: Number(occurrence.latitude), longitude: Number(occurrence.longitude), unitLabel: occurrence.unit?.acronym ?? 'Sem unidade', unitColor: '#427e89' }].filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)), [occurrence])
  return <>
    <ReplayControls clock={clock} />
    <p>HISTÓRICO · eventos e posições gravados. O mapa não reconstrói deslocamentos sem GPS.{history.loading ? ' Carregando posições deste dia…' : !groups.some((group) => group.positions.length) ? ' Nenhuma posição registrada neste dia para os despachos desta ocorrência.' : ''}{groups.some((group) => group.sampled) ? ' Histórico amostrado pelo servidor.' : ''}</p>
    {history.error && <ErrorBox message={history.error} onRetry={history.reload} />}
    <IncidentMap incidents={incidents} stations={stations} vehicles={moving} historicalAt={clock.at} replayTrails={trails} operational mode={mode} onModeChange={setMode} className="h-[360px] w-full" />
    <TimelinePanel occurrenceId={occurrence.id} closed timeline={timeline} replayAt={clock.at} onReplaySeek={clock.seek} />
  </>
}

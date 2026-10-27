import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { occurrences } from '@/api/endpoints'
import { useResource } from '@/hooks/use-resource'
import { useRealtime } from '@/hooks/use-realtime'
import { useTimeline } from '@/hooks/use-timeline'
import { ageLabel, dispatchEstimate, occurrenceStages } from './operation-state'
import { useOperationClock } from './use-operation-clock'
import { useVehicleAlerts } from './use-vehicle-alerts'
import './operational.css'

export function ActiveOccurrenceIsland() {
  const [selected, setSelected] = useState(0)
  const list = useResource(async () => {
    const pages = await Promise.all((['ABERTA', 'DESPACHADA', 'EM_ATENDIMENTO'] as const).map((status) => occurrences.list({ status, per_page: 100 })))
    return pages.flatMap((p) => p.items).filter((o) => o.priority === 'CRITICA' || o.priority === 'ALTA')
      .sort((a, b) => Number(b.priority === 'CRITICA') - Number(a.priority === 'CRITICA') || Date.parse(a.opened_at) - Date.parse(b.opened_at))
  }, [])
  const call = list.data?.[selected % Math.max(1, list.data.length)]
  const detail = useResource(() => occurrences.get(call!.id), [call?.id], { enabled: !!call })
  const alerts = useVehicleAlerts()
  const { connected } = useRealtime((event) => {
    if (event.type === 'connected' || event.type.startsWith('occurrence.') || event.type.startsWith('dispatch.')) { list.reload(); detail.reload() }
  })
  if (!call) return list.error ? <span className="op-island-error">Acompanhamento indisponível</span> : null
  return <IslandDetail key={call.id} call={detail.data?.id === call.id ? detail.data : call} alerts={alerts} stale={!connected || !!list.error || !!detail.error} count={list.data?.length ?? 1} next={() => setSelected((value) => value + 1)} />
}

function IslandDetail({ call, alerts, stale, count, next }: { call: import('@/api/types').Occurrence; alerts: import('@/api/types').VehicleAlert[]; stale: boolean; count: number; next: () => void }) {
  const timeline = useTimeline(call.id)
  const now = useOperationClock()
  const stage = occurrenceStages(call, timeline.data ?? []).find((s) => s.current)!
  const dispatch = call.dispatches?.filter((d) => d.status !== 'CANCELADO').at(-1)
  const estimate = dispatchEstimate(dispatch, timeline.data ?? [], now)
  const alert = alerts.find((a) => call.dispatches?.some((d) => d.id === a.dispatch_id))
  return <aside className="op-island-strip" aria-label="Ocorrência em acompanhamento"><div className="op-island" data-alert={!!alert || undefined}>
    <Link key={stage.label} to={`/ocorrencias/${call.id}`} className="op-island-body" title={call.address}>
      <strong>{alert && <TriangleAlert size={13} />} {call.protocol} · {dispatch?.vehicle?.prefix ?? 'Aguardando viatura'}</strong>
      <span>{stale ? 'Conexão indisponível · dados anteriores' : alert ? `${alert.kind === 'parada' ? 'Parada inesperada' : 'Sem sinal'} · ${ageLabel(alert.since, now)}` : `${stage.label}${estimate ? estimate.remaining > 0 ? ` · previsão inicial ${Math.ceil(estimate.remaining / 60)} min` : ' · previsão excedida' : ''}`}</span>
    </Link>
    {count > 1 && <button type="button" onClick={next} onMouseEnter={next} aria-label={`Alternar ocorrência acompanhada; mais ${count - 1}`}><span>+{count - 1}</span><ChevronRight size={14} /></button>}
  </div></aside>
}

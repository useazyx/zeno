import type { Occurrence, TimelineEntry } from '@/api/types'
import { ageLabel, dispatchEstimate, occurrenceStages } from './operation-state'
import { useOperationClock } from './use-operation-clock'
import './operational.css'

export function OccurrenceStages({ occurrence, events }: { occurrence: Occurrence; events: TimelineEntry[] }) {
  const now = useOperationClock()
  const stages = occurrenceStages(occurrence, events)
  const dispatch = occurrence.dispatches?.filter((d) => d.status !== 'CANCELADO').at(-1)
  const estimate = dispatchEstimate(dispatch, events, now)
  return <section className="op-stages" aria-label="Etapas do atendimento">
    <ol>{stages.map((stage, index) => <li key={stage.label} data-current={stage.current || undefined} data-reached={stage.reached || undefined} data-late={stage.current && index === 2 && estimate && estimate.remaining < 0 || undefined} aria-current={stage.current ? 'step' : undefined}>
      <span className="op-stage-track"><i style={{ transform: `scaleX(${stage.reached ? stage.current && index === 2 && estimate ? Math.max(.04, estimate.progress) : 1 : 0})` }} /></span>
      <strong>{stage.label}</strong><time dateTime={stage.at ?? undefined}>{stage.at ? new Date(stage.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : stage.reached ? 'Horário não registrado' : 'Aguardando'}</time>
      {stage.current && index === 2 && <small>{estimate ? estimate.remaining > 0 ? `Previsão inicial · ${Math.ceil(estimate.remaining / 60)} min restantes` : `Previsão inicial excedida em ${Math.ceil(-estimate.remaining / 60)} min` : 'ETA indisponível'}</small>}
      {stage.current && index === 3 && stage.at && <small>{ageLabel(stage.at, now)} no local</small>}
    </li>)}</ol>
  </section>
}

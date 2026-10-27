/**
 * Which vehicle to send, by predicted arrival.
 *
 * Shown at the top of the dispatch dialog. The ranking comes from the backend
 * (doctrine first, then the network's travel time from where each vehicle is
 * now); this component only lays it out and lets one row fill the form.
 */

import { Sparkles } from "lucide-react"

import { occurrences } from "@/api/endpoints"
import { NATURE_LABEL, VEHICLE_TYPE_LABEL } from "@/api/labels"
import type { VehicleRecommendation } from "@/api/types"
import { ErrorBox } from "@/components/layout/feedback"
import { useResource } from "@/hooks/use-resource"
import { formatDistance, formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

export function VehicleRecommendations({ occurrenceId, criticalMode, selectedId, onChoose }: {
  occurrenceId: string
  criticalMode: boolean
  selectedId: string
  onChoose: (recommendation: VehicleRecommendation) => void
}) {
  const result = useResource(
    () => occurrences.recommendations(occurrenceId, { critical_mode: criticalMode, limit: 5 }),
    [occurrenceId, criticalMode],
  )

  return (
    <section className="flex flex-col gap-2 rounded-sm border border-accent/25 bg-accent-soft/50 px-3 py-3" aria-label="Sugestão de viatura">
      <p className="label-caps flex items-center gap-1.5 text-accent">
        <Sparkles className="h-4 w-4" />
        Sugestão por tempo de chegada
      </p>

      {result.loading && !result.data && <p className="text-sm text-ink-muted">Calculando a chegada de cada viatura disponível...</p>}
      {result.error && <ErrorBox message={result.error} />}

      {result.data && result.data.recommendations.length === 0 && (
        <p className="text-sm text-ink-muted">Nenhuma viatura disponível para sugerir.</p>
      )}

      {result.data && result.data.recommendations.length > 0 && (
        <>
          <ul className="flex flex-col gap-1.5">
            {result.data.recommendations.map((item) => {
              const selected = item.vehicle.id === selectedId
              return (
                <li key={item.vehicle.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(item)}
                    aria-pressed={selected}
                    className={cn(
                      "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border bg-surface px-3 py-2 text-left transition-colors hover:border-accent",
                      selected ? "border-accent ring-2 ring-accent/20" : "border-line",
                    )}
                  >
                    <span className="w-5 text-sm font-semibold tabular-nums text-ink-soft">{item.rank}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold text-ink">
                        {item.vehicle.prefix}
                        <span className="ml-2 text-sm font-normal text-ink-muted">{VEHICLE_TYPE_LABEL[item.vehicle.type]} · {item.unit.acronym}</span>
                      </span>
                      <span className="flex flex-wrap gap-x-2 text-xs">
                        {!item.suitable && <span className="text-warn">Não é o tipo indicado</span>}
                        {item.crew
                          ? <span className="text-ink-muted">Guarnição {item.crew.name} ({item.crew.members})</span>
                          : <span className="text-alert">Sem guarnição ativa</span>}
                        {item.origin.source === "station" && <span className="text-ink-soft">posição: quartel</span>}
                      </span>
                    </span>
                    <span className="flex flex-col items-end">
                      <span className="text-lg font-semibold tabular-nums text-ink">{item.reachable ? formatDuration(item.eta_seconds) : "—"}</span>
                      <span className="text-xs tabular-nums text-ink-muted">{item.reachable ? formatDistance(item.distance_meters) : "fora da malha"}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-ink-muted">
            Indicadas para {NATURE_LABEL[result.data.nature].toLowerCase()}: {result.data.suitable_types.join(", ")}.
            Viaturas equipadas e com guarnição vêm primeiro; o tempo é o previsto pela IA{criticalMode ? " em modo crítico" : ""}.
          </p>
        </>
      )}
    </section>
  )
}

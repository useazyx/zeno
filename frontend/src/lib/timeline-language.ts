/**
 * One line of an occurrence's timeline, in words.
 *
 * Relative imports only, so the node test runner can load it without the
 * bundler's `@` alias.
 */

import {
  DISPATCH_STATUS_LABEL, OCCURRENCE_STATUS_LABEL, PRIORITY_LABEL,
} from "../api/labels"
import type {
  DispatchStatus, OccurrencePriority, OccurrenceStatus, TimelineEntry,
} from "../api/types"

const ROUTE_LABEL: Record<string, string> = {
  NEURAL: "da IA",
  CRITICAL: "em modo crítico",
  DIJKSTRA: "padrão",
}

function label<T extends string>(labels: Record<T, string>, value: string | null): string {
  if (!value) return "—"
  return labels[value as T] ?? value
}

export function phraseEvent(event: Pick<TimelineEntry, "type" | "message" | "from_value" | "to_value" | "vehicle_prefix">): string {
  const vehicle = event.vehicle_prefix ?? "Viatura"

  switch (event.type) {
    case "ABERTURA":
      return event.to_value
        ? `Ocorrência aberta com prioridade ${label<OccurrencePriority>(PRIORITY_LABEL, event.to_value).toLowerCase()}`
        : "Ocorrência aberta"

    case "STATUS":
      return event.from_value
        ? `Situação: ${label<OccurrenceStatus>(OCCURRENCE_STATUS_LABEL, event.from_value)} → ${label<OccurrenceStatus>(OCCURRENCE_STATUS_LABEL, event.to_value)}`
        : `Situação: ${label<OccurrenceStatus>(OCCURRENCE_STATUS_LABEL, event.to_value)}`

    case "PRIORIDADE":
      return `Prioridade alterada de ${label<OccurrencePriority>(PRIORITY_LABEL, event.from_value).toLowerCase()} para ${label<OccurrencePriority>(PRIORITY_LABEL, event.to_value).toLowerCase()}`

    case "DESPACHO":
      return `${event.message ?? vehicle} despachada`

    case "DESPACHO_STATUS":
      return `${vehicle}: ${label<DispatchStatus>(DISPATCH_STATUS_LABEL, event.to_value).toLowerCase()}`

    case "ROTA": {
      const closures = event.message?.startsWith("closures:") ? Number(event.message.split(":")[1]) : 0
      const base = `Rota ${ROUTE_LABEL[event.to_value ?? ""] ?? ""} calculada para ${vehicle}`.replace("  ", " ")
      return closures > 0 ? `${base}, contornando ${closures} interdição(ões)` : base
    }

    case "NOTA":
      return event.message ?? ""
  }
}

/** Which semantic tone the dot beside a line wears. */
export function eventTone(event: Pick<TimelineEntry, "type" | "to_value">): "alert" | "warn" | "ok" | "accent" | "mute" {
  if (event.type === "NOTA") return "mute"
  if (event.type === "ABERTURA") return "alert"
  if (event.type === "PRIORIDADE") return "warn"
  if (event.to_value === "NO_LOCAL" || event.to_value === "EM_ATENDIMENTO") return "warn"
  if (event.to_value === "FINALIZADO" || event.to_value === "ENCERRADA") return "ok"
  if (event.to_value === "CANCELADO" || event.to_value === "CANCELADA") return "mute"
  return "accent"
}

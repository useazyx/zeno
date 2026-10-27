import { escapeHtml } from "@/lib/html"
/**
 * The attendance report (RAT) for one occurrence, printed on plain paper.
 *
 * Opened in its own window with its own stylesheet, so printing never depends
 * on the console's layout and the console never has to know about paper.
 */

import {
  DISPATCH_STATUS_LABEL, NATURE_LABEL, OCCURRENCE_STATUS_LABEL, PRIORITY_LABEL, VEHICLE_TYPE_LABEL,
} from "@/api/labels"
import type { Occurrence, TimelineEntry } from "@/api/types"
import { formatCoordinate, formatDateTime, formatDistance, formatDuration } from "@/lib/format"
import { phraseEvent } from "@/lib/timeline-language"


const ALGORITHM: Record<string, string> = { NEURAL: "IA", CRITICAL: "Modo crítico", DIJKSTRA: "Padrão" }

export function printOccurrenceReport(occurrence: Occurrence, timeline: TimelineEntry[]) {
  const report = window.open("", "_blank", "width=820,height=1000")
  if (!report) return

  const field = (term: string, value: string) => `<tr><th>${escapeHtml(term)}</th><td>${escapeHtml(value)}</td></tr>`

  const dispatchRows = (occurrence.dispatches ?? []).map((dispatch) => {
    const route = dispatch.used_route ?? dispatch.routes?.find((item) => item.id === dispatch.used_route_id)
    return `<tr>
      <td>${escapeHtml(dispatch.vehicle?.prefix ?? "—")}${dispatch.vehicle ? ` <small>${escapeHtml(VEHICLE_TYPE_LABEL[dispatch.vehicle.type])}</small>` : ""}</td>
      <td>${escapeHtml(dispatch.crew?.name ?? "—")}</td>
      <td>${formatDateTime(dispatch.dispatched_at)}</td>
      <td>${formatDateTime(dispatch.arrived_at ?? null)}</td>
      <td>${formatDateTime(dispatch.finished_at ?? null)}</td>
      <td>${escapeHtml(DISPATCH_STATUS_LABEL[dispatch.status])}</td>
      <td>${route ? `${ALGORITHM[route.algorithm] ?? route.algorithm} · ${formatDistance(route.distance_meters)} · ${formatDuration(route.estimated_time_seconds)}` : "—"}</td>
    </tr>`
  }).join("")

  const timelineRows = timeline.map((event) => `<tr>
    <td class="t">${formatDateTime(event.at)}</td>
    <td>${escapeHtml(phraseEvent(event))}${event.derived ? " <small>(reconstruído)</small>" : ""}</td>
  </tr>`).join("")

  report.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>RAT ${escapeHtml(occurrence.protocol)}</title>
<style>
  body { font: 12px/1.45 system-ui, sans-serif; color: #111; margin: 28px; }
  h1 { font-size: 18px; margin: 0; } h2 { font-size: 13px; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: .04em; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: end; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; border-bottom: 1px solid #ccc; padding: 4px 6px; vertical-align: top; }
  th { width: 30%; color: #444; font-weight: 600; }
  .t { width: 130px; white-space: nowrap; color: #333; }
  small { color: #555; }
  .report { white-space: pre-line; border: 1px solid #ccc; padding: 8px; }
  footer { margin-top: 24px; font-size: 10px; color: #555; display: flex; justify-content: space-between; }
  .sign { margin-top: 40px; display: flex; gap: 40px; } .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; text-align: center; }
</style></head><body>
<header>
  <div><h1>Relatório de Atendimento de Ocorrência</h1><div>Protocolo <strong>${escapeHtml(occurrence.protocol)}</strong></div></div>
  <div>${escapeHtml(occurrence.unit ? `${occurrence.unit.acronym} — ${occurrence.unit.name}` : "")}</div>
</header>
<h2>Ocorrência</h2>
<table>
  ${field("Natureza", NATURE_LABEL[occurrence.nature])}
  ${field("Prioridade", PRIORITY_LABEL[occurrence.priority])}
  ${field("Situação", OCCURRENCE_STATUS_LABEL[occurrence.status])}
  ${field("Endereço", occurrence.address)}
  ${field("Coordenadas", `${formatCoordinate(occurrence.latitude)}, ${formatCoordinate(occurrence.longitude)}`)}
  ${field("Solicitante", occurrence.caller_name ?? "Não informado")}
  ${field("Telefone", occurrence.caller_phone ?? "Não informado")}
  ${field("Aberta em", formatDateTime(occurrence.opened_at))}
  ${field("Encerrada em", formatDateTime(occurrence.closed_at ?? null))}
</table>
<h2>Relato</h2>
<div class="report">${escapeHtml(occurrence.description)}</div>
<h2>Viaturas empenhadas</h2>
${dispatchRows ? `<table><tr><th>Viatura</th><th>Guarnição</th><th>Despacho</th><th>Chegada</th><th>Liberação</th><th>Situação</th><th>Rota utilizada</th></tr>${dispatchRows}</table>` : "<p>Nenhuma viatura empenhada.</p>"}
<h2>Linha do tempo</h2>
<table>${timelineRows}</table>
<div class="sign"><div>Operador do despacho</div><div>Comandante da guarnição</div></div>
<footer><span>ZENO · Central de Despacho</span><span>Emitido em ${new Date().toLocaleString("pt-BR")}</span></footer>
</body></html>`)
  report.document.close()
  report.focus()
  report.print()
}

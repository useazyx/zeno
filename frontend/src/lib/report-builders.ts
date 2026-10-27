import type { Occurrence, OccurrenceStatisticsRow, Shift, Vehicle, WaterSource } from "../api/types"
import { NATURE_LABEL, OCCURRENCE_STATUS_LABEL, PRIORITY_LABEL, RANK_LABEL, SHIFT_TYPE_LABEL, VEHICLE_STATUS_LABEL, VEHICLE_TYPE_LABEL, WATER_STATUS_LABEL, WATER_TYPE_LABEL } from "../api/labels"
import { reportDate } from "./export-report"
import type { ExportReport, ExportSection } from "./export-report"

export function occurrenceReport(rows: Occurrence[], scope: string): ExportReport {
  return { title: "Ocorrências", filename: "zeno-ocorrencias", scope, sections: [{ name: "Ocorrências", columns: [
    { label: "Protocolo", width: 23 }, { label: "Natureza", width: 28 }, { label: "Prioridade", width: 14 }, { label: "Situação", width: 18 },
    { label: "Endereço", width: 42 }, { label: "Unidade", width: 24 }, { label: "Abertura", kind: "datetime", width: 24 }, { label: "Encerramento", kind: "datetime", width: 24 },
  ], rows: rows.map((o) => [o.protocol, NATURE_LABEL[o.nature], PRIORITY_LABEL[o.priority], OCCURRENCE_STATUS_LABEL[o.status], o.address, o.unit?.acronym ?? null, reportDate(o.opened_at), reportDate(o.closed_at)]) }] }
}

export function vehicleReport(rows: Vehicle[], scope: string): ExportReport {
  return { title: "Frota de viaturas", filename: "zeno-viaturas", scope, sections: [{ name: "Viaturas", columns: [
    { label: "Prefixo" }, { label: "Tipo", width: 32 }, { label: "Placa" }, { label: "Modelo", width: 28 }, { label: "Ano", kind: "number", format: "0", width: 12 },
    { label: "Lugares", kind: "number", width: 12 }, { label: "Unidade" }, { label: "Situação" },
  ], rows: rows.map((v) => [v.prefix, VEHICLE_TYPE_LABEL[v.type], v.plate, v.model, v.year, v.crew_capacity, v.unit?.acronym ?? null, VEHICLE_STATUS_LABEL[v.status]]) }] }
}

export function shiftReport(rows: Shift[], scope: string): ExportReport {
  return { title: "Escala de serviço", filename: "zeno-turnos", scope, sections: [{ name: "Turnos", columns: [
    { label: "Bombeiro", width: 32 }, { label: "Tipo", width: 24 }, { label: "Início", kind: "datetime", width: 26 }, { label: "Término", kind: "datetime", width: 26 }, { label: "Unidade", width: 20 },
  ], rows: rows.map((s) => [s.firefighter ? `${RANK_LABEL[s.firefighter.rank]} ${s.firefighter.war_name}` : null, SHIFT_TYPE_LABEL[s.type], reportDate(s.start_at), reportDate(s.end_at), s.unit?.acronym ?? null]) }] }
}

export function waterReport(rows: WaterSource[], scope: string): ExportReport {
  return { title: "Pontos de água", filename: "zeno-pontos-de-agua", scope, sections: [{ name: "Pontos de água", columns: [
    { label: "Código", width: 18 }, { label: "Tipo", width: 24 }, { label: "Situação", width: 20 }, { label: "Endereço", width: 40 },
    { label: "Vazão (L/min)", kind: "number", width: 18 }, { label: "Última inspeção", kind: "date", width: 23 }, { label: "Unidade", width: 25 },
  ], rows: rows.map((s) => [s.code, WATER_TYPE_LABEL[s.type], WATER_STATUS_LABEL[s.status], s.address, s.flow_lpm, reportDate(s.last_inspection_at), s.unit?.acronym ?? null]) }] }
}

export function statisticsReport(rows: OccurrenceStatisticsRow[], scope: string): ExportReport {
  const group = (name: string, label: string, value: (row: OccurrenceStatisticsRow) => string, chronological = false): ExportSection => {
    const counts = new Map<string, number>()
    for (const row of rows) { const key = value(row); counts.set(key, (counts.get(key) ?? 0) + 1) }
    const entries = [...counts.entries()].sort((a, b) => chronological ? a[0].localeCompare(b[0]) : b[1] - a[1])
    return { name, columns: [{ label, width: 50 }, { label: "Ocorrências", kind: "number", width: 20 }], rows: entries }
  }
  return { title: "Estatísticas de ocorrências", filename: "zeno-estatisticas", scope, sections: [
    { name: "Resumo", note: "Distribuições do recorte selecionado; não inclui o livro de operações por quartel.", columns: [{ label: "Indicador", width: 50 }, { label: "Quantidade", kind: "number", width: 20 }], rows: [["Ocorrências no recorte", rows.length]] },
    group("Natureza", "Natureza", (o) => NATURE_LABEL[o.nature]),
    group("Prioridade", "Prioridade", (o) => PRIORITY_LABEL[o.priority]),
    group("Situação", "Situação", (o) => OCCURRENCE_STATUS_LABEL[o.status]),
    group("Unidade responsável", "Unidade responsável", (o) => o.unit?.acronym ?? "Sem unidade"),
    group("Evolução diária", "Dia (AAAA-MM-DD)", (o) => { const d = new Date(o.opened_at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }, true),
  ] }
}

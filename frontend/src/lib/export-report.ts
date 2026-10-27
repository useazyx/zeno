import type { Paginated } from "../api/types"

export type ExportValue = string | number | Date | null
export interface ExportColumn { label: string; kind?: "text" | "number" | "date" | "datetime"; width?: number; format?: string }
export interface ExportSection { name: string; columns: ExportColumn[]; rows: ExportValue[][]; note?: string; pdf?: boolean }
export interface ExportReport { title: string; filename: string; scope: string; sections: ExportSection[]; generatedAt?: Date }
export const MAX_EXPORT_ROWS = 5000

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Exportação cancelada", "AbortError")
}

/** Each page must describe the same complete set; never download a partial report. */
export async function collectExportPages<T extends { id: string }>(
  fetchPage: (page: number, perPage: number) => Promise<Paginated<T>>,
  expectedTotal: number,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T[]> {
  if (expectedTotal > MAX_EXPORT_ROWS) throw new Error(`Refine os filtros para até ${MAX_EXPORT_ROWS.toLocaleString("pt-BR")} registros antes de exportar todos.`)
  throwIfAborted(signal)
  const result: T[] = []
  const ids = new Set<string>()
  let total = expectedTotal
  let perPage = 100
  for (let page = 1; page <= Math.max(1, Math.ceil(total / perPage)); page += 1) {
    throwIfAborted(signal)
    const data = await fetchPage(page, perPage)
    throwIfAborted(signal)
    if (data.total !== total || data.page !== page || data.per_page < 1 || data.per_page > 100) {
      throw new Error("Os registros mudaram durante a consulta. Atualize a lista e tente novamente.")
    }
    if (page === 1) { total = data.total; perPage = data.per_page }
    if (data.per_page !== perPage || data.items.length !== Math.min(perPage, total - result.length)) {
      throw new Error("A consulta retornou registros incompletos. Nenhum arquivo foi gerado.")
    }
    for (const item of data.items) {
      if (ids.has(item.id)) throw new Error("A lista mudou durante a exportação. Atualize e tente novamente.")
      ids.add(item.id)
      result.push(item)
    }
    onProgress?.(result.length, total)
  }
  return result
}

export function reportDate(value?: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function printable(value: ExportValue, column: ExportColumn): string {
  if (value === null) return "—"
  if (value instanceof Date) return column.kind === "date" ? value.toLocaleDateString("pt-BR") : value.toLocaleString("pt-BR")
  return typeof value === "number" ? value.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : value
}

const paperText = (value: string) => value.replace(/[–—]/g, "-").replace(/…/g, "...")
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Libraries are requested only after the operator chooses an export format. */
export async function createReportPdf(report: ExportReport): Promise<Uint8Array> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true })
  const generated = report.generatedAt ?? new Date()
  doc.setProperties({ title: report.title, subject: report.scope, author: "ZENO", creator: "ZENO - Comando e resposta" })
  doc.setCreationDate(generated)
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = width - margin * 2
  const sections = report.sections.filter((section) => section.pdf !== false)

  sections.forEach((section, index) => {
    if (index) doc.addPage()
    doc.setFontSize(8)
    const context = doc.splitTextToSize(paperText(report.scope), contentWidth) as string[]
    const note = section.note ? doc.splitTextToSize(paperText(section.note), contentWidth) as string[] : []
    const top = 36 + context.length * 4 + note.length * 4
    const weight = section.columns.reduce((sum, col) => sum + (col.width ?? 20), 0)
    autoTable(doc, {
      head: [section.columns.map((column) => column.label)],
      body: section.rows.map((row) => row.map((value, col) => paperText(printable(value, section.columns[col])))),
      startY: top,
      margin: { top, right: margin, bottom: 17, left: margin },
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 2.5, overflow: "linebreak", textColor: [32, 45, 57], lineColor: [215, 222, 227], lineWidth: { bottom: 0.15 } },
      headStyles: { fillColor: [28, 48, 63], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: [243, 246, 248] },
      columnStyles: Object.fromEntries(section.columns.map((col, column) => [column, { cellWidth: contentWidth * (col.width ?? 20) / weight, halign: col.kind === "number" ? "right" : "left" }])),
      rowPageBreak: "avoid",
      didDrawPage: () => {
        doc.setTextColor(28, 48, 63)
        doc.setFont("helvetica", "bold")
        doc.setFontSize(17)
        doc.text("ZENO", margin, 16)
        doc.setFontSize(12)
        doc.text(report.title, margin + 26, 16)
        doc.setDrawColor(28, 48, 63)
        doc.setLineWidth(0.5)
        doc.line(margin, 21, width - margin, 21)
        doc.setFontSize(10)
        doc.text(section.name, margin, 28)
        doc.setFont("helvetica", "normal")
        doc.setFontSize(8)
        doc.setTextColor(72, 86, 99)
        doc.text(context, margin, 34)
        if (note.length) doc.text(note, margin, 35 + context.length * 4)
      },
    })
  })
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(85, 99, 110)
    doc.text(`Emitido em ${generated.toLocaleString("pt-BR")} | Horários: ${timezone()}`, margin, height - 8)
    doc.text(`${page} / ${pages}`, width - margin, height - 8, { align: "right" })
  }
  return new Uint8Array(doc.output("arraybuffer"))
}

/** Excel dates have no timezone; encode the same local clock printed in the PDF. */
function excelDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()))
}

export async function createReportWorkbook(report: ExportReport): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const generated = report.generatedAt ?? new Date()
  workbook.creator = "ZENO"
  workbook.created = generated
  workbook.modified = generated
  workbook.title = report.title
  workbook.subject = report.scope
  for (const section of report.sections) {
    const sheet = workbook.addWorksheet(section.name.slice(0, 31), {
      views: [{ state: "frozen", ySplit: 6, xSplit: 0 }],
      pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:6" },
    })
    sheet.columns = section.columns.map((col) => ({ width: col.width ?? 22 }))
    const lastCol = section.columns.length
    const metadata = [`ZENO | ${report.title}`, report.scope, `Emitido em ${generated.toLocaleString("pt-BR")} | Horários: ${timezone()}`, section.note ?? `${section.rows.length.toLocaleString("pt-BR")} registros`]
    metadata.forEach((value, i) => {
      sheet.mergeCells(i + 1, 1, i + 1, lastCol)
      const cell = sheet.getCell(i + 1, 1)
      cell.value = value
      cell.font = { name: "Calibri", size: i ? 10 : 16, bold: i === 0, color: { argb: "FF203541" } }
      cell.alignment = { vertical: "middle", wrapText: true }
      sheet.getRow(i + 1).height = i === 0 ? 30 : i === 1 ? 32 : 25
    })
    sheet.getRow(6).values = section.columns.map((col) => col.label)
    sheet.getRow(6).height = 30
    sheet.getRow(6).eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C303F" } }
      cell.alignment = { vertical: "middle", wrapText: true }
    })
    for (const values of section.rows) {
      // Passing plain strings keeps =,+,-,@ text as text, never an Excel formula.
      const row = sheet.addRow(values.map((value) => value instanceof Date ? excelDate(value) : value))
      row.height = 32
      row.eachCell({ includeEmpty: true }, (cell, i) => {
        const column = section.columns[i - 1]
        cell.font = { name: "Calibri", size: 11, color: { argb: "FF203541" } }
        cell.alignment = { vertical: "top", wrapText: true }
        cell.numFmt = column.format ?? (column.kind === "datetime" ? "dd/mm/yyyy hh:mm" : column.kind === "date" ? "dd/mm/yyyy" : column.kind === "number" ? "#,##0.###" : "@")
        if (row.number % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6F8" } }
      })
    }
    sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: Math.max(6, sheet.rowCount), column: lastCol } }
    sheet.headerFooter.oddFooter = "ZENO | &P / &N"
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

export function downloadReport(bytes: Uint8Array, filename: string, format: "pdf" | "xlsx") {
  const blob = new Blob([new Uint8Array(bytes)], { type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${filename}.${format}`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

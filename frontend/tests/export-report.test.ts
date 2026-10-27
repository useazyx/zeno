import { test } from "node:test"
import assert from "node:assert/strict"
import ExcelJS from "exceljs"
import { collectExportPages, createReportPdf, createReportWorkbook, reportDate } from "../src/lib/export-report.ts"
import type { ExportReport } from "../src/lib/export-report.ts"

test("export pagination rejects incomplete, changed and duplicated results", async () => {
  const page = { page: 1, per_page: 100, total: 2, items: [{ id: "a" }] }
  await assert.rejects(collectExportPages(async () => page, 2), /incompletos/)
  await assert.rejects(collectExportPages(async () => ({ ...page, total: 3 }), 2), /mudaram/)
  await assert.rejects(collectExportPages(async () => ({ ...page, items: [{ id: "a" }, { id: "a" }] }), 2), /mudou/)
  await assert.rejects(collectExportPages(async () => page, 5001), /Refine/)
})

test("pagination respects server page size, progress and cancellation", async () => {
  const progress: number[] = []
  const rows = await collectExportPages(async (page) => ({ page, per_page: 2, total: 3, items: page === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }] }), 3, undefined, (n) => progress.push(n))
  assert.equal(rows.length, 3)
  assert.deepEqual(progress, [2, 3])
  const cancel = new AbortController()
  let calls = 0
  await assert.rejects(collectExportPages(async (page) => {
    calls++
    cancel.abort()
    return { page, per_page: 2, total: 3, items: [{ id: "a" }, { id: "b" }] }
  }, 3, cancel.signal), { name: "AbortError" })
  assert.equal(calls, 1)
})

const date = new Date(2026, 9, 6, 14, 30)
const report: ExportReport = {
  title: "Pontos de água", filename: "pontos-agua", scope: "Situação: Operante · Todos os filtrados",
  generatedAt: date,
  sections: [{ name: "Pontos de água", columns: [{ label: "Código" }, { label: "Vazão", kind: "number" }, { label: "Inspeção", kind: "datetime" }], rows: [["=HYPERLINK(\"https://example.org\")", 1250.5, date], ["Hidrante — São José", null, null]] }],
}

test("Excel preserves numeric and date cells, treats formulas as text and freezes headers", async () => {
  const bytes = await createReportWorkbook(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes))
  const sheet = workbook.worksheets[0]
  assert.equal(sheet.getCell("A7").type, ExcelJS.ValueType.String)
  assert.equal(sheet.getCell("A7").value, report.sections[0].rows[0][0])
  assert.equal(sheet.getCell("B7").value, 1250.5)
  assert.equal((sheet.getCell("C7").value as Date).getUTCHours(), 14)
  assert.equal(sheet.getCell("B8").value, null)
  assert.equal(sheet.views[0].state, "frozen")
  assert.ok(sheet.autoFilter)
})

test("PDF is generated as a real document and date parsing preserves missing values", async () => {
  const bytes = await createReportPdf(report)
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-")
  assert.ok(bytes.length > 1000)
  assert.equal(reportDate("invalid"), null)
  assert.equal(reportDate(null), null)
})

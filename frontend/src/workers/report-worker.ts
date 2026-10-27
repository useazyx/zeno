import { createReportPdf, createReportWorkbook } from "../lib/export-report"
import type { ExportReport } from "../lib/export-report"

self.onmessage = async (event: MessageEvent<{ report: ExportReport, format: "pdf" | "xlsx" }>) => {
  try {
    const { report, format } = event.data
    const bytes = await (format === "pdf" ? createReportPdf(report) : createReportWorkbook(report))
    self.postMessage({ bytes }, { transfer: [bytes.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Não foi possível gerar o arquivo." })
  }
}

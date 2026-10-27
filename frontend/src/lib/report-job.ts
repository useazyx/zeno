import type { ExportReport } from "./export-report"
import { throwIfAborted } from "./export-report"

export function generateReport(report: ExportReport, format: "pdf" | "xlsx", signal: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/report-worker.ts", import.meta.url), { type: "module" })
    const cleanup = () => {
      worker.terminate()
      signal.removeEventListener("abort", abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException("Exportação cancelada", "AbortError"))
    }
    signal.addEventListener("abort", abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ bytes: Uint8Array } | { error: string }>) => {
      cleanup()
      if ("error" in event.data) reject(new Error(event.data.error))
      else resolve(event.data.bytes)
    }
    worker.onerror = () => {
      cleanup()
      reject(new Error("Não foi possível gerar o arquivo. Tente novamente."))
    }
    try { worker.postMessage({ report, format }) }
    catch (error) { cleanup(); reject(error) }
  })
}

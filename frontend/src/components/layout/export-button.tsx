import { useEffect, useRef, useState } from "react"
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react"
import { ActionButton, Modal } from "./kit"
import { ErrorBox } from "./feedback"
import type { Paginated } from "@/api/types"
import { collectExportPages, downloadReport, MAX_EXPORT_ROWS, throwIfAborted } from "@/lib/export-report"
import { generateReport } from "@/lib/report-job"
import type { ExportReport } from "@/lib/export-report"

type Progress = (loaded: number, total: number) => void

export function ExportButton({ title, description, disabled, total, currentCount, createReport }: {
  title: string
  description: string
  disabled?: boolean
  total?: number
  currentCount?: number
  createReport: (all: boolean, signal: AbortSignal, progress: Progress) => Promise<ExportReport> | ExportReport
}) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  function close() {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
    setOpen(false)
  }

  async function generate(format: "pdf" | "xlsx") {
    if (busy || disabled) return
    const job = new AbortController()
    controller.current = job
    setBusy(true)
    setError("")
    setNotice("")
    setProgress("Preparando os dados…")
    try {
      const report = await createReport(all, job.signal, (loaded, count) => setProgress(`${loaded.toLocaleString("pt-BR")} de ${count.toLocaleString("pt-BR")} registros`))
      throwIfAborted(job.signal)
      setProgress(`Gerando ${format === "pdf" ? "PDF" : "planilha"}…`)
      const bytes = await generateReport(report, format, job.signal)
      throwIfAborted(job.signal)
      downloadReport(bytes, report.filename, format)
      setNotice(`${format === "pdf" ? "PDF" : "Planilha Excel"} gerado. Download iniciado.`)
      setOpen(false)
    } catch (cause) {
      if (!job.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível gerar o arquivo. Tente novamente.")
    } finally {
      if (controller.current === job) { controller.current = null; setBusy(false) }
    }
  }

  return <>
    <ActionButton disabled={disabled} onClick={() => { setAll(false); setError(""); setNotice(""); setOpen(true) }}>
      <Download className="h-4 w-4" /> Exportar
    </ActionButton>
    {notice && <span role="status" className="max-w-64 text-xs text-ok">{notice}</span>}
    {open && <Modal title={`Exportar ${title}`} onClose={close}>
      <div className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-ink-muted">{description}</p>
        {total !== undefined && <fieldset disabled={busy} className="flex flex-col gap-3">
          <legend className="label-caps mb-3 text-ink-muted">Registros do arquivo</legend>
          <label className="flex items-start gap-3 border border-line p-3 text-sm">
            <input className="mt-1" type="radio" name="export-scope" checked={!all} onChange={() => setAll(false)} />
            <span>Página atual <span className="text-ink-muted">· {currentCount?.toLocaleString("pt-BR")} registros</span></span>
          </label>
          <label className="flex items-start gap-3 border border-line p-3 text-sm">
            <input className="mt-1" type="radio" name="export-scope" checked={all} disabled={total > MAX_EXPORT_ROWS} onChange={() => setAll(true)} />
            <span>Todos os resultados filtrados <span className="text-ink-muted">· {total.toLocaleString("pt-BR")}</span>
              {total > MAX_EXPORT_ROWS && <span className="mt-1 block text-xs text-ink-muted">Refine os filtros para até {MAX_EXPORT_ROWS.toLocaleString("pt-BR")} registros para habilitar esta opção.</span>}
            </span>
          </label>
        </fieldset>}
        {error && <ErrorBox message={error} />}
        {busy ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p role="status" className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />{progress}</p>
          <ActionButton onClick={close}>Cancelar exportação</ActionButton>
        </div> : <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          <ActionButton disabled={disabled} onClick={() => void generate("pdf")}><FileText className="h-4 w-4" />Gerar PDF</ActionButton>
          <ActionButton disabled={disabled} onClick={() => void generate("xlsx")}><FileSpreadsheet className="h-4 w-4" />Gerar Excel</ActionButton>
        </div>}
      </div>
    </Modal>}
  </>
}

export function PaginatedExport<T extends { id: string }>({ title, description, data, disabled, fetchPage, report }: {
  title: string
  description: string
  data: Paginated<T> | null
  disabled: boolean
  fetchPage: (page: number, perPage: number) => Promise<Paginated<T>>
  report: (rows: T[], scope: string) => ExportReport
}) {
  return <ExportButton title={title} description={description} disabled={disabled || !data?.items.length}
    total={data?.total} currentCount={data?.items.length}
    createReport={async (all, signal, progress) => {
      if (!data) throw new Error("Aguarde os dados da lista.")
      const rows = all ? await collectExportPages(fetchPage, data.total, signal, progress) : [...data.items]
      const scope = all ? `Todos os resultados filtrados · ${rows.length} registros` : `Página ${data.page} · ${rows.length} de ${data.total} registros`
      return report(rows, scope)
    }} />
}

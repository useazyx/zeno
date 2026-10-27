import { escapeHtml } from "@/lib/html"
import type { RouteStep } from "@/api/types"
import { formatDistance, formatDuration } from "@/lib/format"
import { phraseStep } from "@/lib/route-language"


/**
 * A plain black-on-white card for the cab, opened in its own window so the
 * console's layout never has to know about paper.
 */
export function printRouteCard(title: string, summary: string | undefined, steps: RouteStep[]) {
  const card = window.open("", "_blank", "width=720,height=900")
  if (!card) return

  let elapsed = 0
  const rows = steps.map((step, index) => {
    const at = elapsed
    elapsed += step.time_seconds
    const distance = step.type !== "arrive" && step.distance_meters > 0 ? formatDistance(step.distance_meters) : ""
    return `<tr><td class="n">${index + 1}</td><td>${escapeHtml(phraseStep(step))}</td><td class="r">${distance}</td><td class="r">${formatDuration(at)}</td></tr>`
  }).join("")

  card.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 16px; color: #444; }
  table { width: 100%; border-collapse: collapse; }
  td { border-bottom: 1px solid #ccc; padding: 6px 4px; vertical-align: top; }
  .n { width: 28px; color: #666; } .r { text-align: right; white-space: nowrap; color: #333; }
  footer { margin-top: 16px; font-size: 11px; color: #666; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
<table>${rows}</table>
<footer>ZENO · Central de Despacho · gerado em ${new Date().toLocaleString("pt-BR")}. Tempos estimados pela rede neural.</footer>
</body></html>`)
  card.document.close()
  card.focus()
  card.print()
}

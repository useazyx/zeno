/**
 * The AI's route checked against an outside engine.
 *
 * On request (OSRM is a public demo server with fair-use limits), the same
 * trip goes through OSRM over the same OpenStreetMap data. The card shows the
 * time and distance gaps and how much of the line both engines agree on. OSRM
 * times a private car on free-flowing roads, so the AI is expected to differ;
 * the card makes the size of that gap visible.
 */

import { useState } from "react"
import { Scale } from "lucide-react"

import { geo } from "@/api/endpoints"
import type { ReferenceRoute, RoutePreview } from "@/api/types"
import { messageOf } from "@/hooks/use-resource"
import { formatDistance, formatDuration } from "@/lib/format"
import { benchmark } from "@/lib/route-benchmark"
import { cn } from "@/lib/utils"

function signed(value: number, format: (absolute: number) => string) {
  if (Math.round(value) === 0) return "igual"
  return `${value < 0 ? "−" : "+"}${format(Math.abs(value))}`
}

function Delta({ label, ai, reference, delta, pct, format }: {
  label: string
  ai: string
  reference: string
  delta: number
  pct: number
  format: (absolute: number) => string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-caps text-ink-soft">{label}</span>
      <span className="text-sm text-ink">IA {ai} · OSRM {reference}</span>
      <span className={cn("text-sm font-semibold tabular-nums", Math.abs(pct) > 25 ? "text-warn" : "text-ink")}>
        {signed(delta, format)} ({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)
      </span>
    </div>
  )
}

export function RouteBenchmark({ neural }: { neural: RoutePreview }) {
  const [state, setState] = useState<
    | { status: "idle" | "loading" }
    | { status: "done", route: ReferenceRoute | null }
    | { status: "error", message: string }
  >({ status: "idle" })

  const origin = neural.geometry[0]
  const destination = neural.geometry[neural.geometry.length - 1]

  async function run() {
    if (!origin || !destination) return
    setState({ status: "loading" })
    try {
      setState({ status: "done", route: await geo.referenceRoute(origin, destination) })
    } catch (error) {
      setState({ status: "error", message: messageOf(error) })
    }
  }

  const result = state.status === "done" && state.route ? benchmark(neural, state.route) : null

  return (
    <section className="flex flex-col gap-3 rounded-sm border border-line bg-surface px-4 py-3" aria-label="Comparação com motor externo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-caps text-ink-muted">Referência externa</p>
        <button
          type="button"
          onClick={run}
          disabled={state.status === "loading"}
          className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-muted disabled:opacity-60"
        >
          <Scale className="h-4 w-4" />
          {state.status === "loading" ? "Consultando..." : state.status === "done" ? "Consultar de novo" : "Comparar com OSRM"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="text-sm text-ink-muted">
          Calcula o mesmo trajeto no OSRM, outro motor de rotas sobre o mesmo OpenStreetMap, para conferir a estimativa da IA.
        </p>
      )}

      {state.status === "error" && (
        <p className="text-sm text-alert">Não foi possível consultar o OSRM: {state.message}</p>
      )}

      {state.status === "done" && !state.route && (
        <p className="text-sm text-ink-muted">O OSRM não encontrou caminho entre estes pontos.</p>
      )}

      {state.status === "done" && state.route && result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Delta
              label="Tempo"
              ai={formatDuration(neural.estimated_time_seconds)}
              reference={formatDuration(state.route.duration_seconds)}
              delta={result.timeDeltaS}
              pct={result.timeDeltaPct}
              format={formatDuration}
            />
            <Delta
              label="Distância"
              ai={formatDistance(neural.distance_meters)}
              reference={formatDistance(state.route.distance_meters)}
              delta={result.distanceDeltaM}
              pct={result.distanceDeltaPct}
              format={formatDistance}
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink">Traçado em comum</span>
              <span className="font-semibold tabular-nums text-ink">{result.sharedPct.toFixed(0)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-sm bg-mute-soft" role="img" aria-label={`${result.sharedPct.toFixed(0)}% do traçado em comum`}>
              <div className="h-full bg-accent" style={{ width: `${result.sharedPct}%` }} />
            </div>
          </div>
          <p className="text-xs text-ink-soft">
            O OSRM estima um carro de passeio em via livre; a IA, uma viatura pesada com a velocidade aprendida nos deslocamentos. Alguma diferença é esperada; acima de 25% fica em destaque.
          </p>
        </>
      )}
    </section>
  )
}

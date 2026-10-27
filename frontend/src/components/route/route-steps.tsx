/**
 * Turn-by-turn instructions for one route.
 *
 * The list a driver reads at a red light, or the crew commander reads aloud:
 * one line per manoeuvre, the distance to drive after it, and the running time.
 * It can be printed as a route card for the cab.
 */

import {
  ArrowUp, ArrowUpLeft, ArrowUpRight, CornerUpLeft, CornerUpRight, Flag, MapPin, Printer, RotateCw, Undo2,
} from "lucide-react"
import type { ReactNode } from "react"

import type { RouteStep } from "@/api/types"
import { formatDistance, formatDuration } from "@/lib/format"
import { phraseStep, stepGlyph } from "@/lib/route-language"
import { printRouteCard } from "./print-route-card"
import { cn } from "@/lib/utils"

const GLYPH: Record<ReturnType<typeof stepGlyph>, ReactNode> = {
  depart: <MapPin className="h-4 w-4" />,
  arrive: <Flag className="h-4 w-4" />,
  roundabout: <RotateCw className="h-4 w-4" />,
  straight: <ArrowUp className="h-4 w-4" />,
  left: <CornerUpLeft className="h-4 w-4" />,
  right: <CornerUpRight className="h-4 w-4" />,
  "slight-left": <ArrowUpLeft className="h-4 w-4" />,
  "slight-right": <ArrowUpRight className="h-4 w-4" />,
  uturn: <Undo2 className="h-4 w-4" />,
}

export function RouteSteps({ steps, title, summary, onSelect, compact }: {
  steps: RouteStep[]
  /** Heading of the printed card, e.g. "ABT-11201 → Ocorrência 2026-000123". */
  title: string
  /** One line under the heading of the printed card. */
  summary?: string
  /** Called with the step's location, to fly the map there. */
  onSelect?: (step: RouteStep) => void
  compact?: boolean
}) {
  if (steps.length === 0) {
    return <p className="text-sm text-ink-muted">Esta rota foi gravada antes das manobras existirem.</p>
  }

  // Time already driven when each step begins.
  const startsAt = steps.map((_, index) =>
    steps.slice(0, index).reduce((sum, step) => sum + step.time_seconds, 0))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="label-caps text-ink-muted">{steps.length - 1} manobras</p>
        <button
          type="button"
          onClick={() => printRouteCard(title, summary, steps)}
          className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong px-2.5 py-1 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
        >
          <Printer className="h-4 w-4" />
          Imprimir cartão
        </button>
      </div>

      <ol className={cn("flex flex-col divide-y divide-line overflow-y-auto rounded-sm border border-line", compact ? "max-h-72" : "max-h-[28rem]")}>
        {steps.map((step, index) => {
          const at = startsAt[index]
          const glyph = stepGlyph(step)
          const content = (
            <>
              <span className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border",
                glyph === "arrive" ? "border-alert/30 bg-alert-soft text-alert"
                  : glyph === "depart" ? "border-accent/30 bg-accent-soft text-accent"
                    : "border-line-strong bg-surface-muted text-ink",
              )}>
                {GLYPH[glyph]}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold text-ink">{phraseStep(step)}</span>
                {step.type !== "arrive" && step.distance_meters > 0 && (
                  <span className="text-xs text-ink-muted">
                    por {formatDistance(step.distance_meters)} · {formatDuration(step.time_seconds)}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-soft">{formatDuration(at)}</span>
            </>
          )

          return (
            <li key={`${index}-${step.geometry_index}`}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(step)}
                  className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-accent-soft"
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-start gap-3 px-3 py-2">{content}</div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}


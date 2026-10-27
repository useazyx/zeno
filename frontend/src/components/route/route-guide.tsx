/**
 * Turn-by-turn guidance for the cab, the way a navigation app does it.
 *
 * The next manoeuvre in large type with the distance to it, read aloud in
 * Portuguese when it changes and again when the vehicle gets close. The
 * position comes from the tablet's GPS or, for a demonstration, from a
 * simulated drive along the route that also reports itself to the backend, so
 * every console sees the vehicle move.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Pause, Play, Volume2, VolumeX } from "lucide-react"

import type { RouteStep } from "@/api/types"
import { formatDistance } from "@/lib/format"
import { cumulative, locateOnRoute, nextStep, spokenDistance } from "@/lib/guidance"
import type { LatLon } from "@/lib/guidance"
import { phraseStep } from "@/lib/route-language"
import type { useRouteSimulation } from "@/hooks/use-route-simulation"
import { cn } from "@/lib/utils"

/** Farther than this from the line, the driver has left the route. */
const OFF_ROUTE_M = 80
/** The second, closer announcement of a manoeuvre. */
const NEAR_M = 200
/** Closer than this to the end of the line, the vehicle has arrived. */
const ARRIVED_M = 30

function speak(text: string) {
  if (!("speechSynthesis" in window)) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = "pt-BR"
  utterance.rate = 1.05
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

export function RouteGuide({ geometry, steps, position, simulation }: {
  geometry: LatLon[]
  steps: RouteStep[]
  /** The vehicle's position from GPS or the simulation; null before the first fix. */
  position: LatLon | null
  simulation: ReturnType<typeof useRouteSimulation>
}) {
  const [voice, setVoice] = useState(false)
  const along = useMemo(() => cumulative(geometry), [geometry])
  const located = useMemo(() => (position ? locateOnRoute(geometry, position, along) : null), [geometry, position, along])
  const upcoming = useMemo(() => {
    if (located) return nextStep(steps, located.along, along)
    return steps.length > 1 ? { step: steps[1], index: 1, inM: along[steps[1].geometry_index] ?? 0 } : null
  }, [located, steps, along])
  const offRoute = located !== null && located.offRouteM > OFF_ROUTE_M
  const remaining = (along[along.length - 1] ?? 0) - (located?.along ?? 0)
  // Routes saved before manoeuvres existed come without steps: the guide can
  // still follow the line, it just has nothing to announce.
  const hasSteps = steps.length > 1
  const arrived = located !== null && remaining <= ARRIVED_M

  const announced = useRef<{ index: number, near: boolean }>({ index: -1, near: false })

  useEffect(() => {
    if (!voice || !upcoming) return
    const phrase = phraseStep(upcoming.step)
    if (announced.current.index !== upcoming.index) {
      announced.current = { index: upcoming.index, near: upcoming.inM <= NEAR_M }
      speak(`${spokenDistance(upcoming.inM)}, ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`)
    } else if (!announced.current.near && upcoming.inM <= NEAR_M) {
      announced.current.near = true
      speak(`${spokenDistance(upcoming.inM)}, ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`)
    }
  }, [voice, upcoming])

  return (
    <section className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-3" aria-label="Guia de navegação">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-caps text-ink-muted">Próxima manobra</p>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={voice}
            disabled={!hasSteps}
            title={hasSteps ? undefined : "Esta rota não tem manobras para anunciar"}
            onClick={() => {
              const next = !voice
              setVoice(next)
              announced.current = { index: -1, near: false }
              if (!next) window.speechSynthesis?.cancel()
            }}
            className={cn("inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm font-semibold", voice ? "border-action bg-action text-white" : "border-line-strong text-ink", !hasSteps && "cursor-not-allowed opacity-50")}
          >
            {voice ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            Voz
          </button>
        </div>
      </div>

      {arrived || (hasSteps && located && !upcoming) ? (
        <p className="text-xl font-semibold text-ok">Chegada ao destino</p>
      ) : upcoming ? (
        <div aria-live="polite">
          <p className="text-3xl font-semibold tabular-nums text-ink">{formatDistance(upcoming.inM)}</p>
          <p className="text-xl font-semibold text-ink">{phraseStep(upcoming.step)}</p>
        </div>
      ) : (
        <p className="text-xl font-semibold text-ink">Siga a rota traçada no mapa</p>
      )}

      {offRoute && (
        <p className="rounded-sm border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-ink">
          Fora da rota calculada ({Math.round(located!.offRouteM)} m). Retorne à via indicada ou peça novo cálculo ao despacho.
        </p>
      )}

      <p className="text-sm text-ink-muted">
        {arrived ? "Viatura no local da ocorrência." : position ? `Faltam ${formatDistance(Math.max(0, remaining))}` : "Aguardando posição: ative o GPS ou simule o deslocamento."}
      </p>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="label-caps text-ink-soft">Demonstração</span>
        <button
          type="button"
          onClick={simulation.toggle}
          className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-muted"
        >
          {simulation.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {simulation.running ? "Pausar simulação" : simulation.progress >= 1 ? "Simular de novo" : "Simular deslocamento"}
        </button>
        <select
          value={simulation.speed}
          onChange={(event) => simulation.setSpeed(Number(event.target.value))}
          aria-label="Velocidade da simulação"
          className="rounded-sm border border-line px-2 py-1.5 text-sm"
        >
          {[1, 2, 4, 10, 30].map((value) => <option key={value} value={value}>{value}×</option>)}
        </select>
        {simulation.progress > 0 && (
          <span className="text-xs tabular-nums text-ink-muted">{Math.round(simulation.speedKmh)} km/h previstos · {formatDistance(simulation.remainingMeters)} · ETA {Math.floor(simulation.remainingSeconds / 60)}:{String(Math.ceil(simulation.remainingSeconds) % 60).padStart(2, '0')}</span>
        )}
      </div>
    </section>
  )
}

/**
 * Why the network picked this route.
 *
 * Two readings of the same answer. The road mix compares how much of each
 * route runs on main roads, which is usually the whole story behind "longer
 * but faster". The speed profile shows, of the metres the IA route drives,
 * how many the model expects to be fluid and how many slow — the same colours
 * the map paints along the line when the explanation layer is on.
 */

import type { RoadClass } from "@/api/types"
import { compositionOf, speedProfile } from "@/lib/route-insight"
import type { InsightRoute } from "@/lib/route-insight"
import { formatDistance } from "@/lib/format"
import {
  ROAD_CLASS_LABEL, SPEED_BAND_COLOR, SPEED_BAND_LABEL, explainChoice,
} from "@/lib/route-language"
import type { SpeedBand } from "@/lib/route-language"

const ROAD_ORDER: RoadClass[] = ["highway", "primary", "secondary", "tertiary", "local"]

/** Darkest for the fastest roads, fading towards local streets. */
const ROAD_SHADE: Record<RoadClass, string> = {
  highway: "#42799F",
  primary: "#5898BD",
  secondary: "#79ADC9",
  tertiary: "#8DB6D8",
  local: "#C9D6E2",
}

function RoadMix({ label, composition }: { label: string, composition: Record<RoadClass, number> }) {
  const total = ROAD_ORDER.reduce((sum, key) => sum + (composition[key] ?? 0), 0) || 1

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold text-ink">{label}</span>
        <span className="text-ink-muted">{formatDistance(total)}</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-sm bg-mute-soft" role="img"
        aria-label={`${label}: ${ROAD_ORDER.map((key) => `${ROAD_CLASS_LABEL[key]} ${Math.round((composition[key] ?? 0) / total * 100)}%`).join(", ")}`}>
        {ROAD_ORDER.map((key) => (
          <span key={key} style={{ width: `${(composition[key] ?? 0) / total * 100}%`, backgroundColor: ROAD_SHADE[key] }} />
        ))}
      </div>
    </div>
  )
}



export function RouteInsight({ neural, shortest }: { neural: InsightRoute, shortest: InsightRoute }) {
  const neuralComposition = compositionOf(neural)
  const shortestComposition = compositionOf(shortest)
  if (!neuralComposition || !shortestComposition) return null

  const profile = speedProfile(neural.segments ?? [])
  const profileTotal = profile.fluid + profile.moderate + profile.slow || 1

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-line bg-surface px-4 py-3">
      <div>
        <p className="label-caps text-ink-muted">Por que esta rota</p>
        <p className="mt-1 text-sm text-ink">
          {explainChoice(neuralComposition, shortestComposition, neural.shared_with_shortest)}
        </p>
        {neural.shared_with_shortest !== undefined && (
          <p className="mt-1 text-xs text-ink-muted">
            {Math.round(neural.shared_with_shortest * 100)}% do percurso da IA passa pelas mesmas ruas da rota mais curta.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <RoadMix label="IA" composition={neuralComposition} />
        <RoadMix label="Menor distância" composition={shortestComposition} />
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
          {ROAD_ORDER.map((key) => (
            <li key={key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[1px]" style={{ backgroundColor: ROAD_SHADE[key] }} />
              {ROAD_CLASS_LABEL[key]}
            </li>
          ))}
        </ul>
      </div>

      {(neural.segments?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="label-caps text-ink-muted">Velocidade prevista pela IA</p>
          <div className="flex h-3 w-full overflow-hidden rounded-sm" role="img"
            aria-label={(["fluid", "moderate", "slow"] as SpeedBand[]).map((band) => `${SPEED_BAND_LABEL[band]} ${Math.round(profile[band] / profileTotal * 100)}%`).join(", ")}>
            {(["fluid", "moderate", "slow"] as SpeedBand[]).map((band) => (
              <span key={band} style={{ width: `${profile[band] / profileTotal * 100}%`, backgroundColor: SPEED_BAND_COLOR[band] }} />
            ))}
          </div>
          <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
            {(["fluid", "moderate", "slow"] as SpeedBand[]).map((band) => (
              <li key={band} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[1px]" style={{ backgroundColor: SPEED_BAND_COLOR[band] }} />
                  {SPEED_BAND_LABEL[band]}
                </span>
                <span className="tabular-nums">{formatDistance(profile[band])}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-soft">Velocidade prevista comparada ao limite da via. Ative “Explicar” no mapa para ver onde cada trecho fica.</p>
        </div>
      )}
    </div>
  )
}

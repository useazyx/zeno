/**
 * What the crew needs to know about the place before arriving: the weather
 * (wind spreads a vegetation fire and a gas cloud; rain changes the road), the
 * nearest water points, the hospitals for the second leg of a rescue, and a
 * look at the street itself.
 *
 * Each block loads on its own and fails on its own: a public weather service
 * being down must never hide the hydrant list.
 */

import { Camera, CloudRain, Droplets, ExternalLink, Hospital, Navigation2, Wind } from "lucide-react"

import { geo, occurrences } from "@/api/endpoints"
import type { Occurrence } from "@/api/types"
import { Badge, Panel } from "@/components/layout/kit"
import { useResource } from "@/hooks/use-resource"
import { WATER_STATUS_LABEL, WATER_STATUS_TONE } from "@/api/labels"
import { formatDistance, formatDuration, toNumber } from "@/lib/format"
import { cardinal } from "@/lib/route-language"
import { streetViewUrl, weatherLabel } from "@/lib/scene"




/** Natures where the patient may need a hospital after the crew arrives. */
const NEEDS_HOSPITAL = new Set(["ATENDIMENTO_PRE_HOSPITALAR", "SALVAMENTO", "AFOGAMENTO", "PRODUTOS_PERIGOSOS", "INCENDIO_EDIFICACAO", "INCENDIO_VEICULO"])
/** Natures where water supply matters. */
const NEEDS_WATER = new Set(["INCENDIO_EDIFICACAO", "INCENDIO_VEGETACAO", "INCENDIO_VEICULO", "PRODUTOS_PERIGOSOS"])


export function SceneSupport({ occurrence }: { occurrence: Occurrence }) {
  const latitude = toNumber(occurrence.latitude) ?? 0
  const longitude = toNumber(occurrence.longitude) ?? 0

  const weather = useResource(() => geo.weather(latitude, longitude), [latitude, longitude])
  const water = useResource(() => occurrences.waterSources(occurrence.id, 3), [occurrence.id])
  const hospitals = useResource(() => occurrences.hospitals(occurrence.id), [occurrence.id])

  const hospitalFirst = NEEDS_HOSPITAL.has(occurrence.nature) && !NEEDS_WATER.has(occurrence.nature)

  const weatherBlock = (
    <section className="flex flex-col gap-2" aria-label="Clima no local">
      <p className="label-caps flex items-center gap-1.5 text-ink-muted"><Wind className="h-4 w-4" /> Clima no local</p>
      {weather.data ? (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Figure label="Agora" value={`${Math.round(weather.data.temperature_c)} °C`} hint={weatherLabel(weather.data.weather_code)} />
          <Figure
            label="Vento"
            value={`${Math.round(weather.data.wind_speed_kmh)} km/h`}
            hint={`de ${cardinal(weather.data.wind_direction_deg)} · rajada ${Math.round(weather.data.wind_gusts_kmh)}`}
            icon={(
              // The arrow points where the wind blows TO, which is where
              // smoke and fire travel; meteorology reports where it comes from.
              <Navigation2
                className="h-4 w-4 text-accent"
                style={{ transform: `rotate(${(weather.data.wind_direction_deg + 180) % 360}deg)` }}
                aria-hidden
              />
            )}
          />
          <Figure label="Umidade" value={`${weather.data.humidity_percent}%`} hint={weather.data.humidity_percent < 30 ? "Ar seco: risco de propagação" : undefined} />
          <Figure
            label="Chuva"
            value={`${weather.data.precipitation_mm.toLocaleString("pt-BR")} mm`}
            hint={weather.data.precipitation_mm > 0 ? "Pista molhada" : "Sem chuva"}
            icon={<CloudRain className="h-4 w-4 text-ink-soft" aria-hidden />}
          />
        </div>
      ) : (
        <p className="text-sm text-ink-muted">{weather.error ? "Clima indisponível no momento." : "Consultando o clima..."}</p>
      )}
    </section>
  )

  const waterBlock = (
    <section className="flex flex-col gap-2" aria-label="Pontos de água próximos">
      <p className="label-caps flex items-center gap-1.5 text-ink-muted"><Droplets className="h-4 w-4" /> Pontos de água próximos</p>
      {water.loading && !water.data && <p role="status" className="text-sm text-ink-muted">Consultando pontos de água próximos…</p>}
      {water.data && !water.error && water.data.length === 0 && <p className="text-sm text-ink-muted">Nenhum ponto de água cadastrado.</p>}
      {water.error && <p className="text-sm text-ink-muted">Cadastro de hidrantes indisponível.</p>}
      {(water.data?.length ?? 0) > 0 && <ul className="flex flex-col divide-y divide-line rounded-sm border border-line">
        {(water.data ?? []).map((source) => (
          <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <strong className="font-mono text-ink">{source.code}</strong>
              <span className="ml-2 text-ink-muted">{source.address}</span>
            </span>
            <span className="flex items-center gap-2">
              {source.flow_lpm !== null && <span className="text-xs text-ink-muted">{source.flow_lpm.toLocaleString("pt-BR")} L/min</span>}
              <Badge tone={WATER_STATUS_TONE[source.status]}>{WATER_STATUS_LABEL[source.status]}</Badge>
              <span className="w-14 text-right font-semibold tabular-nums text-ink">{formatDistance(source.distance_meters ?? null)}</span>
            </span>
          </li>
        ))}
      </ul>}
    </section>
  )

  const hospitalBlock = (
    <section className="flex flex-col gap-2" aria-label="Hospitais">
      <p className="label-caps flex items-center gap-1.5 text-ink-muted"><Hospital className="h-4 w-4" /> Destino de vítimas</p>
      {hospitals.error && <p className="text-sm text-ink-muted">Lista de hospitais indisponível.</p>}
      {hospitals.loading && !hospitals.data && <p role="status" className="text-sm text-ink-muted">Calculando tempos até os hospitais...</p>}
      {hospitals.data && !hospitals.error && hospitals.data.length === 0 && <p className="text-sm text-ink-muted">Nenhum hospital encontrado na região.</p>}
      {(hospitals.data?.length ?? 0) > 0 && <ul className="flex flex-col divide-y divide-line rounded-sm border border-line">
        {(hospitals.data ?? []).slice(0, 3).map((hospital) => (
          <li key={hospital.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 text-ink">
              {hospital.name}
              {hospital.emergency && <span className="label-caps ml-2 text-alert">pronto-socorro</span>}
            </span>
            <span className="flex items-center gap-3 tabular-nums">
              <span className="text-ink-muted">{formatDistance(hospital.distance_meters)}</span>
              <span className="w-16 text-right font-semibold text-ink">{formatDuration(hospital.eta_seconds)}</span>
            </span>
          </li>
        ))}
      </ul>}
      <p className="text-xs text-ink-soft">Tempo de ida a partir da ocorrência, pela rede neural. Fonte: OpenStreetMap.</p>
    </section>
  )

  return (
    <Panel title="Apoio à cena" icon={<Camera className="h-5 w-5" />}
      actions={(
        <a
          href={streetViewUrl(latitude, longitude)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
        >
          <Camera className="h-4 w-4" />
          Ver a rua (Street View)
          <ExternalLink className="h-3.5 w-3.5 text-ink-soft" />
        </a>
      )}
    >
      <StreetImage latitude={latitude} longitude={longitude} />
      {weatherBlock}
      {hospitalFirst ? <>{hospitalBlock}{waterBlock}</> : <>{waterBlock}{hospitalBlock}</>}
    </Panel>
  )
}

function Figure({ label, value, hint, icon }: { label: string, value: string, hint?: string, icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-sm border border-line bg-surface-muted px-3 py-2">
      <span className="label-caps text-ink-soft">{label}</span>
      <span className="flex items-center gap-1.5 text-lg font-semibold tabular-nums text-ink">{icon}{value}</span>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  )
}

/**
 * Street-level photo from Mapillary, when the deployment has a token for it.
 * Without one the panel keeps only the Street View link, which needs no key.
 */
function StreetImage({ latitude, longitude }: { latitude: number, longitude: number }) {
  const token = import.meta.env.VITE_MAPILLARY_TOKEN as string | undefined

  const image = useResource(async () => {
    const delta = 0.0012
    const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta].join(",")
    const response = await fetch(
      `https://graph.mapillary.com/images?access_token=${token}&fields=id,thumb_1024_url,captured_at&bbox=${bbox}&limit=1`,
    )
    if (!response.ok) throw new Error("Mapillary indisponível")
    const body = await response.json() as { data?: { id: string, thumb_1024_url: string, captured_at: number }[] }
    return body.data?.[0] ?? null
  }, [latitude, longitude], { enabled: Boolean(token) })

  if (!token || !image.data) return null

  return (
    <a href={`https://www.mapillary.com/app/?pKey=${image.data.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-sm border border-line">
      <img src={image.data.thumb_1024_url} alt="Foto da rua próxima ao local da ocorrência" className="h-48 w-full object-cover" loading="lazy" />
      <span className="block bg-surface-muted px-3 py-1 text-xs text-ink-muted">
        Mapillary · capturada em {new Date(image.data.captured_at).toLocaleDateString("pt-BR")}
      </span>
    </a>
  )
}

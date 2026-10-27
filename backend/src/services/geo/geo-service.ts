import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../errors/index.js";
import { AiClient, GraphBounds } from "../ai/ai-client.js";

/// Small time-bounded memo. Geocoding and weather are public services with
/// fair-use limits; a console refreshing every few seconds must not hammer them.
class TtlCache<T> {
  private entries = new Map<string, { value: T, expires: number }>()

  constructor(private ttlMs: number, private maxEntries = 500) { }

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires < Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T) {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs })
  }
}

export interface Place {
  label: string,
  street: string | null,
  number: string | null,
  district: string | null,
  city: string | null,
  postcode: string | null,
  kind: string | null,
  latitude: number,
  longitude: number
}

export interface Point {
  latitude: number,
  longitude: number
}

export interface Weather {
  observed_at: string,
  temperature_c: number,
  humidity_percent: number,
  precipitation_mm: number,
  wind_speed_kmh: number,
  wind_gusts_kmh: number,
  /// Direction the wind comes FROM, in degrees, as meteorology reports it.
  wind_direction_deg: number,
  weather_code: number
}

/// A route from an independent engine (OSRM over the same OpenStreetMap data),
/// used as an outside yardstick for the model's own estimate.
export interface ReferenceRoute {
  source: "OSRM",
  distance_meters: number,
  duration_seconds: number,
  /// [latitude, longitude] pairs, the same order as the AI's geometry.
  geometry: [number, number][]
}

const searchCache = new TtlCache<Place[]>(10 * 60_000)
const referenceCache = new TtlCache<ReferenceRoute | null>(30 * 60_000)
const weatherCache = new TtlCache<Weather>(10 * 60_000)
let boundsCache: { value: GraphBounds | null, expires: number } | null = null

async function fetchJson(url: string, service: string): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": env.GEO_USER_AGENT, "Accept": "application/json" },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new ServiceUnavailableError(`${service} answered with status ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error
    throw new ServiceUnavailableError(`${service} is unreachable`)
  } finally {
    clearTimeout(timeout)
  }
}

/// The street network's extent, so a search for "Rua XV de Novembro" returns
/// the one in Taubate and not the one in every other city of Brazil.
async function networkBounds(): Promise<GraphBounds | null> {
  if (boundsCache && boundsCache.expires > Date.now()) {
    return boundsCache.value
  }
  try {
    const info = await new AiClient().getModelInfo()
    // Null while the AI is still loading the graph: retry soon instead of
    // searching the whole country for an hour.
    boundsCache = { value: info.bounds, expires: Date.now() + (info.bounds ? 60 * 60_000 : 30_000) }
  } catch {
    // Without the AI service the search still works, just unbounded.
    boundsCache = { value: null, expires: Date.now() + 60_000 }
  }
  return boundsCache.value
}

function toPlace(feature: any): Place {
  const p = feature.properties ?? {}
  const [longitude, latitude] = feature.geometry.coordinates
  const street = p.street ?? (p.type === "street" ? p.name : null) ?? null
  const head = p.type === "street" || p.type === "house"
    ? [street, p.housenumber].filter(Boolean).join(", ")
    : [p.name, street && street !== p.name ? street : null].filter(Boolean).join(", ")
  const tail = [p.district ?? p.locality, p.city].filter(Boolean).join(" · ")

  return {
    label: [head || p.name, tail].filter(Boolean).join(" — "),
    street,
    number: p.housenumber ?? null,
    district: p.district ?? p.locality ?? null,
    city: p.city ?? null,
    postcode: p.postcode ?? null,
    kind: p.osm_value ?? null,
    latitude,
    longitude
  }
}

export class GeoService {
  /// Address autocomplete, through Photon (OpenStreetMap data, no key).
  async search(query: string, limit: number): Promise<{ places: Place[] }> {
    const bounds = await networkBounds()
    const key = `${query.toLowerCase()}|${limit}`
    const cached = searchCache.get(key)
    if (cached) return { places: cached }

    const params = new URLSearchParams({ q: query, limit: String(limit * 3), lang: "default" })
    if (bounds) {
      params.set("bbox", [bounds.min_longitude, bounds.min_latitude, bounds.max_longitude, bounds.max_latitude].join(","))
      params.set("lat", String((bounds.min_latitude + bounds.max_latitude) / 2))
      params.set("lon", String((bounds.min_longitude + bounds.max_longitude) / 2))
    }

    const payload = await fetchJson(`${env.GEOCODER_URL}/api/?${params}`, "The geocoder")
    // OSM splits a long avenue into many ways, and Photon returns each one.
    // Ways that share the address and the postcode are the same place to a
    // dispatcher; a different postcode is a different stretch, worth keeping.
    const seen = new Set<string>()
    const places: Place[] = (payload.features ?? [])
      .map(toPlace)
      .filter((place: Place) => {
        const key = `${place.label}|${place.postcode ?? ""}`
        return !seen.has(key) && Boolean(seen.add(key))
      })
      .slice(0, limit)
    searchCache.set(key, places)
    return { places }
  }

  /// The address under a point clicked on the map.
  async reverse(latitude: number, longitude: number): Promise<{ place: Place | null }> {
    const key = `reverse|${latitude.toFixed(5)}|${longitude.toFixed(5)}`
    const cached = searchCache.get(key)
    if (cached) return { place: cached[0] ?? null }

    const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude), lang: "default" })
    const payload = await fetchJson(`${env.GEOCODER_URL}/reverse?${params}`, "The geocoder")
    const places: Place[] = (payload.features ?? []).map(toPlace)
    searchCache.set(key, places)
    return { place: places[0] ?? null }
  }

  /// The same trip through the public OSRM demo server. Null when OSRM finds
  /// no road between the points, which is an answer, not an outage.
  async referenceRoute(origin: Point, destination: Point): Promise<{ route: ReferenceRoute | null }> {
    const key = [origin.latitude, origin.longitude, destination.latitude, destination.longitude].map((value) => value.toFixed(5)).join("|")
    const cached = referenceCache.get(key)
    if (cached !== undefined) return { route: cached }

    // OSRM takes longitude first.
    const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`
    const payload = await fetchJson(
      `${env.ROUTER_URL}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&alternatives=false&steps=false`,
      "The reference router"
    )

    const best = payload.code === "Ok" ? payload.routes?.[0] : null
    const route: ReferenceRoute | null = best ? {
      source: "OSRM",
      distance_meters: Math.round(best.distance),
      duration_seconds: Math.round(best.duration),
      geometry: (best.geometry?.coordinates ?? []).map(([longitude, latitude]: [number, number]) => [latitude, longitude])
    } : null
    referenceCache.set(key, route)
    return { route }
  }

  /// Current conditions at a point, through Open-Meteo (no key). Wind matters
  /// for a vegetation fire or a gas leak; rain for the road surface.
  async weather(latitude: number, longitude: number): Promise<{ weather: Weather }> {
    // Weather does not change across a few hundred metres: rounding the key
    // to ~1 km lets every occurrence in a neighbourhood share one request.
    const key = `${latitude.toFixed(2)}|${longitude.toFixed(2)}`
    const cached = weatherCache.get(key)
    if (cached) return { weather: cached }

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      timezone: "America/Sao_Paulo"
    })
    const payload = await fetchJson(`${env.WEATHER_URL}/v1/forecast?${params}`, "The weather service")
    const current = payload.current

    const weather: Weather = {
      observed_at: current.time,
      temperature_c: current.temperature_2m,
      humidity_percent: current.relative_humidity_2m,
      precipitation_mm: current.precipitation,
      wind_speed_kmh: current.wind_speed_10m,
      wind_gusts_kmh: current.wind_gusts_10m,
      wind_direction_deg: current.wind_direction_10m,
      weather_code: current.weather_code
    }
    weatherCache.set(key, weather)
    return { weather }
  }
}

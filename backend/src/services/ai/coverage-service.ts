import { prisma } from "../../config/prisma.js";
import { AiClient, GeoPoint } from "./ai-client.js";

const MAX_ORIGINS = 50

interface CoverageRequest {
  minutes: number[],
  critical_mode?: boolean,
  /// Restrict the map to these stations; all operational ones otherwise.
  unit_ids?: string[],
  /// Hypothetical stations for the "what if we opened a post here" study.
  extra_stations?: (GeoPoint & { label?: string })[],
  /// How many recent occurrences to test against the areas.
  sample_size: number
}

/// Response-time coverage of the stations, measured against real demand.
///
/// The areas come from the AI service (predicted travel time over the street
/// graph). The question a commander actually asks is "how many of our calls
/// can we reach in 8 minutes", so the most recent occurrences are sent along
/// and counted by travel time, not by testing the drawn polygon.
export class CoverageService {
  async execute({ minutes, critical_mode = false, unit_ids, extra_stations = [], sample_size }: CoverageRequest) {

    const units = await prisma.unit.findMany({
      where: {
        active: true,
        // Command levels are offices; only posts and subgroups house vehicles.
        type: { in: ["POSTO", "SUBGRUPAMENTO"] },
        ...(unit_ids?.length && { id: { in: unit_ids } })
      },
      select: { id: true, acronym: true, name: true, latitude: true, longitude: true },
      orderBy: { acronym: "asc" }
    })

    const occurrences = sample_size > 0
      ? await prisma.occurrence.findMany({
        where: { status: { not: "CANCELADA" } },
        select: { id: true, latitude: true, longitude: true, priority: true, nature: true },
        orderBy: { opened_at: "desc" },
        take: sample_size
      })
      : []

    // The AI takes at most 50 origins. Hypothetical posts are what the user is
    // asking about, so they are kept and the real ones fill the rest.
    const realSlots = MAX_ORIGINS - extra_stations.length
    const stations = [
      ...units.slice(0, realSlots).map((unit) => ({
        id: unit.id,
        acronym: unit.acronym,
        name: unit.name,
        latitude: Number(unit.latitude),
        longitude: Number(unit.longitude),
        hypothetical: false
      })),
      ...extra_stations.map((station, index) => ({
        id: `hypothetical-${index + 1}`,
        acronym: station.label ?? `NOVO-${index + 1}`,
        name: station.label ?? `Posto hipotético ${index + 1}`,
        latitude: station.latitude,
        longitude: station.longitude,
        hypothetical: true
      }))
    ]

    if (stations.length === 0) {
      return { critical_mode, minutes, stations: [], isochrones: [], demand: null, model_version: null }
    }

    const result = await new AiClient().isochrones(
      stations.map(({ latitude, longitude }) => ({ latitude, longitude })),
      minutes,
      {
        critical_mode,
        ...(occurrences.length > 0 && {
          points: occurrences.map((occurrence) => ({
            latitude: Number(occurrence.latitude),
            longitude: Number(occurrence.longitude)
          }))
        })
      }
    )

    const skipped = new Set(result.skipped_origins)

    return {
      critical_mode,
      minutes: result.isochrones.map((area) => area.minutes),
      model_version: result.model_version,
      stations: stations.map((station, index) => ({ ...station, in_network: !skipped.has(index) })),
      isochrones: result.isochrones,
      demand: result.points
        ? {
          sample_size: occurrences.length,
          covered: result.points.covered,
          points: occurrences.map((occurrence, index) => ({
            id: occurrence.id,
            latitude: Number(occurrence.latitude),
            longitude: Number(occurrence.longitude),
            priority: occurrence.priority,
            nature: occurrence.nature,
            time_seconds: result.points!.times_seconds[index] ?? null
          }))
        }
        : null
    }
  }
}

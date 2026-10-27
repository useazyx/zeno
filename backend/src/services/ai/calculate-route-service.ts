import { Prisma, Route } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../errors/index.js";
import { AiClient, Closure } from "./ai-client.js";
import { recordOccurrenceEvents } from "../occurrence/occurrence-events.js";
import { getRouteWeather } from "../geo/route-weather-service.js";

interface CalculateRouteRequest {
  origin_latitude?: number,
  origin_longitude?: number,
  /// Alternative to raw coordinates: depart from a unit's address.
  origin_unit_id?: string,
  destination_latitude: number,
  destination_longitude: number,
  /// When given, the result is stored and linked to the dispatch.
  dispatch_id?: string,
  /// Enables the constrained emergency-operational routing profile.
  critical_mode?: boolean,
  /// Streets reported blocked; avoided for this calculation only.
  closures?: Closure[]
  trace?: boolean
}

export class CalculateRouteService {
  async execute(data: CalculateRouteRequest): Promise<{
    routes: Route[] | null,
    neural: unknown,
    critical: unknown,
    shortest: unknown,
    critical_mode: boolean,
    closures: { count: number, blocked_edges: number },
    model_version?: string | null,
    weather?: Awaited<ReturnType<typeof getRouteWeather>>
  }> {

    const origin = await this.resolveOrigin(data)

    const destination = {
      latitude: data.destination_latitude,
      longitude: data.destination_longitude
    }

    let occurrenceId: string | null = null

    if (data.dispatch_id) {
      const dispatch = await prisma.dispatch.findUnique({
        where: { id: data.dispatch_id },
        select: { id: true, occurrence_id: true }
      })

      if (!dispatch) {
        throw new NotFoundError("Dispatch not found")
      }

      occurrenceId = dispatch.occurrence_id

    }

    const [result, weather] = await Promise.all([
      new AiClient().calculateRoute(origin, destination, {
        critical_mode: data.critical_mode ?? false,
        closures: data.closures,
        ...(data.trace ? { trace: true } : {}),
      }),
      getRouteWeather(destination.latitude, destination.longitude),
    ])

    // Without a dispatch this is an exploratory query (the "what would the
    // route be" case), so nothing is persisted.
    if (!data.dispatch_id) {
      return {
        routes: null,
        neural: result.neural,
        critical: result.critical,
        shortest: result.shortest,
        critical_mode: result.critical_mode,
        closures: result.closures,
        model_version: result.model_version,
        ...(weather ? { weather } : {}),
      }
    }

    const variants = [
      { algorithm: "NEURAL" as const, variant: result.neural },
      ...(result.critical
        ? [{ algorithm: "CRITICAL" as const, variant: result.critical }]
        : []),
      { algorithm: "DIJKSTRA" as const, variant: result.shortest },
    ]

    const rows = variants.map(({ algorithm, variant }) => ({
      algorithm,
      dispatch_id: data.dispatch_id!,
      origin_latitude: new Prisma.Decimal(origin.latitude),
      origin_longitude: new Prisma.Decimal(origin.longitude),
      destination_latitude: new Prisma.Decimal(destination.latitude),
      destination_longitude: new Prisma.Decimal(destination.longitude),
      distance_meters: variant.distance_meters,
      estimated_time_seconds: variant.estimated_time_seconds,
      node_count: variant.node_count,
      geometry: variant.geometry,
      steps: variant.steps,
      segments: variant.segments,
      model_version: result.model_version
    }))

    await prisma.route.createMany({ data: rows })

    const routes = await prisma.route.findMany({
      where: { dispatch_id: data.dispatch_id },
      orderBy: { created_at: "desc" },
      take: variants.length
    })

    const usedAlgorithm = result.critical_mode ? "CRITICAL" : "NEURAL"
    const usedRoute = routes.find((route) => route.algorithm === usedAlgorithm)
    if (usedRoute) {
      await prisma.dispatch.update({
        where: { id: data.dispatch_id },
        data: {
          used_route_id: usedRoute.id,
          critical_mode: result.critical_mode,
        }
      })

      await recordOccurrenceEvents([{
        occurrence_id: occurrenceId!,
        dispatch_id: data.dispatch_id,
        type: "ROTA",
        to_value: usedRoute.algorithm,
        message: result.closures.count > 0 ? `closures:${result.closures.count}` : null
      }])
    }

    return {
      routes,
      neural: result.neural,
      critical: result.critical,
      shortest: result.shortest,
      critical_mode: result.critical_mode,
      closures: result.closures,
      model_version: result.model_version,
      ...(weather ? { weather } : {}),
    }
  }

  private async resolveOrigin(data: CalculateRouteRequest) {
    if (data.origin_unit_id) {
      const unit = await prisma.unit.findUnique({
        where: { id: data.origin_unit_id },
        select: { latitude: true, longitude: true }
      })

      if (!unit) {
        throw new NotFoundError("Origin unit not found")
      }

      return { latitude: Number(unit.latitude), longitude: Number(unit.longitude) }
    }

    return {
      latitude: data.origin_latitude!,
      longitude: data.origin_longitude!
    }
  }
}

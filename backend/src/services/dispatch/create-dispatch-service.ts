import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError } from "../../errors/index.js";
import { eventHub } from "../../realtime/event-hub.js";
import { AiClient } from "../ai/ai-client.js";
import { recordOccurrenceEvents } from "../occurrence/occurrence-events.js";

interface CreateDispatchRequest {
  occurrence_id: string,
  vehicle_id: string,
  crew_id?: string,
  critical_mode?: boolean
}

export class CreateDispatchService {
  async execute({ occurrence_id, vehicle_id, crew_id, critical_mode = false }: CreateDispatchRequest) {

    const occurrence = await prisma.occurrence.findUnique({
      where: { id: occurrence_id },
      select: {
        id: true, status: true, protocol: true, priority: true,
        latitude: true, longitude: true
      }
    })

    if (!occurrence) {
      throw new NotFoundError("Occurrence not found")
    }

    if (occurrence.status === "ENCERRADA" || occurrence.status === "CANCELADA") {
      throw new ConflictError(`Occurrence ${occurrence.protocol} is already ${occurrence.status}`)
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicle_id },
      select: {
        id: true, prefix: true, status: true,
        current_latitude: true, current_longitude: true,
        unit: { select: { latitude: true, longitude: true } }
      }
    })

    if (!vehicle) {
      throw new NotFoundError("Vehicle not found")
    }

    if (vehicle.status !== "DISPONIVEL") {
      throw new ConflictError(`Vehicle ${vehicle.prefix} is ${vehicle.status}`)
    }

    if (crew_id) {
      const crew = await prisma.crew.findUnique({
        where: { id: crew_id },
        select: { id: true, active: true, vehicle_id: true }
      })

      if (!crew) {
        throw new NotFoundError("Crew not found")
      }

      if (!crew.active) {
        throw new ConflictError("This crew is no longer on duty")
      }

      if (crew.vehicle_id !== vehicle_id) {
        throw new ConflictError("This crew is not assigned to the given vehicle")
      }
    }

    // Creating the dispatch, occupying the vehicle and advancing the occurrence
    // must happen together, or a crash in between would leave a vehicle marked
    // busy with nothing to attend.
    const dispatch = await prisma.$transaction(async (tx) => {
      const created = await tx.dispatch.create({
        data: {
          occurrence_id,
          vehicle_id,
          crew_id: crew_id ?? null,
          critical_mode,
        }
      })

      await tx.vehicle.update({
        where: { id: vehicle_id },
        data: { status: "EMPENHADA" }
      })

      if (occurrence.status === "ABERTA") {
        await tx.occurrence.update({
          where: { id: occurrence_id },
          data: { status: "DESPACHADA" }
        })
      }

      return created
    })

    await recordOccurrenceEvents([
      {
        occurrence_id,
        dispatch_id: dispatch.id,
        type: "DESPACHO",
        message: vehicle.prefix,
        to_value: dispatch.status
      },
      ...(occurrence.status === "ABERTA"
        ? [{ occurrence_id, type: "STATUS" as const, from_value: "ABERTA", to_value: "DESPACHADA" }]
        : []),
    ])

    eventHub.publish({
      type: "dispatch.created",
      payload: {
        id: dispatch.id,
        occurrence_id,
        vehicle_id,
        vehicle_prefix: vehicle.prefix,
        status: dispatch.status
      }
    })

    // The route is valuable but not essential: an AI outage must never stop a
    // vehicle from being sent. It is computed after the transaction commits and
    // its failure is recorded, not propagated.
    const routes = await this.attachRoutes(
      dispatch.id,
      occurrence_id,
      vehicle,
      occurrence,
      critical_mode,
    )

    return { dispatch, routes }
  }

  private async attachRoutes(
    dispatchId: string,
    occurrenceId: string,
    vehicle: { current_latitude: Prisma.Decimal | null, current_longitude: Prisma.Decimal | null, unit: { latitude: Prisma.Decimal, longitude: Prisma.Decimal } },
    occurrence: { latitude: Prisma.Decimal, longitude: Prisma.Decimal },
    criticalMode: boolean,
  ) {
    // Departure point is where the vehicle actually is, falling back to its station.
    const origin = {
      latitude: Number(vehicle.current_latitude ?? vehicle.unit.latitude),
      longitude: Number(vehicle.current_longitude ?? vehicle.unit.longitude)
    }

    const destination = {
      latitude: Number(occurrence.latitude),
      longitude: Number(occurrence.longitude)
    }

    try {
      const result = await new AiClient().calculateRoute(origin, destination, {
        critical_mode: criticalMode
      })

      const variants = [
        { algorithm: "NEURAL" as const, variant: result.neural },
        ...(result.critical
          ? [{ algorithm: "CRITICAL" as const, variant: result.critical }]
          : []),
        { algorithm: "DIJKSTRA" as const, variant: result.shortest },
      ]

      const rows = variants.map(({ algorithm, variant }) => ({
        algorithm,
        dispatch_id: dispatchId,
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

      const persisted = await prisma.route.findMany({
        where: { dispatch_id: dispatchId },
        orderBy: { created_at: "desc" },
        take: variants.length
      })

      const usedAlgorithm = result.critical_mode ? "CRITICAL" : "NEURAL"
      const usedRoute = persisted.find((route) => route.algorithm === usedAlgorithm)
      if (usedRoute) {
        await prisma.dispatch.update({
          where: { id: dispatchId },
          data: { used_route_id: usedRoute.id }
        })

        await recordOccurrenceEvents([{
          occurrence_id: occurrenceId,
          dispatch_id: dispatchId,
          type: "ROTA",
          to_value: usedRoute.algorithm
        }])
      }

      return persisted
    } catch (error) {
      console.error(`Route calculation failed for dispatch ${dispatchId}:`, error)
      return []
    }
  }
}

import { Prisma, Vehicle, VehicleStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors/index.js";
import { eventHub } from "../../realtime/event-hub.js";
import { haversineMeters } from "../../utils/geo.js";
import { vehicleAppearanceSchema, type VehicleAppearance } from "./vehicle-appearance.js";
import { POSITION_MIN_DISTANCE_METERS, POSITION_MIN_INTERVAL_MS } from "./vehicle-position-policy.js";

interface UpdateVehicleRequest {
  id: string,
  prefix?: string,
  plate?: string,
  model?: string,
  year?: number,
  water_capacity_liters?: number | null,
  crew_capacity?: number,
  status?: VehicleStatus,
  current_latitude?: number,
  current_longitude?: number,
  heading?: number | null,
  appearance?: VehicleAppearance | null,
  unit_id?: string
}

export class UpdateVehicleService {
  async execute({ id, prefix, plate, current_latitude, current_longitude, heading, appearance, unit_id, ...rest }: UpdateVehicleRequest): Promise<Vehicle> {

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      select: { id: true, status: true, type: true }
    })

    if (!vehicle) {
      throw new NotFoundError("Vehicle not found")
    }

    // Uma ambulância não pode receber a carroceria de uma escada mecânica.
    if (appearance !== undefined && appearance !== null) {
      vehicleAppearanceSchema.parse(appearance)
      if (appearance.variant !== "default" && appearance.variant !== vehicle.type) {
        throw new BadRequestError("A aparência deve corresponder ao tipo da viatura.")
      }
    }

    if (prefix || plate) {
      const duplicate = await prisma.vehicle.findFirst({
        where: {
          id: { not: id },
          OR: [
            ...(prefix ? [{ prefix }] : []),
            ...(plate ? [{ plate }] : [])
          ]
        },
        select: { prefix: true }
      })

      if (duplicate) {
        throw new ConflictError(`A vehicle with this ${duplicate.prefix === prefix ? "prefix" : "plate"} is already registered`)
      }
    }

    // A vehicle currently assigned to an open dispatch cannot be sent to the
    // workshop without first releasing it, or the dispatch would be orphaned.
    if (rest.status && rest.status !== "EMPENHADA" && vehicle.status === "EMPENHADA") {
      const openDispatch = await prisma.dispatch.findFirst({
        where: {
          vehicle_id: id,
          status: { notIn: ["FINALIZADO", "CANCELADO"] }
        },
        select: { id: true }
      })

      if (openDispatch) {
        throw new ConflictError("This vehicle is assigned to an open dispatch. Finish or cancel it first.")
      }
    }

    if (unit_id) {
      const unit = await prisma.unit.findUnique({ where: { id: unit_id }, select: { id: true } })

      if (!unit) {
        throw new NotFoundError("Unit not found")
      }
    }

    const data: Prisma.VehicleUncheckedUpdateInput = {
        ...rest,
        ...(prefix && { prefix }),
        ...(plate && { plate }),
        ...(unit_id && { unit_id }),
        ...(appearance !== undefined && { appearance: appearance === null ? Prisma.DbNull : appearance }),
        ...(current_latitude !== undefined && { current_latitude: new Prisma.Decimal(current_latitude) }),
        ...(current_longitude !== undefined && { current_longitude: new Prisma.Decimal(current_longitude) })
    }

    const hasPosition = current_latitude !== undefined || current_longitude !== undefined
    const updated = hasPosition
      ? await prisma.$transaction(async (transaction) => {
        // Serializa relatórios concorrentes da mesma viatura antes de deduplicar.
        await transaction.$queryRaw`SELECT id FROM vehicle WHERE id = ${id} FOR UPDATE`
        const current = await transaction.vehicle.findUniqueOrThrow({ where: { id } })
        const latitude = current_latitude ?? (current.current_latitude === null ? null : Number(current.current_latitude))
        const longitude = current_longitude ?? (current.current_longitude === null ? null : Number(current.current_longitude))
        if (latitude === null || longitude === null) {
          return transaction.vehicle.update({ where: { id }, data })
        }
        const recordedAt = new Date()
        const previous = await transaction.vehiclePosition.findFirst({
          where: { vehicle_id: id }, orderBy: [{ recorded_at: "desc" }, { id: "desc" }]
        })
        const isRepeated = previous
          && recordedAt.getTime() - previous.recorded_at.getTime() < POSITION_MIN_INTERVAL_MS
          && haversineMeters({ latitude, longitude }, { latitude: Number(previous.latitude), longitude: Number(previous.longitude) }) < POSITION_MIN_DISTANCE_METERS
        if (!isRepeated) {
          const dispatch = await transaction.dispatch.findFirst({
            where: { vehicle_id: id, status: { notIn: ["FINALIZADO", "CANCELADO"] } },
            orderBy: { dispatched_at: "desc" }, select: { id: true }
          })
          await transaction.vehiclePosition.create({ data: {
            vehicle_id: id,
            latitude: new Prisma.Decimal(latitude), longitude: new Prisma.Decimal(longitude),
            heading: heading ?? null, dispatch_id: dispatch?.id ?? null, recorded_at: recordedAt
          } })
        }
        // Mesmo um ponto descartado comprova que o terminal continua conectado.
        return transaction.vehicle.update({ where: { id }, data: { ...data, last_position_at: recordedAt } })
      })
      : await prisma.vehicle.update({ where: { id }, data })

    // A position report from the vehicle terminal moves the marker on every
    // console without waiting for a refresh.
    if (hasPosition && updated.last_position_at && updated.current_latitude !== null && updated.current_longitude !== null) {
      eventHub.publish({
        type: "vehicle.moved",
        payload: {
          id: updated.id,
          prefix: updated.prefix,
          latitude: String(updated.current_latitude),
          longitude: String(updated.current_longitude),
          recorded_at: updated.last_position_at.toISOString(),
          heading: heading ?? null
        }
      })
    }

    return updated
  }
}

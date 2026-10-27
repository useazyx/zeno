import { Occurrence, OccurrenceNature, OccurrencePriority, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError } from "../../errors/index.js";
import { eventHub } from "../../realtime/event-hub.js";
import { recordOccurrenceEvents } from "./occurrence-events.js";

interface CreateOccurrenceRequest {
  nature: OccurrenceNature,
  priority: OccurrencePriority,
  description: string,
  address: string,
  latitude: number,
  longitude: number,
  caller_name?: string,
  caller_phone?: string,
  unit_id: string
}

export class CreateOccurrenceService {
  async execute(data: CreateOccurrenceRequest): Promise<Occurrence> {

    const unit = await prisma.unit.findUnique({
      where: { id: data.unit_id },
      select: { id: true, active: true }
    })

    if (!unit) {
      throw new NotFoundError("Unit not found")
    }

    if (!unit.active) {
      throw new ConflictError("Cannot open an occurrence for an inactive unit")
    }

    const occurrence = await prisma.occurrence.create({
      data: {
        ...data,
        protocol: await this.nextProtocol(),
        latitude: new Prisma.Decimal(data.latitude),
        longitude: new Prisma.Decimal(data.longitude),
        caller_name: data.caller_name ?? null,
        caller_phone: data.caller_phone ?? null
      }
    })

    await recordOccurrenceEvents([{
      occurrence_id: occurrence.id,
      type: "ABERTURA",
      to_value: occurrence.priority
    }])

    eventHub.publish({
      type: "occurrence.created",
      payload: {
        id: occurrence.id,
        protocol: occurrence.protocol,
        nature: occurrence.nature,
        priority: occurrence.priority,
        address: occurrence.address,
        latitude: occurrence.latitude.toString(),
        longitude: occurrence.longitude.toString(),
        unit_id: occurrence.unit_id
      }
    })

    return occurrence
  }

  /// Protocols are sequential within the year, in the format `2026-000123`.
  /// Counting and inserting are not atomic, so a concurrent open could pick the
  /// same number; the unique index rejects it and we simply try the next one.
  private async nextProtocol(attempt = 0): Promise<string> {
    const year = new Date().getFullYear()

    const count = await prisma.occurrence.count({
      where: { protocol: { startsWith: `${year}-` } }
    })

    const candidate = `${year}-${String(count + 1 + attempt).padStart(6, "0")}`

    const taken = await prisma.occurrence.findUnique({
      where: { protocol: candidate },
      select: { id: true }
    })

    if (!taken) {
      return candidate
    }

    if (attempt >= 10) {
      throw new ConflictError("Could not allocate an occurrence protocol, please retry")
    }

    return this.nextProtocol(attempt + 1)
  }
}

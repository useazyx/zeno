import { Occurrence, OccurrencePriority, OccurrenceStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors/index.js";
import { eventHub } from "../../realtime/event-hub.js";
import { OccurrenceEventInput, recordOccurrenceEvents } from "./occurrence-events.js";

interface UpdateOccurrenceRequest {
  id: string,
  priority?: OccurrencePriority,
  status?: OccurrenceStatus,
  description?: string,
  address?: string
}

/// Allowed status transitions. An occurrence moves forward through the
/// attendance flow and can be cancelled only while nothing is under way.
const ALLOWED_TRANSITIONS: Record<OccurrenceStatus, OccurrenceStatus[]> = {
  ABERTA: ["DESPACHADA", "CANCELADA"],
  DESPACHADA: ["EM_ATENDIMENTO", "ENCERRADA", "CANCELADA"],
  EM_ATENDIMENTO: ["ENCERRADA"],
  ENCERRADA: [],
  CANCELADA: []
}

export class UpdateOccurrenceService {
  async execute({ id, status, ...rest }: UpdateOccurrenceRequest): Promise<Occurrence> {

    const occurrence = await prisma.occurrence.findUnique({
      where: { id },
      select: { id: true, status: true, protocol: true, priority: true }
    })

    if (!occurrence) {
      throw new NotFoundError("Occurrence not found")
    }

    if (status && status !== occurrence.status) {
      if (!ALLOWED_TRANSITIONS[occurrence.status].includes(status)) {
        throw new BadRequestError(`An occurrence cannot go from ${occurrence.status} to ${status}`)
      }

      if (status === "ENCERRADA") {
        const openDispatch = await prisma.dispatch.findFirst({
          where: { occurrence_id: id, status: { notIn: ["FINALIZADO", "CANCELADO"] } },
          select: { id: true }
        })

        if (openDispatch) {
          throw new ConflictError("There are still vehicles assigned to this occurrence")
        }
      }
    }

    const updated = await prisma.occurrence.update({
      where: { id },
      data: {
        ...rest,
        ...(status && { status }),
        ...(status === "ENCERRADA" && { closed_at: new Date() })
      }
    })

    const events: OccurrenceEventInput[] = []

    if (status && status !== occurrence.status) {
      events.push({ occurrence_id: id, type: "STATUS", from_value: occurrence.status, to_value: status })
    }

    if (rest.priority && rest.priority !== occurrence.priority) {
      events.push({ occurrence_id: id, type: "PRIORIDADE", from_value: occurrence.priority, to_value: rest.priority })
    }

    await recordOccurrenceEvents(events)

    if (status && status !== occurrence.status) {
      eventHub.publish({
        type: "occurrence.updated",
        payload: { id: updated.id, protocol: updated.protocol, status: updated.status }
      })
    }

    return updated
  }
}

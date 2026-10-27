import { Dispatch, DispatchStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../errors/index.js";
import { eventHub } from "../../realtime/event-hub.js";
import { recordOccurrenceEvents } from "../occurrence/occurrence-events.js";

interface UpdateDispatchRequest {
  id: string,
  status: DispatchStatus
}

/// The lifecycle of a vehicle sent to an incident. Cancelling is only possible
/// before the crew reaches the scene.
const ALLOWED_TRANSITIONS: Record<DispatchStatus, DispatchStatus[]> = {
  DESPACHADO: ["A_CAMINHO", "CANCELADO"],
  A_CAMINHO: ["NO_LOCAL", "CANCELADO"],
  NO_LOCAL: ["RETORNANDO", "FINALIZADO"],
  RETORNANDO: ["FINALIZADO"],
  FINALIZADO: [],
  CANCELADO: []
}

const CLOSING_STATUSES: DispatchStatus[] = ["FINALIZADO", "CANCELADO"]

export class UpdateDispatchService {
  async execute({ id, status }: UpdateDispatchRequest): Promise<Dispatch> {

    const dispatch = await prisma.dispatch.findUnique({
      where: { id },
      select: { id: true, status: true, vehicle_id: true, occurrence_id: true }
    })

    if (!dispatch) {
      throw new NotFoundError("Dispatch not found")
    }

    if (status === dispatch.status) {
      return prisma.dispatch.findUniqueOrThrow({ where: { id } })
    }

    if (!ALLOWED_TRANSITIONS[dispatch.status].includes(status)) {
      throw new BadRequestError(`A dispatch cannot go from ${dispatch.status} to ${status}`)
    }

    let occurrenceStarted = false

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.dispatch.update({
        where: { id },
        data: {
          status,
          ...(status === "NO_LOCAL" && { arrived_at: new Date() }),
          ...(CLOSING_STATUSES.includes(status) && { finished_at: new Date() })
        }
      })

      // Releasing the vehicle is what makes it dispatchable again, so it has to
      // land in the same transaction as the status change.
      if (CLOSING_STATUSES.includes(status)) {
        await tx.vehicle.update({
          where: { id: dispatch.vehicle_id },
          data: { status: "DISPONIVEL" }
        })
      }

      // The first crew to arrive moves the whole occurrence into attendance.
      if (status === "NO_LOCAL") {
        const started = await tx.occurrence.updateMany({
          where: { id: dispatch.occurrence_id, status: "DESPACHADA" },
          data: { status: "EM_ATENDIMENTO" }
        })
        occurrenceStarted = (started?.count ?? 0) > 0
      }

      return result
    })

    await recordOccurrenceEvents([
      {
        occurrence_id: dispatch.occurrence_id,
        dispatch_id: id,
        type: "DESPACHO_STATUS",
        from_value: dispatch.status,
        to_value: status
      },
      ...(occurrenceStarted
        ? [{ occurrence_id: dispatch.occurrence_id, type: "STATUS" as const, from_value: "DESPACHADA", to_value: "EM_ATENDIMENTO" }]
        : []),
    ])

    eventHub.publish({
      type: "dispatch.updated",
      payload: { id: updated.id, occurrence_id: updated.occurrence_id, status: updated.status }
    })

    return updated
  }
}

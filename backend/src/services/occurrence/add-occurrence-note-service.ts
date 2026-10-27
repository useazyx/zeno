import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../errors/index.js";
import { eventHub } from "../../realtime/event-hub.js";

interface AddOccurrenceNoteRequest {
  occurrence_id: string,
  message: string,
  dispatch_id?: string
}

/// A free-text line in the occurrence log: "victim conscious", "second floor
/// collapsed", "gas company called". It is the narrative a CAD keeps next to
/// the structured status changes. Unlike system events, a note failing to save
/// is an error the dispatcher must see, so it is not swallowed.
export class AddOccurrenceNoteService {
  async execute({ occurrence_id, message, dispatch_id }: AddOccurrenceNoteRequest) {

    const occurrence = await prisma.occurrence.findUnique({
      where: { id: occurrence_id },
      select: { id: true }
    })

    if (!occurrence) {
      throw new NotFoundError("Occurrence not found")
    }

    if (dispatch_id) {
      const dispatch = await prisma.dispatch.findFirst({
        where: { id: dispatch_id, occurrence_id },
        select: { id: true }
      })

      if (!dispatch) {
        throw new NotFoundError("Dispatch not found in this occurrence")
      }
    }

    const event = await prisma.occurrenceEvent.create({
      data: {
        occurrence_id,
        dispatch_id: dispatch_id ?? null,
        type: "NOTA",
        message: message.trim()
      }
    })

    eventHub.publish({ type: "occurrence.timeline", payload: { occurrence_id } })

    return event
  }
}

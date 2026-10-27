import { OccurrenceEventType } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { eventHub } from "../../realtime/event-hub.js";

export interface OccurrenceEventInput {
  occurrence_id: string,
  type: OccurrenceEventType,
  dispatch_id?: string | null,
  message?: string | null,
  from_value?: string | null,
  to_value?: string | null
}

/// Appends lines to an occurrence's timeline.
///
/// The timeline documents the operation; it is not the operation. Writing it
/// happens after the change it describes has committed, and a failure here is
/// logged instead of thrown, so a hiccup in the log can never turn a vehicle
/// that was actually sent into an error on the dispatcher's screen.
export async function recordOccurrenceEvents(events: OccurrenceEventInput[]): Promise<void> {
  if (events.length === 0) {
    return
  }

  try {
    await prisma.occurrenceEvent.createMany({
      data: events.map((event) => ({
        occurrence_id: event.occurrence_id,
        type: event.type,
        dispatch_id: event.dispatch_id ?? null,
        message: event.message ?? null,
        from_value: event.from_value ?? null,
        to_value: event.to_value ?? null
      }))
    })

    for (const occurrenceId of new Set(events.map((event) => event.occurrence_id))) {
      eventHub.publish({ type: "occurrence.timeline", payload: { occurrence_id: occurrenceId } })
    }
  } catch (error) {
    console.error("Could not record the occurrence timeline:", error)
  }
}

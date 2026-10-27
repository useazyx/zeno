import { OccurrenceEventType } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../errors/index.js";

export interface TimelineEntry {
  id: string,
  type: OccurrenceEventType,
  at: Date,
  message: string | null,
  from_value: string | null,
  to_value: string | null,
  dispatch_id: string | null,
  vehicle_prefix: string | null,
  /// True when the line was reconstructed from the record's own timestamps
  /// rather than logged as it happened (history older than the log).
  derived: boolean
}

/// Everything that happened in an occurrence, in order.
///
/// Logged events are the source of truth. Occurrences opened before the log
/// existed still carry their milestones as timestamps (opened, dispatched,
/// arrived, finished, closed), so those are rebuilt for any moment the log has
/// no line for. A milestone is never shown twice.
export class GetOccurrenceTimelineService {
  async execute(id: string): Promise<{ events: TimelineEntry[] }> {

    const occurrence = await prisma.occurrence.findUnique({
      where: { id },
      select: {
        id: true, status: true, priority: true, opened_at: true, closed_at: true,
        events: { orderBy: [{ created_at: "asc" }, { id: "asc" }] },
        dispatches: {
          select: {
            id: true, status: true, dispatched_at: true, arrived_at: true, finished_at: true,
            vehicle: { select: { prefix: true } }
          }
        }
      }
    })

    if (!occurrence) {
      throw new NotFoundError("Occurrence not found")
    }

    const prefixes = new Map(occurrence.dispatches.map((dispatch) => [dispatch.id, dispatch.vehicle.prefix]))

    const logged: TimelineEntry[] = occurrence.events.map((event) => ({
      id: event.id,
      type: event.type,
      at: event.created_at,
      message: event.message,
      from_value: event.from_value,
      to_value: event.to_value,
      dispatch_id: event.dispatch_id,
      vehicle_prefix: event.dispatch_id ? prefixes.get(event.dispatch_id) ?? null : null,
      derived: false
    }))

    const has = (type: OccurrenceEventType, dispatchId: string | null, toValue?: string) =>
      logged.some((entry) =>
        entry.type === type
        && entry.dispatch_id === dispatchId
        && (toValue === undefined || entry.to_value === toValue))

    const derived: TimelineEntry[] = []
    const add = (key: string, entry: Omit<TimelineEntry, "id" | "derived" | "message">) => {
      derived.push({ ...entry, id: `derived:${key}`, message: null, derived: true })
    }

    if (!has("ABERTURA", null)) {
      add(`${occurrence.id}:open`, {
        type: "ABERTURA", at: occurrence.opened_at,
        from_value: null, to_value: occurrence.priority, dispatch_id: null, vehicle_prefix: null
      })
    }

    for (const dispatch of occurrence.dispatches) {
      const prefix = dispatch.vehicle.prefix

      if (!has("DESPACHO", dispatch.id)) {
        add(`${dispatch.id}:sent`, {
          type: "DESPACHO", at: dispatch.dispatched_at,
          from_value: null, to_value: "DESPACHADO", dispatch_id: dispatch.id, vehicle_prefix: prefix
        })
      }

      if (dispatch.arrived_at && !has("DESPACHO_STATUS", dispatch.id, "NO_LOCAL")) {
        add(`${dispatch.id}:arrived`, {
          type: "DESPACHO_STATUS", at: dispatch.arrived_at,
          from_value: null, to_value: "NO_LOCAL", dispatch_id: dispatch.id, vehicle_prefix: prefix
        })
      }

      const closing = dispatch.status === "CANCELADO" ? "CANCELADO" : "FINALIZADO"
      if (dispatch.finished_at && !has("DESPACHO_STATUS", dispatch.id, closing)) {
        add(`${dispatch.id}:finished`, {
          type: "DESPACHO_STATUS", at: dispatch.finished_at,
          from_value: null, to_value: closing, dispatch_id: dispatch.id, vehicle_prefix: prefix
        })
      }
    }

    if (occurrence.closed_at && !has("STATUS", null, "ENCERRADA")) {
      add(`${occurrence.id}:closed`, {
        type: "STATUS", at: occurrence.closed_at,
        from_value: null, to_value: "ENCERRADA", dispatch_id: null, vehicle_prefix: null
      })
    }

    // Opening always reads first, even when a backfilled dispatch shares its
    // second; after that the clock decides.
    const events = [...logged, ...derived].sort((a, b) =>
      a.at.getTime() - b.at.getTime()
      || Number(b.type === "ABERTURA") - Number(a.type === "ABERTURA"))

    return { events }
  }
}

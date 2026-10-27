import { prisma } from "../../config/prisma.js";
import { OccurrenceNature, OccurrencePriority, OccurrenceStatus, Prisma } from "../../generated/prisma/client.js";

interface Request {
  from?: Date; to?: Date; status?: OccurrenceStatus; nature?: OccurrenceNature; priority?: OccurrencePriority;
  unit_id?: string; search?: string; route_recorded?: "yes" | "no";
  page: number; per_page: number;
}

export class ListOperationalRecordsService {
  async execute({ from, to, status, nature, priority, unit_id, search, route_recorded, page, per_page }: Request) {
    const where: Prisma.DispatchWhereInput = {
      occurrence: {
        ...(status && { status }), ...(nature && { nature }), ...(priority && { priority }),
        ...((from || to) && { opened_at: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
      },
      ...(unit_id && { vehicle: { unit_id } }),
      ...(route_recorded && { used_route_id: route_recorded === "yes" ? { not: null } : null }),
      ...(search && { OR: [
        { occurrence: { protocol: { contains: search, mode: "insensitive" } } },
        { vehicle: { prefix: { contains: search, mode: "insensitive" } } },
        { vehicle: { unit: { acronym: { contains: search, mode: "insensitive" } } } },
      ] }),
    };
    const [rows, total] = await Promise.all([
      prisma.dispatch.findMany({
        where, skip: (page - 1) * per_page, take: per_page,
        orderBy: [{ dispatched_at: "desc" }, { id: "desc" }],
        select: {
          id: true, occurrence_id: true, status: true, critical_mode: true,
          dispatched_at: true, arrived_at: true, finished_at: true,
          vehicle: { select: { prefix: true, unit: { select: { id: true, acronym: true } } } },
          occurrence: { select: { protocol: true, nature: true,
            dispatches: { where: { status: { not: "CANCELADO" } }, select: { vehicle: { select: { unit: { select: { acronym: true } } } } } },
          } },
          used_route: { select: { id: true, algorithm: true, distance_meters: true, estimated_time_seconds: true, model_version: true } },
        },
      }),
      prisma.dispatch.count({ where }),
    ]);
    return { total, page, per_page, items: rows.map((row) => {
      const travel = row.arrived_at ? (row.arrived_at.getTime() - row.dispatched_at.getTime()) / 1000 : null;
      return { id: row.id, occurrence_id: row.occurrence_id, protocol: row.occurrence.protocol,
        nature: row.occurrence.nature, unit_id: row.vehicle.unit.id, unit: row.vehicle.unit.acronym,
        participants: [...new Set(row.occurrence.dispatches.map((d) => d.vehicle.unit.acronym))].sort(),
        vehicle: row.vehicle.prefix, status: row.status, critical_mode: row.critical_mode,
        dispatched_at: row.dispatched_at, arrived_at: row.arrived_at, finished_at: row.finished_at,
        travel_seconds: travel !== null && travel >= 0 ? travel : null, route: row.used_route };
    }) };
  }
}

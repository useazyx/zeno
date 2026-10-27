import {
  OccurrenceNature,
  OccurrencePriority,
  OccurrenceStatus,
} from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { operationalStatistics } from "./operational-statistics.js";

interface GetOccurrenceStatisticsRequest {
  status?: OccurrenceStatus,
  nature?: OccurrenceNature,
  priority?: OccurrencePriority,
  from?: Date,
  to?: Date,
}

export class GetOccurrenceStatisticsService {
  async execute({ status, nature, priority, from, to }: GetOccurrenceStatisticsRequest) {
    const where = {
      ...(status && { status }),
      ...(nature && { nature }),
      ...(priority && { priority }),
      ...((from || to) && {
        opened_at: {
          ...(from && { gte: from }),
          ...(to && { lte: to }),
        },
      }),
    };

    // Loading a relation for 70k+ occurrences makes Prisma build an enormous
    // occurrence_id IN (...) query, which exceeds PostgreSQL's bind-parameter
    // ceiling. Read the flat occurrence rows and the first arrival aggregation
    // independently, then join them in memory by id.
    const [occurrences, arrivals, deployments] = await Promise.all([
      prisma.occurrence.findMany({
        where,
        orderBy: [{ opened_at: "asc" }, { id: "asc" }],
        select: {
          id: true,
          protocol: true,
          nature: true,
          priority: true,
          status: true,
          address: true,
          latitude: true,
          longitude: true,
          opened_at: true,
          closed_at: true,
          unit: {
            select: { id: true, acronym: true },
          },
        },
      }),
      prisma.dispatch.groupBy({
        by: ["occurrence_id"],
        where: { arrived_at: { not: null }, status: { not: "CANCELADO" }, occurrence: where },
        _min: { arrived_at: true },
      }),
      prisma.dispatch.findMany({
        where: { occurrence: where },
        select: {
          id: true, occurrence_id: true, status: true, critical_mode: true,
          dispatched_at: true, arrived_at: true, finished_at: true, crew_id: true,
          vehicle: { select: { id: true, prefix: true, unit: { select: { id: true, acronym: true } } } },
          used_route: { select: { id: true, algorithm: true, distance_meters: true, estimated_time_seconds: true, model_version: true } },
        },
      }),
    ]);

    const firstArrivalByOccurrence = new Map(
      arrivals.map((entry) => [entry.occurrence_id, entry._min.arrived_at ?? null]),
    );

    return {
      total: occurrences.length,
      operational: operationalStatistics(occurrences, deployments),
      occurrences: occurrences.map((occurrence) => ({
        ...occurrence,
        first_arrived_at: firstArrivalByOccurrence.get(occurrence.id) ?? null,
      })),
    };
  }
}

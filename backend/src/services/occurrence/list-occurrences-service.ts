import { OccurrenceNature, OccurrencePriority, OccurrenceStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";

/// How the caller wants the list ordered.
///
/// `queue` is the dispatcher's board: whatever is most serious, and within the
/// same severity whatever has been waiting longest. `recent` is a feed: newest
/// first, regardless of severity. They are opposite orders and both are right
/// for their screen, which is why the caller has to say which one it wants.
type OccurrenceSort = "queue" | "recent"

interface ListOccurrencesRequest {
  unit_id?: string,
  status?: OccurrenceStatus,
  nature?: OccurrenceNature,
  priority?: OccurrencePriority,
  from?: Date,
  to?: Date,
  search?: string,
  page: number,
  per_page: number,
  sort?: OccurrenceSort
}

export class ListOccurrencesService {
  async execute({ unit_id, status, nature, priority, from, to, search, page, per_page, sort }: ListOccurrencesRequest) {

    const where = {
      ...(unit_id && { unit_id }),
      ...(status && { status }),
      ...(nature && { nature }),
      ...(priority && { priority }),
      ...((from || to) && {
        opened_at: {
          ...(from && { gte: from }),
          ...(to && { lte: to })
        }
      }),
      ...(search && {
        OR: [
          { protocol: { contains: search, mode: "insensitive" as const } },
          { address: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } }
        ]
      })
    }

    const [occurrences, total] = await Promise.all([
      prisma.occurrence.findMany({
        where,
        include: {
          unit: { select: { id: true, acronym: true } },
          _count: { select: { dispatches: true } }
        },
        orderBy: sort !== "queue"
          // A feed of what just happened.
          ? [{ opened_at: "desc" as const }, { id: "desc" as const }]
          // Critical incidents first, then the oldest still waiting.
          : [{ priority: "desc" as const }, { opened_at: "asc" as const }, { id: "asc" as const }],
        skip: (page - 1) * per_page,
        take: per_page
      }),
      prisma.occurrence.count({ where })
    ])

    return { occurrences, total, page, per_page }
  }
}

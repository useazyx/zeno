import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../errors/index.js";

export class GetOccurrenceService {
  async execute(id: string) {

    const occurrence = await prisma.occurrence.findUnique({
      where: { id },
      include: {
        unit: { select: { id: true, name: true, acronym: true } },
        dispatches: {
          include: {
            vehicle: { select: { id: true, prefix: true, type: true, status: true } },
            crew: {
              select: {
                id: true, name: true,
                commander: { select: { id: true, war_name: true, rank: true } }
              }
            },
            routes: {
              orderBy: { created_at: "desc" }
            },
            used_route: true
          },
          orderBy: [{ dispatched_at: "desc" }, { id: "desc" }]
        }
      }
    })

    if (!occurrence) {
      throw new NotFoundError("Occurrence not found")
    }

    return occurrence
  }
}

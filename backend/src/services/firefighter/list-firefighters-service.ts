import { FirefighterStatus, Rank } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";

interface ListFirefightersRequest {
  unit_id?: string,
  rank?: Rank,
  status?: FirefighterStatus,
  search?: string,
  page: number,
  per_page: number
}

export class ListFirefightersService {
  async execute({ unit_id, rank, status, search, page, per_page }: ListFirefightersRequest) {

    const where = {
      ...(unit_id && { unit_id }),
      ...(rank && { rank }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { war_name: { contains: search, mode: "insensitive" as const } },
          { military_id: { contains: search, mode: "insensitive" as const } }
        ]
      })
    }

    const [firefighters, total] = await Promise.all([
      prisma.firefighter.findMany({
        where,
        include: {
          unit: { select: { id: true, name: true, acronym: true } }
        },
        orderBy: [{ status: "asc" }, { admission_date: "desc" }, { id: "desc" }],
        skip: (page - 1) * per_page,
        take: per_page
      }),
      prisma.firefighter.count({ where })
    ])

    return { firefighters, total, page, per_page }
  }
}

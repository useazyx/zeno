import { prisma } from "../../config/prisma.js";

interface ListCrewsRequest {
  unit_id?: string,
  vehicle_id?: string,
  active?: boolean,
  page: number,
  per_page: number
}

export class ListCrewsService {
  async execute({ unit_id, vehicle_id, active, page, per_page }: ListCrewsRequest) {

    const where = {
      ...(unit_id && { unit_id }),
      ...(vehicle_id && { vehicle_id }),
      ...(active !== undefined && { active })
    }

    const [crews, total] = await Promise.all([
      prisma.crew.findMany({
        where,
        include: {
          unit: { select: { id: true, acronym: true } },
          vehicle: { select: { id: true, prefix: true, type: true } },
          commander: { select: { id: true, war_name: true, rank: true } },
          _count: { select: { members: true } }
        },
        orderBy: [{ started_at: "desc" }, { id: "desc" }],
        skip: (page - 1) * per_page,
        take: per_page
      }),
      prisma.crew.count({ where })
    ])

    return { crews, total, page, per_page }
  }
}

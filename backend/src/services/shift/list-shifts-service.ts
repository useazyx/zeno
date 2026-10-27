import { ShiftType } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";

interface ListShiftsRequest {
  firefighter_id?: string,
  unit_id?: string,
  type?: ShiftType,
  /// Window filter: returns shifts overlapping [from, to].
  from?: Date,
  to?: Date,
  page: number,
  per_page: number
}

export class ListShiftsService {
  async execute({ firefighter_id, unit_id, type, from, to, page, per_page }: ListShiftsRequest) {

    const where = {
      ...(firefighter_id && { firefighter_id }),
      ...(unit_id && { unit_id }),
      ...(type && { type }),
      ...(to && { start_at: { lt: to } }),
      ...(from && { end_at: { gt: from } })
    }

    const [shifts, total] = await Promise.all([
      prisma.shift.findMany({
        where,
        include: {
          firefighter: { select: { id: true, war_name: true, rank: true } },
          unit: { select: { id: true, acronym: true } }
        },
        orderBy: [{ start_at: "desc" }, { id: "desc" }],
        skip: (page - 1) * per_page,
        take: per_page
      }),
      prisma.shift.count({ where })
    ])

    return { shifts, total, page, per_page }
  }
}

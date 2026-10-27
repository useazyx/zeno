import { VehicleStatus, VehicleType } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";

interface ListVehiclesRequest {
  unit_id?: string,
  type?: VehicleType,
  status?: VehicleStatus,
  search?: string,
  page: number,
  per_page: number
}

export class ListVehiclesService {
  async execute({ unit_id, type, status, search, page, per_page }: ListVehiclesRequest) {

    const where = {
      ...(unit_id && { unit_id }),
      ...(type && { type }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { prefix: { contains: search, mode: "insensitive" as const } },
          { plate: { contains: search, mode: "insensitive" as const } },
          { model: { contains: search, mode: "insensitive" as const } }
        ]
      })
    }

    const [vehicles, total] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        include: {
          unit: { select: { id: true, name: true, acronym: true } }
        },
        orderBy: [{ status: "asc" }, { year: "desc" }, { prefix: "asc" }],
        skip: (page - 1) * per_page,
        take: per_page
      }),
      prisma.vehicle.count({ where })
    ])

    return { vehicles, total, page, per_page }
  }
}

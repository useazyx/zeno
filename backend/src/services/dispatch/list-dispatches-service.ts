import { DispatchStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";

interface ListDispatchesRequest {
  occurrence_id?: string,
  vehicle_id?: string,
  status?: DispatchStatus,
  /// Shortcut for the dispatch console: everything still under way.
  open?: boolean,
  page: number,
  per_page: number
}

export class ListDispatchesService {
  async execute({ occurrence_id, vehicle_id, status, open, page, per_page }: ListDispatchesRequest) {

    const where = {
      ...(occurrence_id && { occurrence_id }),
      ...(vehicle_id && { vehicle_id }),
      ...(status && { status }),
      ...(open && { status: { notIn: ["FINALIZADO" as const, "CANCELADO" as const] } })
    }

    const [dispatches, total] = await Promise.all([
      prisma.dispatch.findMany({
        where,
        include: {
          occurrence: { select: { id: true, protocol: true, nature: true, priority: true, address: true } },
          vehicle: { select: { id: true, prefix: true, type: true } },
          crew: { select: { id: true, name: true } },
          routes: { orderBy: { created_at: "desc" } },
          used_route: true
        },
        orderBy: [{ dispatched_at: "desc" }, { id: "desc" }],
        skip: (page - 1) * per_page,
        take: per_page
      }),
      prisma.dispatch.count({ where })
    ])

    return { dispatches, total, page, per_page }
  }
}

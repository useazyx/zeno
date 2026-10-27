import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../errors/index.js";

export class GetDispatchService {
  async execute(id: string) {

    const dispatch = await prisma.dispatch.findUnique({
      where: { id },
      include: {
        occurrence: {
          select: { id: true, protocol: true, nature: true, priority: true, status: true, address: true, latitude: true, longitude: true }
        },
        vehicle: { select: { id: true, prefix: true, type: true, status: true } },
        crew: {
          select: {
            id: true, name: true,
            commander: { select: { id: true, war_name: true, rank: true } },
            members: {
              include: { firefighter: { select: { id: true, war_name: true, rank: true } } }
            }
          }
        },
        routes: { orderBy: { created_at: "desc" } },
        used_route: true
      }
    })

    if (!dispatch) {
      throw new NotFoundError("Dispatch not found")
    }

    return dispatch
  }
}

import type { FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod/v4"
import { handleError } from "../../errors/handle-error.js"
import { UnitAreasService } from "../../services/unit/unit-areas-service.js"

const QUERY_SCHEMA = z.object({ critical_mode: z.enum(["true", "false"]).default("false") })

export class UnitAreasController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    try {
      const { critical_mode } = QUERY_SCHEMA.parse(req.query)
      return rep.send(await new UnitAreasService().execute(critical_mode === "true"))
    } catch (error) {
      return handleError(error, rep, "UnitAreas")
    }
  }
}

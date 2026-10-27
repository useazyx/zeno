import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { handleError } from "../../errors/handle-error.js";
import { ListVehiclePositionsService } from "../../services/vehicle/list-vehicle-positions-service.js";

const PARAMS_SCHEMA = z.object({ id: z.uuid().optional() })
const QUERY_SCHEMA = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() })

export class ListVehiclePositionsController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    try {
      const { id } = PARAMS_SCHEMA.parse(req.params)
      const { from, to } = QUERY_SCHEMA.parse(req.query)
      const result = await new ListVehiclePositionsService().execute({
        vehicle_id: id,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined
      })
      // O histórico muda com cada transmissão; um cache privado curto atende
      // repetição de reprodução sem compartilhar dados operacionais entre usuários.
      return rep.header("Cache-Control", "private, max-age=5").send(result)
    } catch (error) {
      return handleError(error, rep, "Vehicle positions")
    }
  }
}

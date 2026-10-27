import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { OccurrenceNature, OccurrencePriority, OccurrenceStatus } from "../../generated/prisma/client.js";
import { handleError } from "../../errors/handle-error.js";
import { ListOperationalRecordsService } from "../../services/occurrence/list-operational-records-service.js";

export class ListOperationalRecordsController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    try {
      const query = z.object({
        status: z.enum(OccurrenceStatus).optional(), nature: z.enum(OccurrenceNature).optional(),
        priority: z.enum(OccurrencePriority).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
        unit_id: z.uuid().optional(), search: z.string().trim().max(100).optional(),
        route_recorded: z.enum(["yes", "no"]).optional(),
        page: z.coerce.number().int().min(1).max(1000000).default(1),
        per_page: z.coerce.number().int().min(1).max(100).default(10),
      }).parse(req.query);
      return rep.status(200).send(await new ListOperationalRecordsService().execute(query));
    } catch (error) { return handleError(error, rep, "Operational records"); }
  }
}

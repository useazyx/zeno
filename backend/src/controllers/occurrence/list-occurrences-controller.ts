import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { OccurrenceNature, OccurrencePriority, OccurrenceStatus } from "../../generated/prisma/client.js";
import { ListOccurrencesService } from "../../services/occurrence/list-occurrences-service.js";
import { handleError } from "../../errors/handle-error.js";

export class ListOccurrencesController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    const querySchema = z.object({
      unit_id: z.uuid().optional(),
      status: z.enum(OccurrenceStatus).optional(),
      nature: z.enum(OccurrenceNature).optional(),
      priority: z.enum(OccurrencePriority).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      search: z.string().max(128).optional(),
      page: z.coerce.number().int().min(1).default(1),
      per_page: z.coerce.number().int().min(1).max(100).default(20),
      sort: z.enum(["queue", "recent"]).default("recent")
    })

    try {
      const query = querySchema.parse(req.query)

      const listOccurrencesService = new ListOccurrencesService()
      const result = await listOccurrencesService.execute(query)

      return rep.status(200).send(result)
    } catch (error: unknown) {
      return handleError(error, rep, "Occurrence")
    }
  }
}

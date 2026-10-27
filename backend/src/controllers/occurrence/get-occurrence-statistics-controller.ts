import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import {
  OccurrenceNature,
  OccurrencePriority,
  OccurrenceStatus,
} from "../../generated/prisma/client.js";
import { handleError } from "../../errors/handle-error.js";
import { GetOccurrenceStatisticsService } from "../../services/occurrence/get-occurrence-statistics-service.js";

export class GetOccurrenceStatisticsController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    const querySchema = z.object({
      status: z.enum(OccurrenceStatus).optional(),
      nature: z.enum(OccurrenceNature).optional(),
      priority: z.enum(OccurrencePriority).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    });

    try {
      const query = querySchema.parse(req.query);

      const service = new GetOccurrenceStatisticsService();
      const result = await service.execute(query);

      return rep.status(200).send(result);
    } catch (error: unknown) {
      return handleError(error, rep, "Occurrence statistics");
    }
  }
}

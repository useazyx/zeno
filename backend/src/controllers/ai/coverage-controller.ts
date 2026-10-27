import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { handleError } from "../../errors/handle-error.js";
import { CoverageService } from "../../services/ai/coverage-service.js";
import { EtaAccuracyService } from "../../services/ai/eta-accuracy-service.js";

export class CoverageController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    const bodySchema = z.object({
      minutes: z.array(z.coerce.number().int().min(1).max(30)).min(1).max(6).default([4, 8, 12]),
      critical_mode: z.boolean().optional().default(false),
      unit_ids: z.array(z.uuid()).max(50).optional(),
      extra_stations: z.array(z.object({
        latitude: z.coerce.number().min(-90).max(90),
        longitude: z.coerce.number().min(-180).max(180),
        label: z.string().max(40).optional()
      })).max(5).optional(),
      sample_size: z.coerce.number().int().min(0).max(10000).default(3000)
    })

    try {
      const body = bodySchema.parse(req.body ?? {})
      const result = await new CoverageService().execute(body)
      return rep.status(200).send(result)
    } catch (error: unknown) {
      return handleError(error, rep, "Coverage")
    }
  }
}

export class EtaAccuracyController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    const querySchema = z.object({
      limit: z.coerce.number().int().min(10).max(5000).default(1000)
    })

    try {
      const { limit } = querySchema.parse(req.query)
      const result = await new EtaAccuracyService().execute({ limit })
      return rep.status(200).send(result)
    } catch (error: unknown) {
      return handleError(error, rep, "ETA accuracy")
    }
  }
}

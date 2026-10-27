import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { WaterSourceStatus, WaterSourceType } from "../../generated/prisma/client.js";
import { handleError } from "../../errors/handle-error.js";
import { BadRequestError } from "../../errors/index.js";
import {
  CreateWaterSourceService,
  DeleteWaterSourceService,
  ListWaterSourcesService,
  UpdateWaterSourceService,
} from "../../services/water-source/water-source-services.js";

const paramsSchema = z.object({
  id: z.uuid({ error: "The id must be a valid uuid" })
})

const fields = {
  type: z.enum(WaterSourceType, { error: "The type must be HIDRANTE_COLUNA, HIDRANTE_SUBTERRANEO, CISTERNA, RESERVATORIO or PONTO_CAPTACAO" }),
  status: z.enum(WaterSourceStatus).optional(),
  address: z.string({ error: "The address is required" })
    .min(3, { error: "The address doesn't meet the minimum number of characters (3)" })
    .max(255, { error: "The address has exceeded the character limit (255)." }),
  latitude: z.coerce.number({ error: "The latitude is required" }).min(-90).max(90),
  longitude: z.coerce.number({ error: "The longitude is required" }).min(-180).max(180),
  flow_lpm: z.coerce.number().int().min(0).max(20000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  last_inspection_at: z.coerce.date().nullable().optional(),
  unit_id: z.uuid({ error: "The unit_id must be a valid uuid" })
}

export class ListWaterSourcesController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    const querySchema = z.object({
      unit_id: z.uuid().optional(),
      status: z.enum(WaterSourceStatus).optional(),
      type: z.enum(WaterSourceType).optional()
    })

    try {
      const query = querySchema.parse(req.query)
      return rep.status(200).send(await new ListWaterSourcesService().execute(query))
    } catch (error: unknown) {
      return handleError(error, rep, "Water source")
    }
  }
}

export class CreateWaterSourceController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    const bodySchema = z.object({
      ...fields,
      code: z.string().min(2).max(20).optional()
    })

    try {
      const data = bodySchema.parse(req.body)
      const water_source = await new CreateWaterSourceService().execute(data)
      return rep.status(201).send({ message: "Water source created successfully", water_source })
    } catch (error: unknown) {
      return handleError(error, rep, "Water source")
    }
  }
}

export class UpdateWaterSourceController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    const bodySchema = z.object(fields).partial()

    try {
      const { id } = paramsSchema.parse(req.params)
      const body = bodySchema.parse(req.body)

      if (Object.keys(body).length === 0) {
        throw new BadRequestError("At least one field must be provided for update")
      }

      const water_source = await new UpdateWaterSourceService().execute({ id, ...body })
      return rep.status(200).send({ message: "Water source updated successfully", water_source })
    } catch (error: unknown) {
      return handleError(error, rep, "Water source")
    }
  }
}

export class DeleteWaterSourceController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    try {
      const { id } = paramsSchema.parse(req.params)
      await new DeleteWaterSourceService().execute(id)
      return rep.status(204).send()
    } catch (error: unknown) {
      return handleError(error, rep, "Water source")
    }
  }
}

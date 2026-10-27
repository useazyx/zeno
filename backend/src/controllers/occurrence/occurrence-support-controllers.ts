import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { handleError } from "../../errors/handle-error.js";
import { GetOccurrenceTimelineService } from "../../services/occurrence/get-occurrence-timeline-service.js";
import { AddOccurrenceNoteService } from "../../services/occurrence/add-occurrence-note-service.js";
import { RecommendVehiclesService } from "../../services/occurrence/recommend-vehicles-service.js";
import { ListOccurrenceHospitalsService } from "../../services/occurrence/list-occurrence-hospitals-service.js";
import { NearestWaterSourcesService } from "../../services/water-source/water-source-services.js";

// Everything the dispatcher consults around one occurrence: its log, which
// vehicle to send, where to take a patient and where to find water.

const paramsSchema = z.object({
  id: z.uuid({ error: "The id must be a valid uuid" })
})

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true").optional()

const closureSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().min(5).max(500).default(40)
})

export class GetOccurrenceTimelineController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    try {
      const { id } = paramsSchema.parse(req.params)
      const result = await new GetOccurrenceTimelineService().execute(id)
      return rep.status(200).send(result)
    } catch (error: unknown) {
      return handleError(error, rep, "Occurrence timeline")
    }
  }
}

export class AddOccurrenceNoteController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    const bodySchema = z.object({
      message: z.string({ error: "The message is required" })
        .trim()
        .min(1, { error: "The note cannot be empty" })
        .max(1000, { error: "The note has exceeded the character limit (1000)." }),
      dispatch_id: z.uuid({ error: "The dispatch_id must be a valid uuid" }).optional()
    })

    try {
      const { id } = paramsSchema.parse(req.params)
      const body = bodySchema.parse(req.body)
      const event = await new AddOccurrenceNoteService().execute({ occurrence_id: id, ...body })
      return rep.status(201).send({ message: "Note added successfully", event })
    } catch (error: unknown) {
      return handleError(error, rep, "Occurrence note")
    }
  }
}

export class RecommendVehiclesController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    // POST because the closures travel in the body; nothing is written.
    const bodySchema = z.object({
      critical_mode: z.boolean().optional().default(false),
      closures: z.array(closureSchema).max(50).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(8)
    })

    try {
      const { id } = paramsSchema.parse(req.params)
      const body = bodySchema.parse(req.body ?? {})
      const result = await new RecommendVehiclesService().execute({ occurrence_id: id, ...body })
      return rep.status(200).send(result)
    } catch (error: unknown) {
      return handleError(error, rep, "Vehicle recommendation")
    }
  }
}

export class ListOccurrenceHospitalsController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    const querySchema = z.object({ critical_mode: booleanQuery })

    try {
      const { id } = paramsSchema.parse(req.params)
      const { critical_mode } = querySchema.parse(req.query)
      const result = await new ListOccurrenceHospitalsService().execute({ occurrence_id: id, critical_mode })
      return rep.status(200).send(result)
    } catch (error: unknown) {
      return handleError(error, rep, "Hospital")
    }
  }
}

export class NearestWaterSourcesController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(20).default(5)
    })

    try {
      const { id } = paramsSchema.parse(req.params)
      const { limit } = querySchema.parse(req.query)
      const result = await new NearestWaterSourcesService().execute({ occurrence_id: id, limit })
      return rep.status(200).send(result)
    } catch (error: unknown) {
      return handleError(error, rep, "Water source")
    }
  }
}

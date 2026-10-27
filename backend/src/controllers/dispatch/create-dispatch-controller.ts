import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { CreateDispatchService } from "../../services/dispatch/create-dispatch-service.js";
import { handleError } from "../../errors/handle-error.js";

export class CreateDispatchController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    const dispatchSchema = z.object({
      occurrence_id: z.uuid({ error: "The occurrence_id must be a valid uuid" }),
      vehicle_id: z.uuid({ error: "The vehicle_id must be a valid uuid" }),
      crew_id: z.uuid({ error: "The crew_id must be a valid uuid" }).optional(),
      critical_mode: z.boolean().optional().default(false)
    })

    try {
      const data = dispatchSchema.parse(req.body)

      const createDispatchService = new CreateDispatchService()
      const { dispatch, routes } = await createDispatchService.execute(data)

      // routes comes back empty when the AI service is unavailable; the
      // dispatch itself still succeeded, so this stays a 201.
      return rep.status(201).send({
        message: routes.length > 0
          ? "Dispatch created successfully"
          : "Dispatch created, but the route could not be calculated",
        dispatch,
        routes
      })
    } catch (error: unknown) {
      return handleError(error, rep, "Dispatch")
    }
  }
}

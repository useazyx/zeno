import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { VehicleStatus } from "../../generated/prisma/client.js";
import { UpdateVehicleService } from "../../services/vehicle/update-vehicle-service.js";
import { handleError } from "../../errors/handle-error.js";
import { BadRequestError } from "../../errors/index.js";
import { vehicleAppearanceSchema } from "../../services/vehicle/vehicle-appearance.js";

export class UpdateVehicleController {
  async handle(req: FastifyRequest, rep: FastifyReply) {

    const paramsSchema = z.object({
      id: z.uuid({ error: "The id must be a valid uuid" })
    })

    const bodySchema = z.object({
      prefix: z.string().min(2).max(20).optional(),
      plate: z.string().regex(/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/).optional(),
      model: z.string().min(2).max(64).optional(),
      year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
      water_capacity_liters: z.coerce.number().int().min(0).max(50000).nullable().optional(),
      crew_capacity: z.coerce.number().int().min(1).max(30).optional(),
      status: z.enum(VehicleStatus).optional(),
      current_latitude: z.coerce.number().min(-90).max(90).optional(),
      current_longitude: z.coerce.number().min(-180).max(180).optional(),
      heading: z.number().min(0).lt(360).nullable().optional(),
      appearance: vehicleAppearanceSchema.nullable().optional(),
      unit_id: z.uuid().optional()
    })

    try {
      const { id } = paramsSchema.parse(req.params)
      const body = bodySchema.parse(req.body)

      if (Object.keys(body).length === 0) {
        throw new BadRequestError("At least one field must be provided for update")
      }

      const updateVehicleService = new UpdateVehicleService()
      const vehicle = await updateVehicleService.execute({ id, ...body })

      return rep.status(200).send({ message: "Vehicle updated successfully", vehicle })
    } catch (error: unknown) {
      return handleError(error, rep, "Vehicle")
    }
  }
}

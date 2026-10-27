import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import { handleError } from "../../errors/handle-error.js";
import { GeoService } from "../../services/geo/geo-service.js";

const pointSchema = z.object({
  latitude: z.coerce.number({ error: "The latitude is required" }).min(-90).max(90),
  longitude: z.coerce.number({ error: "The longitude is required" }).min(-180).max(180)
})

export class SearchPlacesController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    const querySchema = z.object({
      q: z.string({ error: "The q parameter is required" }).trim()
        .min(3, { error: "Type at least 3 characters to search" })
        .max(200),
      limit: z.coerce.number().int().min(1).max(10).default(6)
    })

    try {
      const { q, limit } = querySchema.parse(req.query)
      return rep.status(200).send(await new GeoService().search(q, limit))
    } catch (error: unknown) {
      return handleError(error, rep, "Place search")
    }
  }
}

export class ReversePlaceController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    try {
      const { latitude, longitude } = pointSchema.parse(req.query)
      return rep.status(200).send(await new GeoService().reverse(latitude, longitude))
    } catch (error: unknown) {
      return handleError(error, rep, "Reverse geocoding")
    }
  }
}

export class ReferenceRouteController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    const querySchema = z.object({
      origin_latitude: pointSchema.shape.latitude,
      origin_longitude: pointSchema.shape.longitude,
      destination_latitude: pointSchema.shape.latitude,
      destination_longitude: pointSchema.shape.longitude
    })

    try {
      const query = querySchema.parse(req.query)
      return rep.status(200).send(await new GeoService().referenceRoute(
        { latitude: query.origin_latitude, longitude: query.origin_longitude },
        { latitude: query.destination_latitude, longitude: query.destination_longitude }
      ))
    } catch (error: unknown) {
      return handleError(error, rep, "Reference route")
    }
  }
}

export class WeatherController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    try {
      const { latitude, longitude } = pointSchema.parse(req.query)
      return rep.status(200).send(await new GeoService().weather(latitude, longitude))
    } catch (error: unknown) {
      return handleError(error, rep, "Weather")
    }
  }
}

import { FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { FastifyTypedInstance } from "../@types/fastify-types.js";
import { ReferenceRouteController, ReversePlaceController, SearchPlacesController, WeatherController } from "../controllers/geo/geo-controllers.js";

export async function geoRoutes(fastify: FastifyTypedInstance, plugins: FastifyPluginOptions) {

  // Address autocomplete for the occurrence form.
  fastify.get("/search", async (req: FastifyRequest, rep: FastifyReply) => {
    return new SearchPlacesController().handle(req, rep)
  })

  fastify.get("/reverse", async (req: FastifyRequest, rep: FastifyReply) => {
    return new ReversePlaceController().handle(req, rep)
  })

  // Same trip through OSRM, to benchmark the AI's route against an outside engine.
  fastify.get("/reference-route", async (req: FastifyRequest, rep: FastifyReply) => {
    return new ReferenceRouteController().handle(req, rep)
  })

  fastify.get("/weather", async (req: FastifyRequest, rep: FastifyReply) => {
    return new WeatherController().handle(req, rep)
  })
}

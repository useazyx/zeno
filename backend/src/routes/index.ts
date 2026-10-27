import { FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { FastifyTypedInstance } from "../@types/fastify-types.js";
import { unitRoutes } from "./unit-routes.js";
import { firefighterRoutes } from "./firefighter-routes.js";
import { vehicleRoutes } from "./vehicle-routes.js";
import { crewRoutes } from "./crew-routes.js";
import { shiftRoutes } from "./shift-routes.js";
import { occurrenceRoutes } from "./occurrence-routes.js";
import { dispatchRoutes } from "./dispatch-routes.js";
import { aiRoutes } from "./ai-routes.js";
import { geoRoutes } from "./geo-routes.js";
import { waterSourceRoutes } from "./water-source-routes.js";

export async function routes(fastify: FastifyTypedInstance, plugins: FastifyPluginOptions) {
  fastify.get("/ping", async (req: FastifyRequest, rep: FastifyReply) => {
    rep.status(200).send({
      "message": "Request Accepted",
    })
  })

  await fastify.register(unitRoutes, { prefix: "/units" })
  await fastify.register(firefighterRoutes, { prefix: "/firefighters" })
  await fastify.register(vehicleRoutes, { prefix: "/vehicles" })
  await fastify.register(crewRoutes, { prefix: "/crews" })
  await fastify.register(shiftRoutes, { prefix: "/shifts" })
  await fastify.register(occurrenceRoutes, { prefix: "/occurrences" })
  await fastify.register(dispatchRoutes, { prefix: "/dispatches" })
  await fastify.register(aiRoutes, { prefix: "/ai" })
  await fastify.register(geoRoutes, { prefix: "/geo" })
  await fastify.register(waterSourceRoutes, { prefix: "/water-sources" })
}

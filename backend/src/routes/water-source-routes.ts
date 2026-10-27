import { FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { FastifyTypedInstance } from "../@types/fastify-types.js";
import {
  CreateWaterSourceController,
  DeleteWaterSourceController,
  ListWaterSourcesController,
  UpdateWaterSourceController,
} from "../controllers/water-source/water-source-controllers.js";

export async function waterSourceRoutes(fastify: FastifyTypedInstance, plugins: FastifyPluginOptions) {

  fastify.get("/", async (req: FastifyRequest, rep: FastifyReply) => {
    return new ListWaterSourcesController().handle(req, rep)
  })

  fastify.post("/", async (req: FastifyRequest, rep: FastifyReply) => {
    return new CreateWaterSourceController().handle(req, rep)
  })

  fastify.patch("/:id", async (req: FastifyRequest, rep: FastifyReply) => {
    return new UpdateWaterSourceController().handle(req, rep)
  })

  fastify.delete("/:id", async (req: FastifyRequest, rep: FastifyReply) => {
    return new DeleteWaterSourceController().handle(req, rep)
  })
}

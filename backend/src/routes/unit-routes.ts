import { FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { FastifyTypedInstance } from "../@types/fastify-types.js";
import { CreateUnitController } from "../controllers/unit/create-unit-controller.js";
import { ListUnitsController } from "../controllers/unit/list-units-controller.js";
import { GetUnitController } from "../controllers/unit/get-unit-controller.js";
import { UpdateUnitController } from "../controllers/unit/update-unit-controller.js";
import { DeleteUnitController } from "../controllers/unit/delete-unit-controller.js";
import { UnitAreasController } from "../controllers/unit/unit-areas-controller.js";

export async function unitRoutes(fastify: FastifyTypedInstance, plugins: FastifyPluginOptions) {

  fastify.get("/areas", (req, rep) => new UnitAreasController().handle(req, rep))

  fastify.get("/", async (req: FastifyRequest, rep: FastifyReply) => {
    return new ListUnitsController().handle(req, rep)
  })

  fastify.get("/:id", async (req: FastifyRequest, rep: FastifyReply) => {
    return new GetUnitController().handle(req, rep)
  })

  fastify.post("/", async (req: FastifyRequest, rep: FastifyReply) => {
    return new CreateUnitController().handle(req, rep)
  })

  fastify.patch("/:id", async (req: FastifyRequest, rep: FastifyReply) => {
    return new UpdateUnitController().handle(req, rep)
  })

  fastify.delete("/:id", async (req: FastifyRequest, rep: FastifyReply) => {
    return new DeleteUnitController().handle(req, rep)
  })
}

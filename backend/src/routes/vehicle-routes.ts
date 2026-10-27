import { FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { FastifyTypedInstance } from "../@types/fastify-types.js";
import { CreateVehicleController } from "../controllers/vehicle/create-vehicle-controller.js";
import { ListVehiclesController } from "../controllers/vehicle/list-vehicles-controller.js";
import { GetVehicleController } from "../controllers/vehicle/get-vehicle-controller.js";
import { UpdateVehicleController } from "../controllers/vehicle/update-vehicle-controller.js";
import { DeleteVehicleController } from "../controllers/vehicle/delete-vehicle-controller.js";
import { ListVehiclePositionsController } from "../controllers/vehicle/list-vehicle-positions-controller.js";

export async function vehicleRoutes(fastify: FastifyTypedInstance, plugins: FastifyPluginOptions) {

  fastify.get("/positions", async (req, rep) => new ListVehiclePositionsController().handle(req, rep))
  fastify.get("/:id/positions", async (req, rep) => new ListVehiclePositionsController().handle(req, rep))

  fastify.get("/", async (req: FastifyRequest, rep: FastifyReply) => {
    return new ListVehiclesController().handle(req, rep)
  })

  fastify.get("/:id", async (req: FastifyRequest, rep: FastifyReply) => {
    return new GetVehicleController().handle(req, rep)
  })

  fastify.post("/", async (req: FastifyRequest, rep: FastifyReply) => {
    return new CreateVehicleController().handle(req, rep)
  })

  // Status and live position are driven straight from the dispatch console.
  fastify.patch("/:id", async (req: FastifyRequest, rep: FastifyReply) => {
    return new UpdateVehicleController().handle(req, rep)
  })

  fastify.delete("/:id", async (req: FastifyRequest, rep: FastifyReply) => {
    return new DeleteVehicleController().handle(req, rep)
  })
}

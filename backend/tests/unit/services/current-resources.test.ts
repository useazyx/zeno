jest.mock("../../../src/config/prisma.js", () => ({ prisma: {
  vehicle: { findMany: jest.fn(), count: jest.fn() },
  firefighter: { findMany: jest.fn(), count: jest.fn() },
} }))
import { prisma } from "../../../src/config/prisma.js"
import { ListVehiclesService } from "../../../src/services/vehicle/list-vehicles-service.js"
import { ListFirefightersService } from "../../../src/services/firefighter/list-firefighters-service.js"

it("shows the operational fleet before archived vehicles", async () => {
  await new ListVehiclesService().execute({ page: 1, per_page: 15 })
  expect(prisma.vehicle.findMany).toHaveBeenCalledWith(expect.objectContaining({
    orderBy: [{ status: "asc" }, { year: "desc" }, { prefix: "asc" }],
  }))
})

it("shows active personnel and newest admissions before historical personnel", async () => {
  await new ListFirefightersService().execute({ page: 1, per_page: 15 })
  expect(prisma.firefighter.findMany).toHaveBeenCalledWith(expect.objectContaining({
    orderBy: [{ status: "asc" }, { admission_date: "desc" }, { id: "desc" }],
  }))
})

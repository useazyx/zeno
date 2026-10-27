jest.mock("../../../../src/config/prisma.js", () => ({ prisma: {
  shift: { findMany: jest.fn(), count: jest.fn() },
} }))
import { prisma } from "../../../../src/config/prisma.js"
import { ListShiftsService } from "../../../../src/services/shift/list-shifts-service.js"

it("lists recent shifts first without dropping the date filter", async () => {
  const from = new Date("2026-09-01T00:00:00Z")
  await new ListShiftsService().execute({ page: 1, per_page: 20, from })
  expect(prisma.shift.findMany).toHaveBeenCalledWith(expect.objectContaining({
    orderBy: [{ start_at: "desc" }, { id: "desc" }], where: { end_at: { gt: from } },
  }))
})

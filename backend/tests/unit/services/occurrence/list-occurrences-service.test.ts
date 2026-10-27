jest.mock("../../../../src/config/prisma.js", () => ({ prisma: {
  occurrence: { findMany: jest.fn(), count: jest.fn() },
} }))
import { prisma } from "../../../../src/config/prisma.js"
import { ListOccurrencesService } from "../../../../src/services/occurrence/list-occurrences-service.js"

it("defaults to newest first, with a stable tie-breaker before pagination", async () => {
  await new ListOccurrencesService().execute({ page: 2, per_page: 12 })
  expect(prisma.occurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
    orderBy: [{ opened_at: "desc" }, { id: "desc" }], skip: 12, take: 12,
  }))
})

it("keeps the priority queue available only when explicitly requested", async () => {
  await new ListOccurrencesService().execute({ page: 1, per_page: 12, sort: "queue", status: "ABERTA" })
  expect(prisma.occurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
    orderBy: [{ priority: "desc" }, { opened_at: "asc" }, { id: "asc" }],
    where: { status: "ABERTA" },
  }))
})

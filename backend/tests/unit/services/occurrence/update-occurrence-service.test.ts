jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: {
      occurrenceEvent: { createMany: jest.fn() },
    occurrence: { findUnique: jest.fn(), update: jest.fn() },
    dispatch: { findFirst: jest.fn() }
  }
}))

import { BadRequestError, ConflictError, NotFoundError } from "../../../../src/errors/index.js"
import { prisma } from "../../../../src/config/prisma.js"
import { eventHub } from "../../../../src/realtime/event-hub.js"
import { UpdateOccurrenceService } from "../../../../src/services/occurrence/update-occurrence-service.js"

const mockPrisma = prisma as unknown as {
  occurrence: { findUnique: jest.Mock, update: jest.Mock },
  dispatch: { findFirst: jest.Mock }
}

describe("UpdateOccurrenceService", () => {
  const service = new UpdateOccurrenceService()
  const publishSpy = jest.spyOn(eventHub, "publish").mockImplementation(() => {})

  afterEach(() => publishSpy.mockClear())

  it("throws NotFoundError when the occurrence does not exist", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(null)

    await expect(service.execute({ id: "missing", status: "DESPACHADA" })).rejects.toThrow(NotFoundError)
  })

  it("throws BadRequestError for a disallowed transition", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ id: "occ1", status: "ABERTA", protocol: "2026-000001" })

    await expect(service.execute({ id: "occ1", status: "ENCERRADA" }))
      .rejects.toThrow("An occurrence cannot go from ABERTA to ENCERRADA")
  })

  it("throws ConflictError when closing an occurrence with a vehicle still assigned", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ id: "occ1", status: "EM_ATENDIMENTO", protocol: "2026-000001" })
    mockPrisma.dispatch.findFirst.mockResolvedValueOnce({ id: "d1" })

    await expect(service.execute({ id: "occ1", status: "ENCERRADA" }))
      .rejects.toThrow("There are still vehicles assigned to this occurrence")
  })

  it("closes the occurrence and stamps closed_at once no dispatch is open", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ id: "occ1", status: "EM_ATENDIMENTO", protocol: "2026-000001" })
    mockPrisma.dispatch.findFirst.mockResolvedValueOnce(null)
    mockPrisma.occurrence.update.mockResolvedValueOnce({ id: "occ1", status: "ENCERRADA", protocol: "2026-000001" })

    await service.execute({ id: "occ1", status: "ENCERRADA" })

    expect(mockPrisma.occurrence.update).toHaveBeenCalledWith({
      where: { id: "occ1" },
      data: expect.objectContaining({ status: "ENCERRADA", closed_at: expect.any(Date) })
    })
  })

  it("publishes occurrence.updated only when the status actually changes", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ id: "occ1", status: "ABERTA", protocol: "2026-000001" })
    mockPrisma.occurrence.update.mockResolvedValueOnce({ id: "occ1", status: "DESPACHADA", protocol: "2026-000001" })

    await service.execute({ id: "occ1", status: "DESPACHADA" })

    expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "occurrence.updated" }))
  })

  it("does not publish an event when only non-status fields are updated", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ id: "occ1", status: "ABERTA", protocol: "2026-000001" })
    mockPrisma.occurrence.update.mockResolvedValueOnce({ id: "occ1", status: "ABERTA", protocol: "2026-000001", description: "novo" })

    await service.execute({ id: "occ1", description: "novo" })

    expect(publishSpy).not.toHaveBeenCalled()
  })
})

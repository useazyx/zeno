jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: {
    unit: { findUnique: jest.fn() },
    occurrence: { findUnique: jest.fn() },
    waterSource: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() }
  }
}))

import { prisma } from "../../../../src/config/prisma.js"
import { ConflictError, NotFoundError } from "../../../../src/errors/index.js"
import { CreateWaterSourceService, NearestWaterSourcesService } from "../../../../src/services/water-source/water-source-services.js"

const mockPrisma = prisma as unknown as {
  unit: { findUnique: jest.Mock },
  occurrence: { findUnique: jest.Mock },
  waterSource: { findUnique: jest.Mock, findFirst: jest.Mock, findMany: jest.Mock, create: jest.Mock }
}

const fields = {
  type: "HIDRANTE_COLUNA" as const,
  address: "Rua A, 10",
  latitude: -23.02,
  longitude: -45.55,
  unit_id: "u1"
}

describe("CreateWaterSourceService", () => {
  const service = new CreateWaterSourceService()

  it("numbers a new hydrant after the highest number of its series", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce({ id: "u1" })
    // Compared as numbers, and hand-typed codes outside the pattern ignored.
    mockPrisma.waterSource.findMany.mockResolvedValueOnce([
      { code: "HID-9999" }, { code: "HID-10000" }, { code: "HID-A1" }, { code: "HID-0041" },
    ])
    mockPrisma.waterSource.findUnique.mockResolvedValueOnce(null)
    mockPrisma.waterSource.create.mockImplementationOnce(async ({ data }) => data)

    const created = await service.execute(fields)

    expect(created.code).toBe("HID-10001")
    expect(mockPrisma.waterSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { code: { startsWith: "HID-" } }
    }))
  })

  it("starts a series at 0001", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce({ id: "u1" })
    mockPrisma.waterSource.findMany.mockResolvedValueOnce([])
    mockPrisma.waterSource.findUnique.mockResolvedValueOnce(null)
    mockPrisma.waterSource.create.mockImplementationOnce(async ({ data }) => data)

    const created = await service.execute({ ...fields, type: "CISTERNA" })
    expect(created.code).toBe("CIS-0001")
  })

  it("rejects a repeated code", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce({ id: "u1" })
    mockPrisma.waterSource.findUnique.mockResolvedValueOnce({ id: "other" })

    await expect(service.execute({ ...fields, code: "HID-0001" })).rejects.toThrow(ConflictError)
  })

  it("requires an existing unit", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce(null)
    await expect(service.execute(fields)).rejects.toThrow(NotFoundError)
  })
})

describe("NearestWaterSourcesService", () => {
  const service = new NearestWaterSourcesService()

  it("ranks by distance and never puts a broken point ahead of one that may work", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ latitude: "-23.0200", longitude: "-45.5500" })
    mockPrisma.waterSource.findMany.mockResolvedValueOnce([
      { id: "far", status: "OPERANTE", latitude: "-23.0300", longitude: "-45.5500" },
      { id: "broken", status: "INOPERANTE", latitude: "-23.0201", longitude: "-45.5500" },
      { id: "near", status: "NAO_VERIFICADO", latitude: "-23.0210", longitude: "-45.5500" },
    ])

    const { water_sources } = await service.execute({ occurrence_id: "o1", limit: 3 })

    expect(water_sources.map((source) => source.id)).toEqual(["near", "far", "broken"])
    expect(water_sources[0].distance_meters).toBe(111)
  })
})

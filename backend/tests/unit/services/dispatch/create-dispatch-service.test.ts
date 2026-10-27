jest.mock("../../../../src/config/prisma.js", () => {
  const tx = {
    dispatch: { create: jest.fn() },
    vehicle: { update: jest.fn() },
    occurrence: { update: jest.fn() }
  }

  return {
    prisma: {
      occurrenceEvent: { createMany: jest.fn() },
      occurrence: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      crew: { findUnique: jest.fn() },
      route: { createMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      __tx: tx
    }
  }
})

jest.mock("../../../../src/services/ai/ai-client.js", () => {
  const calculateRoute = jest.fn()
  return {
    AiClient: jest.fn().mockImplementation(() => ({ calculateRoute })),
    __mock: { calculateRoute }
  }
})

import { ConflictError, NotFoundError } from "../../../../src/errors/index.js"
import { prisma } from "../../../../src/config/prisma.js"
import { eventHub } from "../../../../src/realtime/event-hub.js"
import { AiClient } from "../../../../src/services/ai/ai-client.js"
import { CreateDispatchService } from "../../../../src/services/dispatch/create-dispatch-service.js"

const mockPrisma = prisma as unknown as {
  occurrence: { findUnique: jest.Mock },
  vehicle: { findUnique: jest.Mock },
  crew: { findUnique: jest.Mock },
  route: { createMany: jest.Mock, findMany: jest.Mock },
  $transaction: jest.Mock,
  __tx: { dispatch: { create: jest.Mock }, vehicle: { update: jest.Mock }, occurrence: { update: jest.Mock } }
}

const AiClientMock = AiClient as unknown as jest.Mock
const aiClientMock = jest.requireMock("../../../../src/services/ai/ai-client.js") as {
  __mock: { calculateRoute: jest.Mock }
}

const openOccurrence = {
  id: "occ1", status: "ABERTA", protocol: "2026-000001",
  latitude: { toString: () => "-23.02" }, longitude: { toString: () => "-45.55" }
}

const availableVehicle = {
  id: "v1", prefix: "ABT-01", status: "DISPONIVEL",
  current_latitude: null, current_longitude: null,
  unit: { latitude: { toString: () => "-23.03" }, longitude: { toString: () => "-45.56" } }
}

const routeResponse = {
  neural: { distance_meters: 1000, estimated_time_seconds: 120, node_count: 5, geometry: [] },
  shortest: { distance_meters: 900, estimated_time_seconds: 150, node_count: 4, geometry: [] },
  model_version: "v1"
}

describe("CreateDispatchService", () => {
  const service = new CreateDispatchService()
  const publishSpy = jest.spyOn(eventHub, "publish").mockImplementation(() => {})

  // `resetMocks` (jest.config.cjs) wipes every mockImplementation before each
  // test, including the structural wiring set up once in the jest.mock
  // factories above ($transaction running its callback, AiClient's
  // constructor returning an object). Those have to be restored per test;
  // only the per-test return values (mockResolvedValueOnce, ...) are meant
  // to be set fresh in each `it`.
  beforeEach(() => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma.__tx))
    AiClientMock.mockImplementation(() => ({ calculateRoute: aiClientMock.__mock.calculateRoute }))
  })

  afterEach(() => publishSpy.mockClear())

  it("throws NotFoundError when the occurrence does not exist", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(null)

    await expect(service.execute({ occurrence_id: "missing", vehicle_id: "v1" }))
      .rejects.toThrow(NotFoundError)
  })

  it("throws ConflictError when the occurrence is already closed", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ ...openOccurrence, status: "ENCERRADA" })

    await expect(service.execute({ occurrence_id: "occ1", vehicle_id: "v1" }))
      .rejects.toThrow("already ENCERRADA")
  })

  it("throws NotFoundError when the vehicle does not exist", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(openOccurrence)
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce(null)

    await expect(service.execute({ occurrence_id: "occ1", vehicle_id: "missing" }))
      .rejects.toThrow(NotFoundError)
  })

  it("throws ConflictError when the vehicle is not DISPONIVEL", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(openOccurrence)
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce({ ...availableVehicle, status: "MANUTENCAO" })

    await expect(service.execute({ occurrence_id: "occ1", vehicle_id: "v1" }))
      .rejects.toThrow("ABT-01 is MANUTENCAO")
  })

  it("throws ConflictError when the given crew is not assigned to the given vehicle", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(openOccurrence)
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce(availableVehicle)
    mockPrisma.crew.findUnique.mockResolvedValueOnce({ id: "crew1", active: true, vehicle_id: "other-vehicle" })

    await expect(service.execute({ occurrence_id: "occ1", vehicle_id: "v1", crew_id: "crew1" }))
      .rejects.toThrow("This crew is not assigned to the given vehicle")
  })

  it("creates the dispatch, occupies the vehicle and advances an ABERTA occurrence in one transaction", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(openOccurrence)
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce(availableVehicle)
    mockPrisma.__tx.dispatch.create.mockResolvedValueOnce({ id: "d1", status: "DESPACHADO" })
    aiClientMock.__mock.calculateRoute.mockResolvedValueOnce(routeResponse)
    mockPrisma.route.createMany.mockResolvedValueOnce({ count: 2 })
    mockPrisma.route.findMany.mockResolvedValueOnce([])

    const result = await service.execute({ occurrence_id: "occ1", vehicle_id: "v1" })

    expect(mockPrisma.__tx.vehicle.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { status: "EMPENHADA" } })
    expect(mockPrisma.__tx.occurrence.update).toHaveBeenCalledWith({ where: { id: "occ1" }, data: { status: "DESPACHADA" } })
    expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "dispatch.created" }))
    expect(result.dispatch).toEqual({ id: "d1", status: "DESPACHADO" })
  })

  it("does not advance the occurrence status again when it was already DESPACHADA", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ ...openOccurrence, status: "DESPACHADA" })
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce(availableVehicle)
    mockPrisma.__tx.dispatch.create.mockResolvedValueOnce({ id: "d2", status: "DESPACHADO" })
    aiClientMock.__mock.calculateRoute.mockResolvedValueOnce(routeResponse)
    mockPrisma.route.createMany.mockResolvedValueOnce({ count: 2 })
    mockPrisma.route.findMany.mockResolvedValueOnce([])

    await service.execute({ occurrence_id: "occ1", vehicle_id: "v1" })

    expect(mockPrisma.__tx.occurrence.update).not.toHaveBeenCalled()
  })

  it("still returns the dispatch when the AI route calculation fails", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(openOccurrence)
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce(availableVehicle)
    mockPrisma.__tx.dispatch.create.mockResolvedValueOnce({ id: "d3", status: "DESPACHADO" })
    aiClientMock.__mock.calculateRoute.mockRejectedValueOnce(new Error("AI service is unreachable"))
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    const result = await service.execute({ occurrence_id: "occ1", vehicle_id: "v1" })

    expect(result.dispatch).toEqual({ id: "d3", status: "DESPACHADO" })
    expect(result.routes).toEqual([])
    expect(mockPrisma.route.createMany).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})

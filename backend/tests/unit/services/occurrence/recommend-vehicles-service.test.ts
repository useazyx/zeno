jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: {
    occurrence: { findUnique: jest.fn() },
    vehicle: { findMany: jest.fn() }
  }
}))

const travelTimes = jest.fn()
jest.mock("../../../../src/services/ai/ai-client.js", () => ({
  // A plain class: `resetMocks` would wipe a jest.fn() implementation.
  AiClient: class { travelTimes = (...args: unknown[]) => travelTimes(...args) }
}))

import { prisma } from "../../../../src/config/prisma.js"
import { ConflictError, NotFoundError } from "../../../../src/errors/index.js"
import { RecommendVehiclesService } from "../../../../src/services/occurrence/recommend-vehicles-service.js"

const mockPrisma = prisma as unknown as {
  occurrence: { findUnique: jest.Mock },
  vehicle: { findMany: jest.Mock }
}

const station = { id: "u1", acronym: "PB-TAUBATE", name: "Posto", latitude: "-23.026", longitude: "-45.555" }
const crew = { id: "c1", name: "Alfa", commander: { war_name: "Silva" }, _count: { members: 4 } }

function vehicle(prefix: string, type: string, options: { crew?: boolean, tracked?: boolean } = {}) {
  return {
    id: prefix, prefix, type, model: "M", water_capacity_liters: null,
    current_latitude: options.tracked ? "-23.03" : null,
    current_longitude: options.tracked ? "-45.56" : null,
    unit: station,
    crews: options.crew === false ? [] : [crew]
  }
}

const reach = (seconds: number | null) => seconds === null
  ? { reachable: false, time_seconds: null, distance_meters: null, snap_distance_meters: 3000 }
  : { reachable: true, time_seconds: seconds, distance_meters: seconds * 10, snap_distance_meters: 5 }

describe("RecommendVehiclesService", () => {
  const service = new RecommendVehiclesService()

  beforeEach(() => {
    mockPrisma.occurrence.findUnique.mockResolvedValue({
      id: "o1", status: "ABERTA", nature: "INCENDIO_EDIFICACAO", protocol: "2026-000001",
      latitude: "-23.02", longitude: "-45.55"
    })
  })

  it("throws NotFoundError for an unknown occurrence", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(null)
    await expect(service.execute({ occurrence_id: "x", limit: 5 })).rejects.toThrow(NotFoundError)
  })

  it("refuses a closed occurrence", async () => {
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce({ id: "o1", status: "ENCERRADA", protocol: "P" })
    await expect(service.execute({ occurrence_id: "o1", limit: 5 })).rejects.toThrow(ConflictError)
  })

  it("puts equipped, crewed vehicles first and unreachable ones last", async () => {
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([
      vehicle("UR-1", "UR"),
      vehicle("ABT-1", "ABT", { crew: false }),
      vehicle("ABT-2", "ABT"),
      vehicle("ABT-3", "ABT"),
    ])
    travelTimes.mockResolvedValueOnce([reach(60), reach(70), reach(300), reach(null)])

    const { recommendations } = await service.execute({ occurrence_id: "o1", limit: 10 })

    expect(recommendations.map((item) => item.vehicle.prefix)).toEqual(["ABT-2", "ABT-1", "UR-1", "ABT-3"])
    expect(recommendations[0]).toMatchObject({ rank: 1, suitable: true, ready: true, eta_seconds: 300 })
    expect(recommendations[1]).toMatchObject({ suitable: true, ready: false })
    expect(recommendations[2]).toMatchObject({ suitable: false })
    expect(recommendations[3]).toMatchObject({ reachable: false, eta_seconds: null })
  })

  it("lets the better-suited type win a near tie", async () => {
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([vehicle("AEM-1", "AEM"), vehicle("ABT-1", "ABT")])
    // The ladder is 20 s closer, but it is three steps down the doctrine list.
    travelTimes.mockResolvedValueOnce([reach(100), reach(120)])

    const { recommendations } = await service.execute({ occurrence_id: "o1", limit: 10 })
    expect(recommendations.map((item) => item.vehicle.prefix)).toEqual(["ABT-1", "AEM-1"])
  })

  it("prices each vehicle from where it is, falling back to its station", async () => {
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([vehicle("ABT-1", "ABT", { tracked: true }), vehicle("ABT-2", "ABT")])
    travelTimes.mockResolvedValueOnce([reach(10), reach(20)])

    const { recommendations } = await service.execute({ occurrence_id: "o1", critical_mode: true, limit: 1 })

    expect(recommendations).toHaveLength(1)
    expect(travelTimes).toHaveBeenCalledWith(
      { latitude: -23.02, longitude: -45.55 },
      [{ latitude: -23.03, longitude: -45.56 }, { latitude: -23.026, longitude: -45.555 }],
      { direction: "to_anchor", critical_mode: true, closures: undefined }
    )
    expect(recommendations[0].origin.source).toBe("current_position")
  })

  it("does not call the AI when nothing is available", async () => {
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([])
    const result = await service.execute({ occurrence_id: "o1", limit: 5 })
    expect(result.recommendations).toEqual([])
    expect(travelTimes).not.toHaveBeenCalled()
  })
})

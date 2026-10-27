jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: {
    unit: { findMany: jest.fn() },
    occurrence: { findMany: jest.fn() }
  }
}))

const isochrones = jest.fn()
jest.mock("../../../../src/services/ai/ai-client.js", () => ({
  // A plain class: `resetMocks` would wipe a jest.fn() implementation.
  AiClient: class { isochrones = (...args: unknown[]) => isochrones(...args) }
}))

import { prisma } from "../../../../src/config/prisma.js"
import { CoverageService } from "../../../../src/services/ai/coverage-service.js"

const mockPrisma = prisma as unknown as {
  unit: { findMany: jest.Mock },
  occurrence: { findMany: jest.Mock }
}

describe("CoverageService", () => {
  const service = new CoverageService()

  it("measures recent demand against the stations, hypothetical ones included", async () => {
    mockPrisma.unit.findMany.mockResolvedValueOnce([
      { id: "u1", acronym: "PB-A", name: "A", latitude: "-23.02", longitude: "-45.55" },
      { id: "u2", acronym: "PB-B", name: "B", latitude: "-23.55", longitude: "-46.63" },
    ])
    mockPrisma.occurrence.findMany.mockResolvedValueOnce([
      { id: "o1", latitude: "-23.021", longitude: "-45.551", priority: "ALTA", nature: "SALVAMENTO" },
      { id: "o2", latitude: "-23.1", longitude: "-45.7", priority: "BAIXA", nature: "OUTROS" },
    ])
    isochrones.mockResolvedValueOnce({
      critical_mode: false,
      model_version: "v1",
      skipped_origins: [1],
      isochrones: [{ minutes: 8, area_km2: 10, reached_nodes: 100, geometry: null }],
      points: { total: 2, times_seconds: [120, null], covered: { "8": 1 } }
    })

    const result = await service.execute({
      minutes: [8],
      extra_stations: [{ latitude: -23.05, longitude: -45.6 }],
      sample_size: 2
    })

    expect(isochrones).toHaveBeenCalledWith(
      [
        { latitude: -23.02, longitude: -45.55 },
        { latitude: -23.55, longitude: -46.63 },
        { latitude: -23.05, longitude: -45.6 },
      ],
      [8],
      expect.objectContaining({ points: [{ latitude: -23.021, longitude: -45.551 }, { latitude: -23.1, longitude: -45.7 }] })
    )
    expect(result.stations.map((station) => [station.acronym, station.in_network, station.hypothetical])).toEqual([
      ["PB-A", true, false],
      ["PB-B", false, false],
      ["NOVO-1", true, true],
    ])
    expect(result.demand?.covered).toEqual({ "8": 1 })
    expect(result.demand?.points.map((point) => point.time_seconds)).toEqual([120, null])
  })

  it("skips the demand query when no sample is asked for", async () => {
    mockPrisma.unit.findMany.mockResolvedValueOnce([
      { id: "u1", acronym: "PB-A", name: "A", latitude: "-23.02", longitude: "-45.55" },
    ])
    isochrones.mockResolvedValueOnce({ skipped_origins: [], isochrones: [], model_version: null, critical_mode: false })

    const result = await service.execute({ minutes: [4], sample_size: 0 })

    expect(mockPrisma.occurrence.findMany).not.toHaveBeenCalled()
    expect(result.demand).toBeNull()
  })

  it("answers an empty map without calling the AI when there are no stations", async () => {
    mockPrisma.unit.findMany.mockResolvedValueOnce([])
    mockPrisma.occurrence.findMany.mockResolvedValueOnce([])

    const result = await service.execute({ minutes: [4], sample_size: 10 })

    expect(result.stations).toEqual([])
    expect(isochrones).not.toHaveBeenCalled()
  })
})

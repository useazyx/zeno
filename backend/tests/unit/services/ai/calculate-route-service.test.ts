jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: {
    dispatch: { findUnique: jest.fn(), update: jest.fn() },
    route: { createMany: jest.fn(), findMany: jest.fn() },
  },
}))
const calculateRoute = jest.fn()
jest.mock("../../../../src/services/ai/ai-client.js", () => ({
  AiClient: class { calculateRoute = (...args: unknown[]) => calculateRoute(...args) },
}))
jest.mock("../../../../src/services/geo/route-weather-service.js", () => ({ getRouteWeather: jest.fn() }))
jest.mock("../../../../src/services/occurrence/occurrence-events.js", () => ({ recordOccurrenceEvents: jest.fn() }))

import { prisma } from "../../../../src/config/prisma.js"
import { getRouteWeather } from "../../../../src/services/geo/route-weather-service.js"
import { CalculateRouteService } from "../../../../src/services/ai/calculate-route-service.js"

const database = prisma as unknown as {
  dispatch: { findUnique: jest.Mock, update: jest.Mock }
  route: { createMany: jest.Mock, findMany: jest.Mock }
}
const destination = { origin_latitude: -23, origin_longitude: -45, destination_latitude: -23.01, destination_longitude: -45.01 }
const variant = {
  distance_meters: 800, estimated_time_seconds: 90, node_count: 2,
  geometry: [[-23, -45], [-23.01, -45.01]], steps: [], segments: [], exploration: [[-23, -45]],
}
const response = { neural: variant, shortest: variant, critical: null, critical_mode: false, model_version: "test", closures: { count: 0, blocked_edges: 0 } }

describe("CalculateRouteService visual metadata", () => {
  it("adds weather and real trace without changing ETA or persisting an exploratory query", async () => {
    calculateRoute.mockResolvedValue(response)
    const weather = { precipitation_mm: 2, weather_code: 61, advisory: "Pista molhada" }
    ;(getRouteWeather as jest.Mock).mockResolvedValue(weather)
    const result = await new CalculateRouteService().execute({ ...destination, trace: true })
    expect(result.neural).toEqual(variant)
    expect(result.weather).toEqual(weather)
    expect(calculateRoute).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ trace: true }))
    expect(database.route.createMany).not.toHaveBeenCalled()
  })

  it("keeps the trace in the response but excludes it from stored route rows", async () => {
    calculateRoute.mockResolvedValue(response)
    database.dispatch.findUnique.mockResolvedValue({ id: "dispatch", occurrence_id: "occurrence" })
    database.route.findMany.mockResolvedValue([{ id: "route", algorithm: "NEURAL" }])
    const result = await new CalculateRouteService().execute({ ...destination, dispatch_id: "dispatch", trace: true })
    expect(result.neural).toEqual(variant)
    expect(database.route.createMany).toHaveBeenCalledTimes(1)
    for (const row of database.route.createMany.mock.calls[0][0].data) {
      expect(row).not.toHaveProperty("exploration")
      expect(row).not.toHaveProperty("trace")
      expect(row.estimated_time_seconds).toBe(90)
    }
    expect(result).not.toHaveProperty("weather")
  })
})

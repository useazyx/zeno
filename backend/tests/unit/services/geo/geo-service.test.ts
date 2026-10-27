const getModelInfo = jest.fn()
jest.mock("../../../../src/services/ai/ai-client.js", () => ({
  // A plain class: `resetMocks` would wipe a jest.fn() implementation.
  AiClient: class { getModelInfo = (...args: unknown[]) => getModelInfo(...args) }
}))

import { ServiceUnavailableError } from "../../../../src/errors/index.js"
import { GeoService } from "../../../../src/services/geo/geo-service.js"

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

const json = (body: unknown, status = 200) => Promise.resolve({
  ok: status < 400,
  status,
  json: () => Promise.resolve(body)
})

const street = (name: string, district: string, coordinates: [number, number]) => ({
  properties: { type: "street", name, district, city: "Taubaté", osm_value: "secondary" },
  geometry: { coordinates }
})

describe("GeoService", () => {
  const service = new GeoService()

  beforeEach(() => {
    getModelInfo.mockResolvedValue({
      bounds: { min_latitude: -23.2, max_latitude: -22.9, min_longitude: -45.7, max_longitude: -45.3, max_snap_distance_m: 2000 }
    })
  })

  it("searches inside the street network and collapses repeated ways", async () => {
    fetchMock.mockReturnValueOnce(json({
      features: [
        street("Avenida Independência", "Parque Independência", [-45.59, -23.04]),
        street("Avenida Independência", "Parque Independência", [-45.58, -23.03]),
        street("Avenida Independência", "Centro", [-45.56, -23.02]),
      ]
    }))

    const { places } = await service.search("avenida independencia", 6)

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain("bbox=-45.7%2C-23.2%2C-45.3%2C-22.9")
    expect(url).toContain("limit=18")
    expect(places.map((place) => place.label)).toEqual([
      "Avenida Independência — Parque Independência · Taubaté",
      "Avenida Independência — Centro · Taubaté",
    ])
    expect(places[0]).toMatchObject({ latitude: -23.04, longitude: -45.59, street: "Avenida Independência" })
  })

  it("answers a repeated search from memory", async () => {
    fetchMock.mockReturnValueOnce(json({ features: [street("Rua A", "Centro", [-45.5, -23.0])] }))

    await service.search("rua a centro", 3)
    const again = await service.search("RUA A CENTRO", 3)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(again.places).toHaveLength(1)
  })

  it("reports current weather with the wind it brings", async () => {
    fetchMock.mockReturnValueOnce(json({
      current: {
        time: "2026-10-02T09:30", temperature_2m: 21.8, relative_humidity_2m: 79, precipitation: 0,
        weather_code: 3, wind_speed_10m: 3.3, wind_direction_10m: 261, wind_gusts_10m: 14.4
      }
    }))

    const { weather } = await service.weather(-23.0264, -45.5553)

    expect(weather).toEqual({
      observed_at: "2026-10-02T09:30",
      temperature_c: 21.8,
      humidity_percent: 79,
      precipitation_mm: 0,
      wind_speed_kmh: 3.3,
      wind_gusts_kmh: 14.4,
      wind_direction_deg: 261,
      weather_code: 3
    })
  })

  it("turns an outage of the public service into a 503", async () => {
    fetchMock.mockReturnValueOnce(json({}, 502))
    await expect(service.weather(-22.5, -45.1)).rejects.toThrow(ServiceUnavailableError)

    fetchMock.mockReturnValueOnce(Promise.reject(new TypeError("fetch failed")))
    await expect(service.reverse(-22.5, -45.1)).rejects.toThrow("The geocoder is unreachable")
  })

  it("asks OSRM for the same trip and hands the line back latitude first", async () => {
    fetchMock.mockReturnValueOnce(json({
      code: "Ok",
      routes: [{ distance: 1022.8, duration: 99.7, geometry: { coordinates: [[-45.5551, -23.0264], [-45.562, -23.033]] } }]
    }))

    const origin = { latitude: -23.0264, longitude: -45.5551 }
    const destination = { latitude: -23.033, longitude: -45.562 }
    const { route } = await service.referenceRoute(origin, destination)
    const again = await service.referenceRoute(origin, destination)

    expect(String(fetchMock.mock.calls[0][0])).toContain("/route/v1/driving/-45.5551,-23.0264;-45.562,-23.033?")
    expect(route).toEqual({
      source: "OSRM",
      distance_meters: 1023,
      duration_seconds: 100,
      geometry: [[-23.0264, -45.5551], [-23.033, -45.562]]
    })
    expect(again.route).toEqual(route)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("answers null when OSRM finds no road, and 503 when it is down", async () => {
    fetchMock.mockReturnValueOnce(json({ code: "NoRoute", routes: [] }))
    const { route } = await service.referenceRoute({ latitude: -23.1, longitude: -45.6 }, { latitude: -23.2, longitude: -45.7 })
    expect(route).toBeNull()

    fetchMock.mockReturnValueOnce(json({}, 429))
    await expect(service.referenceRoute({ latitude: -23.3, longitude: -45.6 }, { latitude: -23.2, longitude: -45.7 }))
      .rejects.toThrow("The reference router answered with status 429")
  })
})

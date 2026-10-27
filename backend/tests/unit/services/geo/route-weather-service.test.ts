jest.mock("../../../../src/services/geo/geo-service.js", () => ({ GeoService: class { weather = (...args: unknown[]) => weather(...args) } }))
const weather = jest.fn()
import { getRouteWeather } from "../../../../src/services/geo/route-weather-service.js"

describe("route weather advisory", () => {
  it("warns about a wet road without introducing a time multiplier", async () => {
    weather.mockResolvedValue({ weather: { precipitation_mm: 3, weather_code: 61 } })
    expect(await getRouteWeather(-23, -45)).toEqual({ precipitation_mm: 3, weather_code: 61, advisory: "Pista molhada: o tempo de resposta pode aumentar." })
    expect(weather).toHaveBeenCalledWith(-23, -45)
  })

  it("keeps dry conditions without an advisory and tolerates weather outages", async () => {
    weather.mockResolvedValueOnce({ weather: { precipitation_mm: 0, weather_code: 0 } }).mockRejectedValueOnce(new Error("offline"))
    expect(await getRouteWeather(-23, -45)).toMatchObject({ advisory: null })
    expect(await getRouteWeather(-23, -45)).toBeUndefined()
  })
})

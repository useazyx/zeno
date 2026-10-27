import { env } from "../../config/env.js";
import { GeoService } from "./geo-service.js";

export interface RouteWeather {
  precipitation_mm: number
  weather_code: number
  advisory: string | null
}

// O clima é informativo: uma falha externa não pode impedir o despacho.
export async function getRouteWeather(latitude: number, longitude: number): Promise<RouteWeather | undefined> {
  try {
    const { weather } = await new GeoService().weather(latitude, longitude)
    return {
      precipitation_mm: weather.precipitation_mm,
      weather_code: weather.weather_code,
      advisory: weather.precipitation_mm > env.ROUTE_WET_ROAD_PRECIPITATION_MM
        ? "Pista molhada: o tempo de resposta pode aumentar."
        : null
    }
  } catch {
    return undefined
  }
}

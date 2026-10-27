import { z } from "zod/v4";
import dotenv from 'dotenv';

dotenv.config()

const envSchema = z.object({
  PORT: z.coerce.number().default(3333),
  HOST: z.coerce.string().default("0.0.0.0"),

  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }),

  // Servico Python (FastAPI) que calcula rotas e executa o treinamento.
  AI_SERVICE_URL: z.string().default("http://127.0.0.1:8000"),
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().default(120000),

  // Servicos publicos de mapa, sem chave: Photon (busca de endereco sobre o
  // OpenStreetMap) e Open-Meteo (clima). O User-Agent identifica o sistema,
  // como as politicas de uso desses servicos pedem.
  GEOCODER_URL: z.string().default("https://photon.komoot.io"),
  WEATHER_URL: z.string().default("https://api.open-meteo.com"),
  // OSRM publico, so como referencia externa para comparar com a rota da IA.
  ROUTER_URL: z.string().default("https://router.project-osrm.org"),
  GEO_USER_AGENT: z.string().default("ZENO-dispatch-console/1.0"),

  VEHICLE_SIGNAL_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(3600).default(120),
  VEHICLE_STOP_DISTANCE_METERS: z.coerce.number().positive().max(1000).default(30),
  VEHICLE_STOP_WINDOW_MINUTES: z.coerce.number().min(1).max(60).default(3),
  VEHICLE_DESTINATION_RADIUS_METERS: z.coerce.number().positive().max(2000).default(150),
  ROUTE_WET_ROAD_PRECIPITATION_MM: z.coerce.number().nonnegative().default(0.5)
})

export const env = envSchema.parse(process.env)

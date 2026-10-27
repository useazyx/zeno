import { fastify, FastifyError } from "fastify";
import { fastifyCors } from "@fastify/cors";
import { fastifyHelmet } from "@fastify/helmet";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import dotenv from 'dotenv';
import fastifyRateLimit from "@fastify/rate-limit";
import { realtimePlugin } from "./plugins/realtime.js";
import { routes } from "./routes/index.js";
import { vehicleMonitoringPlugin } from "./plugins/vehicle-monitoring.js";

dotenv.config()

const HTTP_PORT = env.PORT
const HTTP_HOST = env.HOST

const server = fastify({ logger: true }).withTypeProvider<ZodTypeProvider>()

async function start(): Promise<void> {

  await server.register(fastifyHelmet, {
    contentSecurityPolicy: false
  })

  await server.register(fastifyRateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      error: "Too many requests. Please slow down",
      statusCode: 429,
    }),
    allowList: ["127.0.0.1", "::1"],
  })

  await server.register(fastifyCors, {
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })

  await server.register(realtimePlugin, { prefix: "/api/v1" })

  await server.register(routes, { prefix: "/api/v1" })
  await server.register(vehicleMonitoringPlugin)

  server.listen({
    host: HTTP_HOST,
    port: HTTP_PORT
  }).then(() => {
    console.log(`HTTP SERVER RUNNING ON PORT ${HTTP_PORT}`)
  }).catch((err: FastifyError) => {
    console.error(`ERROR ON TRYING TO RUN THE HTTP SERVER: ${err}`)
    process.exit(1)
  })
}

start()

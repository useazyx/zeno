import type { FastifyReply, FastifyRequest } from "fastify"
import { promisify } from "node:util"
import { gzip } from "node:zlib"
import { z } from "zod/v4"
import { handleError } from "../../errors/handle-error.js"
import { EdgeCostsService } from "../../services/ai/edge-costs-service.js"

const compress = promisify(gzip)
const QUERY_SCHEMA = z.object({
  bbox: z.string().max(160).refine(value => {
    const parts = value.split(",")
    if (parts.length !== 4 || parts.some(part => !part.trim())) return false
    const [west, south, east, north] = parts.map(Number)
    return [west, south, east, north].every(Number.isFinite)
      && west! >= -180 && east! <= 180 && west! < east!
      && south! >= -90 && north! <= 90 && south! < north!
  }, "bbox deve ser minLon,minLat,maxLon,maxLat").optional(),
})

export class EdgeCostsController {
  async handle(req: FastifyRequest, rep: FastifyReply) {
    try {
      const { bbox } = QUERY_SCHEMA.parse(req.query)
      const normalized = bbox?.split(",").map(Number).join(",")
      const result = await new EdgeCostsService().execute(normalized)
      rep.header("Vary", "Accept-Encoding")
      const acceptsGzip = (req.headers["accept-encoding"] ?? "").split(",").some(value => {
        const [coding, quality] = value.trim().split(";")
        return coding === "gzip" && (!quality || Number(quality.trim().replace("q=", "")) > 0)
      })
      if (acceptsGzip) return rep.type("application/geo+json").header("Content-Encoding", "gzip").send(await compress(JSON.stringify(result)))
      return rep.type("application/geo+json").send(result)
    } catch (error) {
      return handleError(error, rep, "EdgeCosts")
    }
  }
}

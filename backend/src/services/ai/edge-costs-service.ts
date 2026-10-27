import { ServiceUnavailableError } from "../../errors/index.js"
import { AiClient, type EdgeCostsResponse } from "./ai-client.js"
import { RoutingOverlayCache } from "./routing-overlay-cache.js"

const cache = new RoutingOverlayCache<EdgeCostsResponse>()

export class EdgeCostsService {
  async execute(bbox?: string): Promise<EdgeCostsResponse> {
    const client = new AiClient()
    const model = await client.getModelInfo()
    if (!model.loaded) throw new ServiceUnavailableError("O modelo de rotas ainda está carregando")
    const key = JSON.stringify([model.model_version, bbox ?? null])
    const cached = cache.get(key)
    if (cached) return cached
    const result = await client.edgeCosts(bbox)
    cache.set(JSON.stringify([result.model_version, bbox ?? null]), result)
    return result
  }
}

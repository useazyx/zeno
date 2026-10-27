import { prisma } from "../../config/prisma.js"
import { BadRequestError, ServiceUnavailableError } from "../../errors/index.js"
import { AiClient, type Isochrone } from "../ai/ai-client.js"
import { RoutingOverlayCache } from "../ai/routing-overlay-cache.js"

const MAX_AREA_UNITS = 50
interface UnitAreasResponse {
  critical_mode: boolean
  model_version: string | null
  areas: { unit_id: string, acronym: string, area: Isochrone["geometry"], reached_nodes: number, in_network: boolean }[]
}
const cache = new RoutingOverlayCache<UnitAreasResponse>()

export class UnitAreasService {
  async execute(critical_mode: boolean): Promise<UnitAreasResponse> {
    const units = await prisma.unit.findMany({
      where: { active: true, type: { in: ["POSTO", "SUBGRUPAMENTO"] } },
      select: { id: true, acronym: true, latitude: true, longitude: true },
      orderBy: { id: "asc" },
      take: MAX_AREA_UNITS + 1,
    })
    if (units.length > MAX_AREA_UNITS) throw new BadRequestError("O cálculo permite até 50 quartéis operacionais")
    if (!units.length) return { critical_mode, model_version: null, areas: [] }
    const client = new AiClient()
    const model = await client.getModelInfo()
    if (!model.loaded) throw new ServiceUnavailableError("O modelo de rotas ainda está carregando")
    // Inclui identidade, sigla e posição: mudar o quartel invalida o desenho.
    const signature = units.map(unit => [unit.id, unit.acronym, String(unit.latitude), String(unit.longitude)])
    const key = JSON.stringify([model.model_version, critical_mode, signature])
    const cached = cache.get(key)
    if (cached) return cached
    const computed = await client.unitAreas(units.map(unit => ({ latitude: Number(unit.latitude), longitude: Number(unit.longitude) })), critical_mode)
    const skipped = new Set(computed.skipped_origins)
    const result = {
      critical_mode, model_version: computed.model_version,
      areas: units.map((unit, index) => {
        const area = computed.areas.find(area => area.origin_index === index)
        return { unit_id: unit.id, acronym: unit.acronym, area: area?.area ?? null, reached_nodes: area?.reached_nodes ?? 0, in_network: !skipped.has(index) }
      }),
    }
    cache.set(JSON.stringify([computed.model_version, critical_mode, signature]), result)
    return result
  }
}

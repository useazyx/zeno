jest.mock("../../../../src/config/prisma.js", () => ({ prisma: { unit: { findMany: jest.fn() } } }))

const getModelInfo = jest.fn()
const edgeCosts = jest.fn()
const unitAreas = jest.fn()
jest.mock("../../../../src/services/ai/ai-client.js", () => ({
  AiClient: class {
    getModelInfo = (...args: unknown[]) => getModelInfo(...args)
    edgeCosts = (...args: unknown[]) => edgeCosts(...args)
    unitAreas = (...args: unknown[]) => unitAreas(...args)
  }
}))

import { prisma } from "../../../../src/config/prisma.js"
import { EdgeCostsService } from "../../../../src/services/ai/edge-costs-service.js"
import { UnitAreasService } from "../../../../src/services/unit/unit-areas-service.js"

const findMany = prisma.unit.findMany as jest.Mock

describe("routing overlays", () => {
  it("caches streets by bbox and invalidates when the model changes", async () => {
    const service = new EdgeCostsService()
    getModelInfo.mockResolvedValue({ loaded: true, model_version: "edges-first" })
    const first = { type: "FeatureCollection", model_version: "edges-first", features: [] }
    edgeCosts.mockResolvedValue(first)
    expect(await service.execute("-46,-24,-45,-23")).toEqual(first)
    await service.execute("-46,-24,-45,-23")
    expect(edgeCosts).toHaveBeenCalledTimes(1)
    getModelInfo.mockResolvedValue({ loaded: true, model_version: "edges-next" })
    const next = { ...first, model_version: "edges-next" }
    edgeCosts.mockResolvedValue(next)
    expect(await service.execute("-46,-24,-45,-23")).toEqual(next)
    expect(edgeCosts).toHaveBeenCalledTimes(2)
  })

  it("maps computed areas to real operational units and notices position changes", async () => {
    const service = new UnitAreasService()
    getModelInfo.mockResolvedValue({ loaded: true, model_version: "areas-first" })
    const units = [{ id: "u1", acronym: "PB-1", latitude: "-23.02", longitude: "-45.5" }]
    findMany.mockResolvedValue(units)
    unitAreas.mockResolvedValue({ model_version: "areas-first", skipped_origins: [], areas: [{ origin_index: 0, area: null, reached_nodes: 8 }] })
    const result = await service.execute(false)
    expect(result.areas).toEqual([{ unit_id: "u1", acronym: "PB-1", area: null, reached_nodes: 8, in_network: true }])
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, type: { in: ["POSTO", "SUBGRUPAMENTO"] } } }))
    await service.execute(false)
    expect(unitAreas).toHaveBeenCalledTimes(1)
    findMany.mockResolvedValue([{ ...units[0], latitude: "-23.03" }])
    await service.execute(false)
    expect(unitAreas).toHaveBeenCalledTimes(2)
  })

  it("does not invent polygons when no operational unit exists", async () => {
    findMany.mockResolvedValue([])
    expect(await new UnitAreasService().execute(false)).toEqual({ model_version: null, critical_mode: false, areas: [] })
    expect(unitAreas).not.toHaveBeenCalled()
  })
})

jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: { dispatch: { findMany: jest.fn() } }
}))

import { prisma } from "../../../../src/config/prisma.js"
import { EtaAccuracyService, summarizeEta } from "../../../../src/services/ai/eta-accuracy-service.js"

const findMany = prisma.dispatch.findMany as jest.Mock
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 1, 12, 0, seconds))

describe("summarizeEta", () => {
  it("reports error, bias and how often the model lands within a minute", () => {
    const summary = summarizeEta([
      { predicted_seconds: 300, actual_seconds: 360 },
      { predicted_seconds: 200, actual_seconds: 180 },
      { predicted_seconds: 600, actual_seconds: 700 },
      { predicted_seconds: 100, actual_seconds: 100 },
    ])

    expect(summary).toEqual({
      count: 4,
      mae_seconds: 45,
      bias_seconds: 35,
      mape: 0.105,
      p90_abs_error_seconds: 100,
      within_60s: 0.75
    })
  })

  it("has nothing to say about no samples", () => {
    expect(summarizeEta([])).toBeNull()
  })
})

describe("EtaAccuracyService", () => {
  it("measures from dispatch to arrival, drops implausible ones and flags the demo history", async () => {
    const route = (seconds: number, version: string) => ({ algorithm: "NEURAL", estimated_time_seconds: seconds, model_version: version })
    findMany.mockResolvedValueOnce([
      { id: "d1", occurrence_id: "o1", dispatched_at: at(0), arrived_at: at(300), occurrence: { protocol: "P1" }, used_route: route(280.4, "1787837153") },
      { id: "d2", occurrence_id: "o2", dispatched_at: at(0), arrived_at: new Date(at(0).getTime() + 5 * 3600_000), occurrence: { protocol: "P2" }, used_route: route(200, "1787837153") },
      { id: "d3", occurrence_id: "o3", dispatched_at: at(0), arrived_at: at(200), occurrence: { protocol: "P3" }, used_route: route(150, "demo-reconstruction:1") },
    ])

    const result = await new EtaAccuracyService().execute({ limit: 100 })

    expect(result.samples.map((sample) => [sample.protocol, sample.predicted_seconds, sample.actual_seconds, sample.demo])).toEqual([
      ["P1", 280, 300, false],
      ["P3", 150, 200, true],
    ])
    expect(result.live_summary?.count).toBe(1)
    expect(result.demo_share).toBe(0.5)
  })
})

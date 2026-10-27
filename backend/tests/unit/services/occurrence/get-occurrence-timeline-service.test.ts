jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: { occurrence: { findUnique: jest.fn() } }
}))

import { prisma } from "../../../../src/config/prisma.js"
import { NotFoundError } from "../../../../src/errors/index.js"
import { GetOccurrenceTimelineService } from "../../../../src/services/occurrence/get-occurrence-timeline-service.js"

const findUnique = prisma.occurrence.findUnique as jest.Mock
const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 12, minute))

const dispatch = {
  id: "d1",
  status: "FINALIZADO",
  dispatched_at: at(2),
  arrived_at: at(9),
  finished_at: at(40),
  vehicle: { prefix: "ABT-11201" }
}

describe("GetOccurrenceTimelineService", () => {
  const service = new GetOccurrenceTimelineService()

  it("throws NotFoundError for an unknown occurrence", async () => {
    findUnique.mockResolvedValueOnce(null)
    await expect(service.execute("missing")).rejects.toThrow(NotFoundError)
  })

  it("rebuilds the milestones of an occurrence older than the log", async () => {
    findUnique.mockResolvedValueOnce({
      id: "o1", status: "ENCERRADA", priority: "ALTA",
      opened_at: at(0), closed_at: at(45),
      events: [],
      dispatches: [dispatch]
    })

    const { events } = await service.execute("o1")

    expect(events.map((event) => [event.type, event.to_value])).toEqual([
      ["ABERTURA", "ALTA"],
      ["DESPACHO", "DESPACHADO"],
      ["DESPACHO_STATUS", "NO_LOCAL"],
      ["DESPACHO_STATUS", "FINALIZADO"],
      ["STATUS", "ENCERRADA"],
    ])
    expect(events.every((event) => event.derived)).toBe(true)
    expect(events[1].vehicle_prefix).toBe("ABT-11201")
  })

  it("prefers the logged line over the timestamp it duplicates", async () => {
    findUnique.mockResolvedValueOnce({
      id: "o1", status: "EM_ATENDIMENTO", priority: "MEDIA",
      opened_at: at(0), closed_at: null,
      events: [
        { id: "e1", type: "ABERTURA", created_at: at(0), message: null, from_value: null, to_value: "MEDIA", dispatch_id: null },
        { id: "e2", type: "DESPACHO", created_at: at(2), message: "ABT-11201", from_value: null, to_value: "DESPACHADO", dispatch_id: "d1" },
        { id: "e3", type: "NOTA", created_at: at(5), message: "Vítima consciente", from_value: null, to_value: null, dispatch_id: null },
        { id: "e4", type: "DESPACHO_STATUS", created_at: at(9), message: null, from_value: "A_CAMINHO", to_value: "NO_LOCAL", dispatch_id: "d1" },
      ],
      dispatches: [{ ...dispatch, status: "NO_LOCAL", finished_at: null }]
    })

    const { events } = await service.execute("o1")

    expect(events.map((event) => event.id)).toEqual(["e1", "e2", "e3", "e4"])
    expect(events.find((event) => event.id === "e4")?.vehicle_prefix).toBe("ABT-11201")
  })

  it("keeps the opening first when a dispatch shares its timestamp", async () => {
    findUnique.mockResolvedValueOnce({
      id: "o1", status: "DESPACHADA", priority: "BAIXA",
      opened_at: at(0), closed_at: null,
      events: [],
      dispatches: [{ ...dispatch, status: "DESPACHADO", dispatched_at: at(0), arrived_at: null, finished_at: null }]
    })

    const { events } = await service.execute("o1")
    expect(events.map((event) => event.type)).toEqual(["ABERTURA", "DESPACHO"])
  })
})

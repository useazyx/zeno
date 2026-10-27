jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: { occurrenceEvent: { createMany: jest.fn() } }
}))

import { prisma } from "../../../../src/config/prisma.js"
import { eventHub } from "../../../../src/realtime/event-hub.js"
import { recordOccurrenceEvents } from "../../../../src/services/occurrence/occurrence-events.js"

const createMany = prisma.occurrenceEvent.createMany as jest.Mock

describe("recordOccurrenceEvents", () => {
  const publish = jest.spyOn(eventHub, "publish").mockImplementation(() => {})
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {})

  afterEach(() => {
    publish.mockClear()
    consoleError.mockClear()
  })

  it("writes every line and tells each console once per occurrence", async () => {
    createMany.mockResolvedValueOnce({ count: 2 })

    await recordOccurrenceEvents([
      { occurrence_id: "o1", type: "STATUS", from_value: "ABERTA", to_value: "DESPACHADA" },
      { occurrence_id: "o1", type: "DESPACHO", dispatch_id: "d1", message: "ABT-1" },
    ])

    expect(createMany).toHaveBeenCalledWith({
      data: [
        { occurrence_id: "o1", type: "STATUS", dispatch_id: null, message: null, from_value: "ABERTA", to_value: "DESPACHADA" },
        { occurrence_id: "o1", type: "DESPACHO", dispatch_id: "d1", message: "ABT-1", from_value: null, to_value: null },
      ]
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith({ type: "occurrence.timeline", payload: { occurrence_id: "o1" } })
  })

  it("never lets a logging failure reach the operation it describes", async () => {
    createMany.mockRejectedValueOnce(new Error("database hiccup"))

    await expect(recordOccurrenceEvents([{ occurrence_id: "o1", type: "ABERTURA" }])).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it("does nothing for an empty list", async () => {
    await recordOccurrenceEvents([])
    expect(createMany).not.toHaveBeenCalled()
  })
})

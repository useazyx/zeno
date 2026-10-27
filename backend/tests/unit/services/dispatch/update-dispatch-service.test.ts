jest.mock("../../../../src/config/prisma.js", () => {
  const tx = {
    dispatch: { update: jest.fn() },
    vehicle: { update: jest.fn() },
    occurrence: { updateMany: jest.fn() }
  }

  return {
    prisma: {
      dispatch: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      occurrenceEvent: { createMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      __tx: tx
    }
  }
})

import { BadRequestError, NotFoundError } from "../../../../src/errors/index.js"
import { prisma } from "../../../../src/config/prisma.js"
import { eventHub } from "../../../../src/realtime/event-hub.js"
import { UpdateDispatchService } from "../../../../src/services/dispatch/update-dispatch-service.js"

const mockPrisma = prisma as unknown as {
  dispatch: { findUnique: jest.Mock, findUniqueOrThrow: jest.Mock },
  occurrenceEvent: { createMany: jest.Mock },
  $transaction: jest.Mock,
  __tx: { dispatch: { update: jest.Mock }, vehicle: { update: jest.Mock }, occurrence: { updateMany: jest.Mock } }
}

describe("UpdateDispatchService", () => {
  const service = new UpdateDispatchService()
  const publishSpy = jest.spyOn(eventHub, "publish").mockImplementation(() => {})

  beforeEach(() => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma.__tx))
  })

  afterEach(() => publishSpy.mockClear())

  it("throws NotFoundError when the dispatch does not exist", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce(null)

    await expect(service.execute({ id: "missing", status: "A_CAMINHO" })).rejects.toThrow(NotFoundError)
  })

  it("returns the dispatch unchanged (no transition) when the status is the same", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce({
      id: "d1", status: "DESPACHADO", vehicle_id: "v1", occurrence_id: "occ1"
    })
    mockPrisma.dispatch.findUniqueOrThrow.mockResolvedValueOnce({ id: "d1", status: "DESPACHADO" })

    const result = await service.execute({ id: "d1", status: "DESPACHADO" })

    expect(result).toEqual({ id: "d1", status: "DESPACHADO" })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it("throws BadRequestError for a disallowed transition", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce({
      id: "d1", status: "DESPACHADO", vehicle_id: "v1", occurrence_id: "occ1"
    })

    await expect(service.execute({ id: "d1", status: "NO_LOCAL" }))
      .rejects.toThrow("A dispatch cannot go from DESPACHADO to NO_LOCAL")
  })

  it("releases the vehicle back to DISPONIVEL when finishing the dispatch", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce({
      id: "d1", status: "RETORNANDO", vehicle_id: "v1", occurrence_id: "occ1"
    })
    mockPrisma.__tx.dispatch.update.mockResolvedValueOnce({ id: "d1", status: "FINALIZADO", occurrence_id: "occ1" })

    await service.execute({ id: "d1", status: "FINALIZADO" })

    expect(mockPrisma.__tx.vehicle.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { status: "DISPONIVEL" } })
  })

  it("releases the vehicle when a dispatch is cancelled", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce({
      id: "d1", status: "DESPACHADO", vehicle_id: "v1", occurrence_id: "occ1"
    })
    mockPrisma.__tx.dispatch.update.mockResolvedValueOnce({ id: "d1", status: "CANCELADO", occurrence_id: "occ1" })

    await service.execute({ id: "d1", status: "CANCELADO" })

    expect(mockPrisma.__tx.vehicle.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { status: "DISPONIVEL" } })
  })

  it("moves the occurrence to EM_ATENDIMENTO when the crew arrives on scene", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce({
      id: "d1", status: "A_CAMINHO", vehicle_id: "v1", occurrence_id: "occ1"
    })
    mockPrisma.__tx.dispatch.update.mockResolvedValueOnce({ id: "d1", status: "NO_LOCAL", occurrence_id: "occ1" })

    await service.execute({ id: "d1", status: "NO_LOCAL" })

    expect(mockPrisma.__tx.occurrence.updateMany).toHaveBeenCalledWith({
      where: { id: "occ1", status: "DESPACHADA" },
      data: { status: "EM_ATENDIMENTO" }
    })
    expect(mockPrisma.__tx.vehicle.update).not.toHaveBeenCalled()
  })

  it("logs the arrival and the start of attendance on the timeline", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce({
      id: "d1", status: "A_CAMINHO", vehicle_id: "v1", occurrence_id: "occ1"
    })
    mockPrisma.__tx.dispatch.update.mockResolvedValueOnce({ id: "d1", status: "NO_LOCAL", occurrence_id: "occ1" })
    mockPrisma.__tx.occurrence.updateMany.mockResolvedValueOnce({ count: 1 })

    await service.execute({ id: "d1", status: "NO_LOCAL" })

    const { data } = mockPrisma.occurrenceEvent.createMany.mock.calls[0][0]
    expect(data.map((event: any) => [event.type, event.from_value, event.to_value, event.dispatch_id])).toEqual([
      ["DESPACHO_STATUS", "A_CAMINHO", "NO_LOCAL", "d1"],
      ["STATUS", "DESPACHADA", "EM_ATENDIMENTO", null],
    ])
  })

  it("publishes a dispatch.updated event with the new status", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce({
      id: "d1", status: "DESPACHADO", vehicle_id: "v1", occurrence_id: "occ1"
    })
    mockPrisma.__tx.dispatch.update.mockResolvedValueOnce({ id: "d1", status: "A_CAMINHO", occurrence_id: "occ1" })

    await service.execute({ id: "d1", status: "A_CAMINHO" })

    expect(publishSpy).toHaveBeenCalledWith({
      type: "dispatch.updated",
      payload: { id: "d1", occurrence_id: "occ1", status: "A_CAMINHO" }
    })
  })

  it("rejects any transition out of a terminal state", async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValueOnce({
      id: "d1", status: "FINALIZADO", vehicle_id: "v1", occurrence_id: "occ1"
    })

    await expect(service.execute({ id: "d1", status: "A_CAMINHO" })).rejects.toThrow(BadRequestError)
  })
})

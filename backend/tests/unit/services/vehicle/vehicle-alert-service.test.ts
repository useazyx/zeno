jest.mock("../../../../src/config/prisma.js", () => ({ prisma: {
  dispatch: { findMany: jest.fn() },
  vehiclePosition: { findFirst: jest.fn(), findMany: jest.fn() },
  occurrenceEvent: { createMany: jest.fn() }
} }))

import { prisma } from "../../../../src/config/prisma.js"
import { eventHub } from "../../../../src/realtime/event-hub.js"
import { VehicleAlertService } from "../../../../src/services/vehicle/vehicle-alert-service.js"

const dispatch = (reportedAt: Date) => ({
  id: "d1", vehicle_id: "v1", occurrence_id: "o1", status: "A_CAMINHO", dispatched_at: new Date("2026-10-07T11:30:00Z"),
  occurrence: { latitude: -23.02, longitude: -45 },
  vehicle: { id: "v1", prefix: "ABT-1", current_latitude: -23, current_longitude: -45, last_position_at: reportedAt }
})

describe("VehicleAlertService", () => {
  const now = new Date("2026-10-07T12:00:00Z")
  beforeEach(() => jest.useFakeTimers().setSystemTime(now))
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

  it("emits signal loss once and clears it after a new report", async () => {
    const service = new VehicleAlertService()
    const publish = jest.spyOn(eventHub, "publish")
    ;(prisma.dispatch.findMany as jest.Mock).mockResolvedValue([dispatch(new Date("2026-10-07T11:55:00Z"))])
    await service.execute()
    jest.advanceTimersByTime(30_000)
    await service.execute()
    expect(publish.mock.calls.filter(([event]) => event.type === "vehicle.alert")).toHaveLength(1)
    expect(publish).toHaveBeenCalledWith({ type: "vehicle.alert", payload: expect.objectContaining({ kind: "sem_sinal", vehicle_id: "v1", dispatch_id: "d1" }) })
    expect(prisma.occurrenceEvent.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ occurrence_id: "o1", dispatch_id: "d1", type: "NOTA" })] })

    ;(prisma.dispatch.findMany as jest.Mock).mockResolvedValue([dispatch(new Date())])
    ;(prisma.vehiclePosition.findMany as jest.Mock).mockResolvedValue([])
    await service.execute()
    expect(publish.mock.calls.filter(([event]) => event.type === "vehicle.alert_cleared")).toHaveLength(1)
    expect(prisma.dispatch.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "A_CAMINHO" } }))
  })

  it("detects a stopped vehicle far from its destination and clears on movement", async () => {
    const service = new VehicleAlertService()
    const publish = jest.spyOn(eventHub, "publish")
    ;(prisma.dispatch.findMany as jest.Mock).mockResolvedValue([dispatch(now)])
    ;(prisma.vehiclePosition.findFirst as jest.Mock).mockResolvedValue({ latitude: -23, longitude: -45, recorded_at: new Date("2026-10-07T11:57:00Z") })
    ;(prisma.vehiclePosition.findMany as jest.Mock).mockResolvedValue([{ latitude: -23, longitude: -45, recorded_at: now }])
    await service.execute()
    await service.execute()
    expect(publish.mock.calls.filter(([event]) => event.type === "vehicle.alert")).toHaveLength(1)
    expect(publish).toHaveBeenCalledWith({ type: "vehicle.alert", payload: expect.objectContaining({ kind: "parada" }) })

    ;(prisma.dispatch.findMany as jest.Mock).mockResolvedValue([{ ...dispatch(now), vehicle: { ...dispatch(now).vehicle, current_latitude: -23.002 } }])
    await service.execute()
    expect(publish).toHaveBeenCalledWith({ type: "vehicle.alert_cleared", payload: expect.objectContaining({ kind: "parada" }) })
  })

  it("does not label a vehicle stopped without a full time window or next to the destination", async () => {
    const service = new VehicleAlertService()
    const publish = jest.spyOn(eventHub, "publish")
    ;(prisma.dispatch.findMany as jest.Mock).mockResolvedValue([dispatch(now)])
    ;(prisma.vehiclePosition.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.vehiclePosition.findMany as jest.Mock).mockResolvedValue([])
    await service.execute()
    ;(prisma.dispatch.findMany as jest.Mock).mockResolvedValue([{ ...dispatch(now), occurrence: { latitude: -23.00001, longitude: -45 } }])
    await service.execute()
    expect(publish.mock.calls.filter(([event]) => event.type === "vehicle.alert")).toHaveLength(0)
  })

  it("clears active alerts when the dispatch leaves A_CAMINHO", async () => {
    const service = new VehicleAlertService()
    const publish = jest.spyOn(eventHub, "publish")
    ;(prisma.dispatch.findMany as jest.Mock).mockResolvedValueOnce([dispatch(new Date("2026-10-07T11:55:00Z"))]).mockResolvedValueOnce([])
    await service.execute()
    await service.execute()
    expect(publish).toHaveBeenCalledWith({ type: "vehicle.alert_cleared", payload: expect.objectContaining({ dispatch_id: "d1" }) })
  })
})

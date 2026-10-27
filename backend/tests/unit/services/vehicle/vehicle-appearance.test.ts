jest.mock("../../../../src/config/prisma.js", () => ({ prisma: { vehicle: { findUnique: jest.fn(), update: jest.fn() } } }))

import { prisma } from "../../../../src/config/prisma.js"
import { UpdateVehicleService } from "../../../../src/services/vehicle/update-vehicle-service.js"
import { vehicleAppearanceSchema } from "../../../../src/services/vehicle/vehicle-appearance.js"

const appearance = { variant: "ABT", body_color: "vermelho_bombeiro", stripe_color: "branco", show_prefix: true, unit_badge: false } as const

describe("vehicle appearance", () => {
  it("accepts the institutional palette and rejects arbitrary colors", () => {
    expect(vehicleAppearanceSchema.safeParse(appearance).success).toBe(true)
    expect(vehicleAppearanceSchema.safeParse({ ...appearance, body_color: "#ff0000" }).success).toBe(false)
    expect(vehicleAppearanceSchema.safeParse({ ...appearance, variant: "spaceship" }).success).toBe(false)
  })

  it("rejects a model variant belonging to another vehicle type", async () => {
    ;(prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: "v1", type: "UR" })
    await expect(new UpdateVehicleService().execute({ id: "v1", appearance })).rejects.toThrow("tipo")
    expect(prisma.vehicle.update).not.toHaveBeenCalled()
  })

  it("uses database null to reset the appearance", async () => {
    ;(prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: "v1", type: "ABT" })
    ;(prisma.vehicle.update as jest.Mock).mockResolvedValue({ id: "v1", appearance: null })
    const result = await new UpdateVehicleService().execute({ id: "v1", appearance: null })
    expect(result.appearance).toBeNull()
    expect(prisma.vehicle.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appearance: expect.anything() }) }))
  })
})

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/prisma.js";
import { ListVehiclePositionsService } from "../src/services/vehicle/list-vehicle-positions-service.js";
import { CleanVehiclePositionsService } from "../src/services/vehicle/clean-vehicle-positions-service.js";

// Verificação real do PostgreSQL. Tudo, inclusive os dados de teste, sofre rollback.
const rollback = new Error("ROLLBACK_VERIFICATION")
const originalQuery = prisma.$queryRaw
const originalFind = prisma.vehicle.findUnique
const originalDelete = prisma.vehiclePosition.deleteMany
const originalNow = Date.now
let checked = false

try {
  await prisma.$transaction(async (transaction) => {
    const tag = randomUUID()
    const unit = await transaction.unit.create({ data: {
      name: "Verificação temporária", acronym: tag, type: "POSTO", address: "Teste",
      latitude: -23, longitude: -45, phone: "0"
    } })
    const vehicle = await transaction.vehicle.create({ data: {
      prefix: tag, plate: tag, type: "ABT", model: "Verificação", year: 2026, crew_capacity: 4, unit_id: unit.id
    } })
    const now = new Date()
    const from = new Date(now.getTime() - 12 * 60 * 60_000)
    await transaction.$executeRaw`
      INSERT INTO vehicle_position (id, vehicle_id, latitude, longitude, recorded_at)
      SELECT ${tag} || '-' || sample, ${vehicle.id}, -23 + sample * 0.00000001, -45,
        ${from}::timestamp + sample * INTERVAL '1 second'
      FROM generate_series(0, 9999) AS sample
    `

    // Os serviços usam a mesma transação para enxergar a massa sem publicá-la.
    prisma.$queryRaw = transaction.$queryRaw.bind(transaction)
    prisma.vehicle.findUnique = transaction.vehicle.findUnique.bind(transaction.vehicle)
    prisma.vehiclePosition.deleteMany = transaction.vehiclePosition.deleteMany.bind(transaction.vehiclePosition)
    const result = await new ListVehiclePositionsService().execute({ vehicle_id: vehicle.id, from, to: now })
    assert.equal(result.total, 10_000)
    assert.equal(result.sampled, true)
    assert.ok("positions" in result && result.positions)
    assert.equal(result.positions.length, 5_000)
    assert.equal(result.positions[0].recorded_at, from.toISOString())
    assert.equal(result.positions.at(-1)!.recorded_at, new Date(from.getTime() + 9_999_000).toISOString())
    for (let index = 1; index < result.positions.length; index++) {
      const gap = Date.parse(result.positions[index].recorded_at) - Date.parse(result.positions[index - 1].recorded_at)
      assert.ok(gap === 2000 || gap === 3000, `Intervalo inesperado na amostragem: ${gap}`)
    }

    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000)
    await transaction.vehiclePosition.createMany({ data: [
      { id: `${tag}-old`, vehicle_id: vehicle.id, latitude: -23, longitude: -45, recorded_at: new Date(cutoff.getTime() - 1) },
      { id: `${tag}-boundary`, vehicle_id: vehicle.id, latitude: -23, longitude: -45, recorded_at: cutoff }
    ] })
    Date.now = () => now.getTime()
    await new CleanVehiclePositionsService().execute()
    assert.equal(await transaction.vehiclePosition.count({ where: { id: `${tag}-old` } }), 0)
    assert.equal(await transaction.vehiclePosition.count({ where: { id: `${tag}-boundary` } }), 1)
    checked = true
    throw rollback
  }, { maxWait: 30_000, timeout: 60_000 })
} catch (error) {
  if (error !== rollback) throw error
} finally {
  prisma.$queryRaw = originalQuery
  prisma.vehicle.findUnique = originalFind
  prisma.vehiclePosition.deleteMany = originalDelete
  Date.now = originalNow
  await prisma.$disconnect()
}

assert.ok(checked)
console.log("Histórico: 10.000 pontos → 5.000 uniformes, extremos preservados; retenção estrita confirmada. Rollback concluído.")

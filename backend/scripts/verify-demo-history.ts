import assert from "node:assert/strict"
import { prisma } from "../src/config/prisma.js"

try {
  const [coverage] = await prisma.$queryRaw<Array<{
    total: number; years: number; months: number; first: Date; last: Date
  }>>`
    SELECT count(*)::int AS total,
      count(DISTINCT extract(year FROM opened_at - interval '3 hours'))::int AS years,
      count(DISTINCT date_trunc('month', opened_at - interval '3 hours'))::int AS months,
      min(opened_at) AS first, max(opened_at) AS last FROM occurrence
  `
  assert(coverage.total >= 70000, "Volume inferior ao esperado")
  assert.equal(coverage.years, 26)
  assert.equal(coverage.months, 309)
  assert(coverage.first >= new Date("2001-01-01T03:00:00Z"))
  assert(coverage.first < new Date("2001-01-02T03:00:00Z"))
  assert(coverage.last >= new Date("2026-09-24T03:00:00Z"))
  assert(coverage.last <= new Date("2026-09-25T03:00:00Z"))

  const [invalid] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM dispatch d
    JOIN occurrence o ON o.id = d.occurrence_id
    WHERE d.dispatched_at < o.opened_at
      OR d.arrived_at < d.dispatched_at
      OR d.finished_at < d.arrived_at
      OR (d.status = 'FINALIZADO' AND (d.finished_at IS NULL OR d.arrived_at IS NULL))
      OR d.finished_at IS DISTINCT FROM o.closed_at
  `
  assert.equal(invalid.count, 0, "Cronologia dos atendimentos inconsistente")
  const [overlap] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM (
      SELECT dispatched_at, lag(coalesce(finished_at, 'infinity'::timestamp))
        OVER (PARTITION BY vehicle_id ORDER BY dispatched_at) AS previous_finish
      FROM dispatch
    ) intervals WHERE dispatched_at < previous_finish
  `
  assert.equal(overlap.count, 0, "Viaturas com atendimentos sobrepostos")
  const [badStatus] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM occurrence
    WHERE ((status IN ('ENCERRADA', 'CANCELADA')) <> (closed_at IS NOT NULL))
      OR closed_at < opened_at
      OR closed_at >= timestamp '2026-09-25 03:00:00'
      OR created_at <> opened_at
      OR description NOT LIKE '%[Cenário sintético de demonstração]%'
  `
  assert.equal(badStatus.count, 0, "Estado ou identificação sintética inconsistente")
  const [fleet] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM vehicle v
    WHERE (v.status = 'EMPENHADA') <> EXISTS (
      SELECT 1 FROM dispatch d WHERE d.vehicle_id = v.id AND d.status IN ('DESPACHADO', 'A_CAMINHO', 'NO_LOCAL', 'RETORNANDO')
    )
  `
  assert.equal(fleet.count, 0, "Situação da frota diverge dos despachos")
  console.log(JSON.stringify({ ...coverage, dispatches: await prisma.dispatch.count(),
    trainings: await prisma.trainingRun.count(), invalid: invalid.count, overlaps: overlap.count,
    fleetErrors: fleet.count }, null, 2))
} finally {
  await prisma.$disconnect()
}

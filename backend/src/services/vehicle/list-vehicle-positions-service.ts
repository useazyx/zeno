import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../errors/index.js";
import { POSITION_MAX_POINTS, POSITION_MAX_WINDOW_MS } from "./vehicle-position-policy.js";

interface ListPositionsRequest {
  vehicle_id?: string
  from?: Date
  to?: Date
}

interface PositionRow {
  id: string
  vehicle_id: string
  latitude: { toString(): string }
  longitude: { toString(): string }
  heading: number | null
  dispatch_id: string | null
  recorded_at: Date
  total_count: bigint
}

export class ListVehiclePositionsService {
  async execute({ vehicle_id, from, to }: ListPositionsRequest) {
    const end = to ?? new Date()
    const start = from ?? new Date(end.getTime() - POSITION_MAX_WINDOW_MS)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end || end.getTime() - start.getTime() > POSITION_MAX_WINDOW_MS) {
      throw new BadRequestError("Informe um intervalo válido de no máximo 24 horas.")
    }
    if (vehicle_id && !await prisma.vehicle.findUnique({ where: { id: vehicle_id }, select: { id: true } })) {
      throw new NotFoundError("Viatura não encontrada.")
    }

    // A amostragem acontece no banco: inclui extremos e distribui até 5 mil
    // pontos por toda a janela, sem carregar o histórico inteiro no Node.
    const rows = await prisma.$queryRaw<PositionRow[]>`
      WITH numbered AS (
        SELECT id, vehicle_id, latitude, longitude, heading, dispatch_id, recorded_at,
          ROW_NUMBER() OVER (ORDER BY recorded_at, id) AS position_index,
          COUNT(*) OVER () AS total_count
        FROM vehicle_position
        WHERE recorded_at >= ${start} AND recorded_at <= ${end}
          AND (${vehicle_id ?? null}::text IS NULL OR vehicle_id = ${vehicle_id ?? null}::text)
      ), boundaries AS (
        SELECT MAX(total_count) AS total FROM numbered
      ), chosen AS (
        SELECT 1 + FLOOR(sample::numeric * (total - 1)
          / GREATEST(1, LEAST(total, ${POSITION_MAX_POINTS}) - 1)) AS position_index
        FROM boundaries
        CROSS JOIN LATERAL generate_series(0, LEAST(total, ${POSITION_MAX_POINTS}) - 1) AS sample
      )
      SELECT numbered.id, vehicle_id, latitude, longitude, heading, dispatch_id, recorded_at, total_count
      FROM numbered JOIN chosen USING (position_index)
      ORDER BY recorded_at, id
    `
    const total = Number(rows[0]?.total_count ?? 0)
    const positions = rows.map(({ total_count: _count, ...point }) => ({
      ...point,
      latitude: String(point.latitude), longitude: String(point.longitude),
      recorded_at: point.recorded_at.toISOString()
    }))
    const metadata = { from: start.toISOString(), to: end.toISOString(), total, sampled: total > positions.length }
    if (vehicle_id) return { ...metadata, positions }

    const groups = new Map<string, typeof positions>()
    for (const point of positions) {
      const group = groups.get(point.vehicle_id) ?? []
      group.push(point)
      groups.set(point.vehicle_id, group)
    }
    return { ...metadata, vehicles: [...groups].map(([id, points]) => ({ vehicle_id: id, positions: points })) }
  }
}

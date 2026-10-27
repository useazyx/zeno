import assert from "node:assert/strict"
import { prisma } from "../src/config/prisma.js"

try {
  const counts = {
    units: await prisma.unit.count(), firefighters: await prisma.firefighter.count(),
    users: await prisma.user.count(), vehicles: await prisma.vehicle.count(),
    crews: await prisma.crew.count(), crewMembers: await prisma.crewMember.count(),
    shifts: await prisma.shift.count(), occurrences: await prisma.occurrence.count(),
    dispatches: await prisma.dispatch.count(), routes: await prisma.route.count(),
    trainings: await prisma.trainingRun.count(),
  }
  assert(counts.units >= 8 && counts.firefighters >= 528 && counts.users >= 48)
  assert(counts.vehicles >= 36 && counts.crews >= 40000 && counts.shifts >= 150000)
  assert(counts.routes >= 200 && counts.trainings >= 27)
  const checks: Record<string, string> = {
    historicalOpen: `SELECT count(*)::int AS count FROM occurrence WHERE opened_at < timestamp '2026-09-24 03:00:00' AND status NOT IN ('ENCERRADA','CANCELADA')`,
    missingCrew: `SELECT count(*)::int AS count FROM dispatch WHERE crew_id IS NULL`,
    vehicleEra: `SELECT count(*)::int AS count FROM dispatch d JOIN vehicle v ON v.id=d.vehicle_id WHERE v.year > extract(year FROM d.dispatched_at)`,
    units: `SELECT count(*)::int AS count FROM dispatch d JOIN vehicle v ON v.id=d.vehicle_id JOIN crew c ON c.id=d.crew_id JOIN occurrence o ON o.id=d.occurrence_id WHERE c.vehicle_id<>v.id OR c.unit_id<>v.unit_id OR o.unit_id<>v.unit_id`,
    crewWindow: `SELECT count(*)::int AS count FROM dispatch d JOIN crew c ON c.id=d.crew_id WHERE d.dispatched_at<c.started_at OR coalesce(d.finished_at,d.dispatched_at)>c.ended_at`,
    capacity: `SELECT count(*)::int AS count FROM (SELECT c.id FROM crew c JOIN vehicle v ON v.id=c.vehicle_id JOIN crew_member cm ON cm.crew_id=c.id GROUP BY c.id,v.crew_capacity HAVING count(*)>v.crew_capacity) x`,
    admission: `SELECT count(*)::int AS count FROM crew_member cm JOIN crew c ON c.id=cm.crew_id JOIN firefighter f ON f.id=cm.firefighter_id WHERE f.military_id LIKE 'DEMO-%' AND f.admission_date>c.started_at`,
    commander: `SELECT count(*)::int AS count FROM crew c WHERE c.name LIKE '%Equipe%' AND NOT EXISTS(SELECT 1 FROM crew_member cm WHERE cm.crew_id=c.id AND cm.firefighter_id=c.commander_id AND cm.role='COMANDANTE')`,
    staffOverlap: `SELECT count(*)::int AS count FROM (SELECT s.start_at,lag(s.end_at) OVER(PARTITION BY s.firefighter_id ORDER BY s.start_at) AS previous_end FROM shift s JOIN firefighter f ON f.id=s.firefighter_id WHERE f.military_id LIKE 'DEMO-%') x WHERE start_at<previous_end`,
    vehicleOverlap: `SELECT count(*)::int AS count FROM (SELECT dispatched_at,lag(coalesce(finished_at,'infinity'::timestamp)) OVER(PARTITION BY vehicle_id ORDER BY dispatched_at) AS previous_end FROM dispatch) x WHERE dispatched_at<previous_end`,
    activeCrew: `SELECT count(*)::int AS count FROM (SELECT vehicle_id FROM crew WHERE active GROUP BY vehicle_id HAVING count(*)>1) x`,
    activeStaff: `SELECT count(*)::int AS count FROM crew c JOIN crew_member cm ON cm.crew_id=c.id JOIN firefighter f ON f.id=cm.firefighter_id WHERE c.active AND f.status<>'ATIVO'`,
    routeOwnership: `SELECT count(*)::int AS count FROM dispatch d JOIN route r ON r.id=d.used_route_id WHERE r.dispatch_id<>d.id`,
    routeGeometry: `SELECT count(*)::int AS count FROM route WHERE jsonb_array_length(geometry)<2 OR distance_meters<0 OR estimated_time_seconds<0`,
    simulatedAccounts: `SELECT count(*)::int AS count FROM "user" WHERE email LIKE '%@demo.zeno.example' AND active`,
    simulatedModel: `SELECT count(*)::int AS count FROM training_run WHERE model_path LIKE 'demo://%' AND (external_job_id IS NOT NULL OR status<>'CONCLUIDO')`,
  }
  const results: Record<string, number> = {}
  for (const [name, query] of Object.entries(checks)) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ count: number }>>(query)
    results[name] = row.count
    assert.equal(row.count, 0, name)
  }
  for (const [endpoint, key, date] of [
    ["occurrences", "occurrences", "opened_at"], ["dispatches", "dispatches", "dispatched_at"],
    ["shifts", "shifts", "start_at"], ["crews", "crews", "started_at"],
    ["ai/training", "runs", "created_at"],
  ]) {
    const seen = new Set<string>()
    let previous = Infinity
    for (const page of [1, 2]) {
      const response = await fetch(`http://127.0.0.1:3333/api/v1/${endpoint}?per_page=10&page=${page}`)
      assert(response.ok, `${endpoint}: HTTP ${response.status}`)
      const body = await response.json() as Record<string, Array<Record<string, string>>>
      for (const row of body[key]) {
        const time = Date.parse(row[date])
        assert(time <= previous, `${endpoint}: ordem temporal invertida`)
        assert(!seen.has(row.id), `${endpoint}: duplicata na paginação`)
        previous = time
        seen.add(row.id)
      }
    }
  }
  console.log(JSON.stringify({ counts, integrity: results, apiOrdering: "passed" }, null, 2))
} finally { await prisma.$disconnect() }

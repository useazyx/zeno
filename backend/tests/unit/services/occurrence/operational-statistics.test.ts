import { operationalStatistics } from "../../../../src/services/occurrence/operational-statistics.js";

const a = { id: "a", acronym: "PB-A" };
const b = { id: "b", acronym: "PB-B" };
const opened = new Date("2026-01-01T10:00:00Z");
const incident = { id: "incident", protocol: "1", nature: "RESGATE", opened_at: opened, unit: a };
function deployment(id: string, unit = a) {
  return { id, occurrence_id: incident.id, status: "FINALIZADO", critical_mode: false,
    dispatched_at: new Date("2026-01-01T10:02:00Z"), arrived_at: new Date("2026-01-01T10:10:00Z"),
    finished_at: new Date("2026-01-01T11:00:00Z"), crew_id: "crew", vehicle: { id, prefix: id, unit }, used_route: null };
}
test("multiple vehicles do not multiply incidents or joint operations", () => {
  const result = operationalStatistics([incident], [deployment("v1"), deployment("v2"), deployment("v3", b)]);
  expect(result.joint_operations).toBe(1);
  expect(result.dispatched_incidents).toBe(1);
  expect(result.units.find((unit) => unit.id === a.id)).toMatchObject({ responsible: 1, incidents: 1, deployments: 2, vehicles: 2, crews: 1, response_seconds: 600, travel_seconds: 480, commitment_seconds: 3480, recorded_routes: 0 });
  expect(result.units.find((unit) => unit.id === b.id)?.responsible).toBe(0);
  expect(result.cooperation).toEqual([{ units: ["PB-A", "PB-B"], incidents: 1 }]);
});
test("cancelled dispatches and invalid times are excluded from operational metrics", () => {
  const result = operationalStatistics([incident], [
    { ...deployment("cancel", b), status: "CANCELADO" },
    { ...deployment("invalid"), arrived_at: new Date("2025-12-01"), finished_at: null },
  ]);
  expect(result.joint_operations).toBe(0);
  expect(result.units.find((unit) => unit.id === a.id)).toMatchObject({ response_seconds: null, arrived: 0, response_samples: 0, commitment_seconds: null });
  expect(result.units.find((unit) => unit.id === b.id)).toMatchObject({ cancelled: 1, incidents: 0 });
  expect(result.ledger).toHaveLength(2);
});
test("only an adopted route contributes distance and algorithm counts", () => {
  const result = operationalStatistics([incident], [{ ...deployment("route"), critical_mode: true, used_route: { id: "route", algorithm: "CRITICAL", distance_meters: 1500, estimated_time_seconds: 360, model_version: "v1" } }]);
  expect(result.units[0]).toMatchObject({ recorded_routes: 1, distance_meters: 1500, algorithms: { CRITICAL: 1, NEURAL: 0, DIJKSTRA: 0 } });
  expect(result.ledger[0].route?.id).toBe("route");
});
test("ledger limit never truncates whole-history aggregates", () => {
  const result = operationalStatistics([incident], Array.from({ length: 230 }, (_, i) => deployment(String(i))));
  expect(result.ledger).toHaveLength(200);
  expect(result.units[0].deployments).toBe(230);
  expect(operationalStatistics([incident], []).without_dispatch).toBe(1);
  expect(operationalStatistics([], []).units).toEqual([]);
});

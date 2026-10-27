interface Incident {
  id: string; protocol: string; nature: string; opened_at: Date;
  unit: { id: string; acronym: string } | null;
}
interface Deployment {
  id: string; occurrence_id: string; status: string; critical_mode: boolean;
  dispatched_at: Date; arrived_at: Date | null; finished_at: Date | null;
  crew_id: string | null;
  vehicle: { id: string; prefix: string; unit: { id: string; acronym: string } };
  used_route: { id: string; algorithm: string; distance_meters: number; estimated_time_seconds: number; model_version: string | null } | null;
}
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const secondsBetween = (start: Date, end: Date | null) => {
  if (!end) return null;
  const value = (end.getTime() - start.getTime()) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export function operationalStatistics(incidents: Incident[], deployments: Deployment[]) {
  const byId = new Map(incidents.map((item) => [item.id, item]));
  const groups = new Map<string, ReturnType<typeof newGroup>>();
  function newGroup(id: string, acronym: string) {
    return { id, acronym, responsible: 0, deployments: 0, cancelled: 0, arrived: 0, critical: 0,
      incidents: new Set<string>(), vehicles: new Set<string>(), crews: new Set<string>(),
      response: [] as number[], travel: [] as number[], commitment: [] as number[],
      natures: new Map<string, Set<string>>(), routes: { NEURAL: 0, DIJKSTRA: 0, CRITICAL: 0 } as Record<string, number>,
      recordedRoutes: 0, distance: 0, estimated: [] as number[] };
  }
  const group = (unit: { id: string; acronym: string }) => {
    if (!groups.has(unit.id)) groups.set(unit.id, newGroup(unit.id, unit.acronym));
    return groups.get(unit.id)!;
  };
  incidents.forEach((item) => { if (item.unit) group(item.unit).responsible++; });
  const participants = new Map<string, Set<string>>();
  for (const dispatch of deployments) {
    const occurrence = byId.get(dispatch.occurrence_id);
    if (!occurrence) continue;
    const unit = group(dispatch.vehicle.unit);
    if (dispatch.status === "CANCELADO") { unit.cancelled++; continue; }
    unit.deployments++;
    unit.incidents.add(occurrence.id);
    unit.vehicles.add(dispatch.vehicle.id);
    if (dispatch.crew_id) unit.crews.add(dispatch.crew_id);
    if (dispatch.critical_mode) unit.critical++;
    if (!participants.has(occurrence.id)) participants.set(occurrence.id, new Set());
    participants.get(occurrence.id)!.add(unit.id);
    if (!unit.natures.has(occurrence.nature)) unit.natures.set(occurrence.nature, new Set());
    unit.natures.get(occurrence.nature)!.add(occurrence.id);
    const travel = secondsBetween(dispatch.dispatched_at, dispatch.arrived_at);
    const response = secondsBetween(occurrence.opened_at, dispatch.arrived_at);
    const commitment = secondsBetween(dispatch.dispatched_at, dispatch.finished_at);
    if (travel !== null) { unit.arrived++; unit.travel.push(travel); }
    if (travel !== null && response !== null) unit.response.push(response);
    if (commitment !== null) unit.commitment.push(commitment);
    if (dispatch.used_route) {
      unit.recordedRoutes++;
      unit.routes[dispatch.used_route.algorithm] = (unit.routes[dispatch.used_route.algorithm] ?? 0) + 1;
      unit.distance += dispatch.used_route.distance_meters;
      unit.estimated.push(dispatch.used_route.estimated_time_seconds);
    }
  }
  const joint = [...participants.values()].filter((ids) => ids.size > 1);
  const pairs = new Map<string, { units: string[]; incidents: number }>();
  joint.forEach((ids) => {
    const sorted = [...ids].sort();
    sorted.forEach((a, i) => sorted.slice(i + 1).forEach((b) => {
      const key = `${a}|${b}`;
      const pair = pairs.get(key) ?? { units: [groups.get(a)!.acronym, groups.get(b)!.acronym], incidents: 0 };
      pair.incidents++;
      pairs.set(key, pair);
    }));
  });
  return {
    dispatched_incidents: participants.size,
    joint_operations: joint.length,
    without_dispatch: incidents.length - participants.size,
    units: [...groups.values()].map((unit) => {
      const sorted = [...unit.response].sort((a, b) => a - b);
      return { id: unit.id, acronym: unit.acronym, responsible: unit.responsible,
        incidents: unit.incidents.size, deployments: unit.deployments, cancelled: unit.cancelled,
        arrived: unit.arrived, critical: unit.critical, vehicles: unit.vehicles.size, crews: unit.crews.size,
        joint_operations: joint.filter((ids) => ids.has(unit.id)).length,
        response_seconds: average(unit.response), response_samples: unit.response.length,
        response_p90_seconds: sorted.length ? sorted[Math.ceil(sorted.length * 0.9) - 1] : null,
        travel_seconds: average(unit.travel), commitment_seconds: average(unit.commitment), commitment_samples: unit.commitment.length,
        recorded_routes: unit.recordedRoutes, distance_meters: unit.distance,
        estimated_seconds: average(unit.estimated), algorithms: unit.routes,
        natures: [...unit.natures].map(([nature, ids]) => ({ nature, count: ids.size })).sort((a, b) => b.count - a.count) };
    }).sort((a, b) => b.incidents - a.incidents || a.acronym.localeCompare(b.acronym)),
    cooperation: [...pairs.values()].sort((a, b) => b.incidents - a.incidents),
    // A bounded ledger keeps the full-history response small; all summaries above are exhaustive.
    ledger_limit: 200,
    ledger: [...deployments].filter((d) => byId.has(d.occurrence_id))
      .sort((a, b) => b.dispatched_at.getTime() - a.dispatched_at.getTime()).slice(0, 200)
      .map((d) => ({ id: d.id, occurrence_id: d.occurrence_id, protocol: byId.get(d.occurrence_id)!.protocol,
        nature: byId.get(d.occurrence_id)!.nature, unit_id: d.vehicle.unit.id, unit: d.vehicle.unit.acronym,
        participants: [...(participants.get(d.occurrence_id) ?? [])].map((id) => groups.get(id)!.acronym),
        vehicle: d.vehicle.prefix, status: d.status, critical_mode: d.critical_mode,
        dispatched_at: d.dispatched_at, arrived_at: d.arrived_at, finished_at: d.finished_at,
        travel_seconds: secondsBetween(d.dispatched_at, d.arrived_at), route: d.used_route })),
  };
}

import { OccurrenceNature, VehicleType } from "../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError } from "../../errors/index.js";
import { AiClient, Closure } from "../ai/ai-client.js";

/// Which vehicles are equipped for each kind of call, most fitting first.
/// It follows the doctrine of the Corpo de Bombeiros: a building fire gets a
/// pump (ABT) and, for height, the ladder (AEM/APM); a vegetation fire the
/// forest pump (ABTF); a rescue the rescue pumps and salvage trucks; pre-hospital
/// care the rescue unit (UR). The administrative car (AV) only goes to inspections.
export const NATURE_VEHICLES: Record<OccurrenceNature, VehicleType[]> = {
  INCENDIO_EDIFICACAO: ["ABT", "ABTR", "AT", "AEM", "APM"],
  INCENDIO_VEGETACAO: ["ABTF", "ABT", "AT"],
  INCENDIO_VEICULO: ["ABT", "ABTR", "AT"],
  SALVAMENTO: ["ABTR", "ASE", "UR", "ABRESC"],
  ATENDIMENTO_PRE_HOSPITALAR: ["UR", "ABTR"],
  PRODUTOS_PERIGOSOS: ["ASE", "ABTR", "ABT"],
  AFOGAMENTO: ["ASE", "UR", "ABRESC"],
  CAPTURA_ANIMAL: ["ASE", "ABTR", "MOB"],
  VISTORIA: ["AV", "MOB"],
  OUTROS: ["ABTR", "ABT", "ASE", "UR", "MOB"]
}

const PREFERENCE_STEP_SECONDS = 15

interface RecommendVehiclesRequest {
  occurrence_id: string,
  critical_mode?: boolean,
  closures?: Closure[],
  limit: number
}

export interface VehicleRecommendation {
  rank: number,
  vehicle: { id: string, prefix: string, type: VehicleType, model: string, water_capacity_liters: number | null },
  unit: { id: string, acronym: string, name: string },
  crew: { id: string, name: string, members: number, commander: string | null } | null,
  origin: { latitude: number, longitude: number, source: "current_position" | "station" },
  suitable: boolean,
  ready: boolean,
  reachable: boolean,
  eta_seconds: number | null,
  distance_meters: number | null
}

/// Ranks the available fleet for one occurrence by predicted arrival time.
///
/// This is the "closest unit" recommendation of a real CAD, with one
/// difference: closest means the network's predicted travel time from where
/// the vehicle is now, not the straight-line distance from its station. One
/// search over the reversed street graph prices every vehicle at once.
///
/// Vehicles equipped for the call and carrying an active crew come first; the
/// rest are still listed, after them, because a dispatcher may have reasons
/// the rule does not know.
export class RecommendVehiclesService {
  async execute({ occurrence_id, critical_mode = false, closures, limit }: RecommendVehiclesRequest) {

    const occurrence = await prisma.occurrence.findUnique({
      where: { id: occurrence_id },
      select: { id: true, status: true, nature: true, protocol: true, latitude: true, longitude: true }
    })

    if (!occurrence) {
      throw new NotFoundError("Occurrence not found")
    }

    if (occurrence.status === "ENCERRADA" || occurrence.status === "CANCELADA") {
      throw new ConflictError(`Occurrence ${occurrence.protocol} is already ${occurrence.status}`)
    }

    const vehicles = await prisma.vehicle.findMany({
      where: { status: "DISPONIVEL", unit: { active: true } },
      select: {
        id: true, prefix: true, type: true, model: true, water_capacity_liters: true,
        current_latitude: true, current_longitude: true,
        unit: { select: { id: true, acronym: true, name: true, latitude: true, longitude: true } },
        crews: {
          where: { active: true },
          select: {
            id: true, name: true,
            commander: { select: { war_name: true } },
            _count: { select: { members: true } }
          },
          orderBy: { started_at: "desc" },
          take: 1
        }
      }
    })

    const suitableTypes = NATURE_VEHICLES[occurrence.nature]

    if (vehicles.length === 0) {
      return { occurrence_id, nature: occurrence.nature, suitable_types: suitableTypes, critical_mode, recommendations: [] }
    }

    const origins = vehicles.map((vehicle) => {
      const tracked = vehicle.current_latitude !== null && vehicle.current_longitude !== null
      return {
        latitude: Number(tracked ? vehicle.current_latitude : vehicle.unit.latitude),
        longitude: Number(tracked ? vehicle.current_longitude : vehicle.unit.longitude),
        source: tracked ? "current_position" as const : "station" as const
      }
    })

    const times = await new AiClient().travelTimes(
      { latitude: Number(occurrence.latitude), longitude: Number(occurrence.longitude) },
      origins.map(({ latitude, longitude }) => ({ latitude, longitude })),
      { direction: "to_anchor", critical_mode, closures }
    )

    const candidates = vehicles.map((vehicle, index) => {
      const crew = vehicle.crews[0]
      const time = times[index]
      return {
        vehicle: {
          id: vehicle.id, prefix: vehicle.prefix, type: vehicle.type,
          model: vehicle.model, water_capacity_liters: vehicle.water_capacity_liters
        },
        unit: { id: vehicle.unit.id, acronym: vehicle.unit.acronym, name: vehicle.unit.name },
        crew: crew
          ? { id: crew.id, name: crew.name, members: crew._count.members, commander: crew.commander?.war_name ?? null }
          : null,
        origin: origins[index],
        suitable: suitableTypes.includes(vehicle.type),
        ready: Boolean(crew && crew._count.members > 0),
        reachable: time?.reachable ?? false,
        eta_seconds: time?.time_seconds ?? null,
        distance_meters: time?.distance_meters ?? null,
        preference: suitableTypes.indexOf(vehicle.type)
      }
    })

    const tier = (candidate: typeof candidates[number]) =>
      !candidate.reachable ? 3 : candidate.suitable && candidate.ready ? 0 : candidate.suitable ? 1 : 2

    // Each step down the doctrine list costs 15 s, so a slightly closer but
    // less fitting vehicle does not win on a difference that is inside the
    // model's own error.
    const score = (candidate: typeof candidates[number]) =>
      (candidate.eta_seconds ?? Infinity) + Math.max(candidate.preference, 0) * PREFERENCE_STEP_SECONDS

    candidates.sort((a, b) => tier(a) - tier(b) || score(a) - score(b))

    const recommendations: VehicleRecommendation[] = candidates
      .slice(0, limit)
      .map(({ preference: _preference, ...candidate }, index) => ({ rank: index + 1, ...candidate }))

    return { occurrence_id, nature: occurrence.nature, suitable_types: suitableTypes, critical_mode, recommendations }
  }
}

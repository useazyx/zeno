import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../errors/index.js";
import { AiClient } from "../ai/ai-client.js";

/// Emergency destinations for the second leg of a rescue: from the scene to a
/// hospital or emergency care unit, ranked by predicted driving time from the
/// occurrence. The list itself comes from OpenStreetMap through the AI service.
export class ListOccurrenceHospitalsService {
  async execute({ occurrence_id, critical_mode = false }: { occurrence_id: string, critical_mode?: boolean }) {

    const occurrence = await prisma.occurrence.findUnique({
      where: { id: occurrence_id },
      select: { id: true, latitude: true, longitude: true }
    })

    if (!occurrence) {
      throw new NotFoundError("Occurrence not found")
    }

    const client = new AiClient()
    const hospitals = await client.hospitals()

    if (hospitals.length === 0) {
      return { hospitals: [] }
    }

    const times = await client.travelTimes(
      { latitude: Number(occurrence.latitude), longitude: Number(occurrence.longitude) },
      hospitals.map(({ latitude, longitude }) => ({ latitude, longitude })),
      { direction: "from_anchor", critical_mode }
    )

    const ranked = hospitals
      .map((hospital, index) => ({
        ...hospital,
        reachable: times[index]?.reachable ?? false,
        eta_seconds: times[index]?.time_seconds ?? null,
        distance_meters: times[index]?.distance_meters ?? null
      }))
      .sort((a, b) => (a.eta_seconds ?? Infinity) - (b.eta_seconds ?? Infinity))

    return { hospitals: ranked }
  }
}

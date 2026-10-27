import { prisma } from "../../config/prisma.js";

export interface EtaSample {
  dispatch_id: string,
  occurrence_id: string,
  protocol: string,
  algorithm: string,
  predicted_seconds: number,
  actual_seconds: number,
  dispatched_at: Date,
  demo: boolean
}

export interface EtaSummary {
  count: number,
  /// Mean absolute error, in seconds.
  mae_seconds: number,
  /// Mean of actual minus predicted: positive means the crews take longer than the model says.
  bias_seconds: number,
  /// Mean absolute percentage error, 0..1.
  mape: number,
  p90_abs_error_seconds: number,
  /// Share of dispatches the model predicted within one minute.
  within_60s: number
}

/// Arrivals longer than this are a crew that stopped on the way or a status
/// pressed late; they say nothing about the route model and would drown it.
const MAX_PLAUSIBLE_SECONDS = 60 * 60

/// Summary statistics of the prediction error. Pure, so it is tested alone.
export function summarizeEta(samples: Pick<EtaSample, "predicted_seconds" | "actual_seconds">[]): EtaSummary | null {
  if (samples.length === 0) return null

  const errors = samples.map((sample) => sample.actual_seconds - sample.predicted_seconds)
  const absolute = errors.map(Math.abs).sort((a, b) => a - b)
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

  return {
    count: samples.length,
    mae_seconds: Math.round(mean(absolute)),
    bias_seconds: Math.round(mean(errors)),
    mape: Number(mean(samples.map((sample) => Math.abs(sample.actual_seconds - sample.predicted_seconds) / sample.actual_seconds)).toFixed(3)),
    p90_abs_error_seconds: Math.round(absolute[Math.min(absolute.length - 1, Math.floor(absolute.length * 0.9))]),
    within_60s: Number((absolute.filter((value) => value <= 60).length / absolute.length).toFixed(3))
  }
}

/// How close the network's travel time came to the arrival the crew reported.
///
/// "Actual" is from the dispatch to the status NO_LOCAL, so it includes the
/// time to leave the station; a steady positive bias of a minute or so is that
/// turnout, not a routing error. Routes rebuilt for the demonstration history
/// are flagged, because their arrivals were generated, not lived.
export class EtaAccuracyService {
  async execute({ limit }: { limit: number }) {
    const dispatches = await prisma.dispatch.findMany({
      where: { arrived_at: { not: null }, used_route_id: { not: null } },
      select: {
        id: true, occurrence_id: true, dispatched_at: true, arrived_at: true,
        occurrence: { select: { protocol: true } },
        used_route: { select: { algorithm: true, estimated_time_seconds: true, model_version: true } }
      },
      orderBy: { dispatched_at: "desc" },
      take: limit
    })

    const samples: EtaSample[] = dispatches.flatMap((dispatch) => {
      if (!dispatch.used_route || !dispatch.arrived_at) return []
      const actual = (dispatch.arrived_at.getTime() - dispatch.dispatched_at.getTime()) / 1000
      if (actual <= 0 || actual > MAX_PLAUSIBLE_SECONDS) return []
      return [{
        dispatch_id: dispatch.id,
        occurrence_id: dispatch.occurrence_id,
        protocol: dispatch.occurrence.protocol,
        algorithm: dispatch.used_route.algorithm,
        predicted_seconds: Math.round(dispatch.used_route.estimated_time_seconds),
        actual_seconds: Math.round(actual),
        dispatched_at: dispatch.dispatched_at,
        demo: (dispatch.used_route.model_version ?? "").startsWith("demo-")
      }]
    })

    const live = samples.filter((sample) => !sample.demo)

    return {
      summary: summarizeEta(samples),
      // The figure that matters once the system runs for real; empty in a
      // fresh demonstration database.
      live_summary: summarizeEta(live),
      demo_share: samples.length > 0 ? Number((1 - live.length / samples.length).toFixed(3)) : 0,
      samples
    }
  }
}

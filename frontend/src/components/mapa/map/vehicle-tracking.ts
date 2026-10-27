export const POSITION_STALE_MS = 60000
export const TRAIL_WINDOW_MS = 120000
export interface PositionReport { at: number; latitude: number; longitude: number; heading?: number | null }

export function positionAge(timestamp: string | null | undefined, now = Date.now()) {
  const at = timestamp ? Date.parse(timestamp) : NaN
  const age = Math.max(0, now - at)
  return { stale: !Number.isFinite(at) || age > POSITION_STALE_MS, label: !Number.isFinite(at) ? 'sem horário' : age < POSITION_STALE_MS ? '' : `há ${Math.floor(age / 60000)} min` }
}
export function shortestHeading(from: number, to: number, fraction: number) {
  return from + ((to - from + 540) % 360 - 180) * fraction
}
export function bufferedPosition(reports: PositionReport[], now: number): { latitude: number; longitude: number } | null {
  if (!reports.length) return null
  const last = reports[reports.length - 1]
  const point = (report: PositionReport) => ({ longitude: report.longitude, latitude: report.latitude })
  if (reports.length < 2 || now - last.at > POSITION_STALE_MS) return point(last)
  const delay = Math.min(15000, Math.max(1000, last.at - reports[reports.length - 2].at))
  const time = now - delay
  if (time <= reports[0].at) return point(reports[0])
  if (time >= last.at) return point(last)
  const next = reports.findIndex((report) => report.at >= time)
  const a = reports[next - 1], b = reports[next]
  if (b.at - a.at > POSITION_STALE_MS) return point(a)
  const fraction = (time - a.at) / Math.max(1, b.at - a.at)
  return { longitude: a.longitude + (b.longitude - a.longitude) * fraction, latitude: a.latitude + (b.latitude - a.latitude) * fraction }
}

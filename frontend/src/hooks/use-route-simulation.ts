/**
 * A vehicle driving its route at the model's predicted pace, sped up for a
 * demonstration. It is what lets the console show tracking and guidance
 * without a tablet on a real truck.
 */

import { useEffect, useMemo, useRef, useState } from "react"

import type { LatLon } from "@/lib/guidance"
import type { RouteSegment } from "@/api/types"
import { measureRoute, toMapCoords } from "@/components/mapa/routes/utils"

export function useRouteSimulation(geometry: LatLon[] | null, totalSeconds: number, segments?: RouteSegment[] | null) {
  const metrics = useMemo(() => measureRoute(toMapCoords(geometry), segments, totalSeconds), [geometry, segments, totalSeconds])
  const total = metrics.totalMeters

  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [clock, setClock] = useState({ metrics, seconds: 0 })
  const clockRef = useRef({ metrics, seconds: 0 })
  const seconds = clock.metrics === metrics ? clock.seconds : 0
  const meters = metrics.distanceAtSeconds(seconds)

  useEffect(() => {
    if (!running || total <= 0 || metrics.totalSeconds <= 0) return
    let last = performance.now()

    const timer = window.setInterval(() => {
      const now = performance.now()
      if (document.hidden) { last = now; return }
      const previous = clockRef.current.metrics === metrics ? clockRef.current.seconds : 0
      const next = Math.min(metrics.totalSeconds, previous + speed * ((now - last) / 1000))
      last = now
      clockRef.current = { metrics, seconds: next }
      setClock(clockRef.current)
      if (next >= metrics.totalSeconds) setRunning(false)
    }, 250)

    return () => window.clearInterval(timer)
  }, [running, speed, total, metrics])

  const coordinate = metrics.pointAtDist(meters)
  const position: LatLon | null = geometry && meters > 0 ? [coordinate[1], coordinate[0]] : null

  return {
    position,
    running,
    speed,
    progress: total > 0 ? meters / total : 0,
    remainingSeconds: Math.max(0, metrics.totalSeconds - seconds),
    remainingMeters: Math.max(0, total - meters),
    speedKmh: metrics.speedAtSeconds(seconds),
    setSpeed,
    toggle: () => {
      if (!running && seconds >= metrics.totalSeconds) {
        clockRef.current = { metrics, seconds: 0 }
        setClock(clockRef.current)
      }
      setRunning((value) => !value)
    },
  }
}

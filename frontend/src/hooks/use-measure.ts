/**
 * The rendered width of a box.
 *
 * Charts here are drawn at real pixel size rather than scaled from a fixed
 * viewBox: scaling a viewBox scales the hairline gridlines and the 2px strokes
 * along with it, so the same chart comes out spidery in a wide panel and heavy
 * in a narrow one. Measuring costs one observer and keeps every stroke exact.
 */

import { useCallback, useState } from "react"

export function useMeasure() {
  const [width, setWidth] = useState(0)

  // React attaches the observer when a chart leaves its empty state as well.
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

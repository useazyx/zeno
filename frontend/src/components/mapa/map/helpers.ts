import maplibregl from "maplibre-gl"

import type { GraphBounds } from "@/api/types"

/** Reserve the toolbar's actual height, including wrapped controls on small screens. */
export function observeMapToolbar(wrap: HTMLElement, toolbar: HTMLElement, map: maplibregl.Map) {
  const update = () => {
    wrap.style.setProperty("--map-toolbar-height", `${toolbar.offsetHeight}px`)
    map.resize()
  }
  const observer = new ResizeObserver(update)
  observer.observe(toolbar)
  update()
  return () => observer.disconnect()
}

export const fitRoute = (
  map: maplibregl.Map,
  coords: [number, number][]
) => {
  if (coords.length === 0) return

  const bounds = new maplibregl.LngLatBounds()

  coords.forEach((c) => bounds.extend(c))

  map.fitBounds(bounds, {
    padding: 80,
    duration: 800,
    essential: false,
  })
}

/** Frames the whole area the street graph covers. */
export const fitBoundsOf = (map: maplibregl.Map, bounds: GraphBounds) => {
  map.fitBounds(
    new maplibregl.LngLatBounds(
      [bounds.min_longitude, bounds.min_latitude],
      [bounds.max_longitude, bounds.max_latitude],
    ),
    { padding: 40, duration: 800, essential: false },
  )
}

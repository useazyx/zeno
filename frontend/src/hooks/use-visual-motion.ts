import { useSyncExternalStore } from "react"

const query = "(prefers-reduced-motion: reduce)"
function subscribe(listener: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener("change", listener)
  document.addEventListener("visibilitychange", listener)
  return () => { media.removeEventListener("change", listener); document.removeEventListener("visibilitychange", listener) }
}
export function useVisualMotion() {
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true)
  const visible = useSyncExternalStore(subscribe, () => !document.hidden, () => true)
  return { reduced, visible, animate: !reduced && visible }
}

import { useEffect, useState } from 'react'

export function useOperationClock(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const sync = () => {
      clearInterval(timer)
      document.documentElement.toggleAttribute('data-op-hidden', document.hidden)
      if (!document.hidden) {
        setNow(Date.now())
        timer = setInterval(() => setNow(Date.now()), interval)
      }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync) }
  }, [interval])
  return now
}

export function useReducedOperationMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return reduced
}

import { useEffect, useState } from 'react'
import { useReducedOperationMotion } from './use-operation-clock'

/** One 20 Hz clock drives both historical positions and event selection. */
export function useReplayClock(start: number, end: number) {
  const [at, setAt] = useState(start)
  const [playing, setPlaying] = useState(false)
  const reduced = useReducedOperationMotion()
  // Restarting a finished replay leaves `playing` true, so the end itself must restart the effect.
  const finished = at >= end
  useEffect(() => {
    if (!playing || reduced || finished) return
    let previous = performance.now()
    const timer = setInterval(() => {
      const now = performance.now(), elapsed = now - previous
      previous = now
      if (document.hidden) return
      setAt((value) => { const next = Math.min(end, value + elapsed * Math.max(1, (end - start) / 60000)); if (next >= end) clearInterval(timer); return next })
    }, 50)
    const reset = () => { previous = performance.now() }
    document.addEventListener('visibilitychange', reset)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', reset) }
  }, [playing, reduced, finished, start, end])
  return { at, playing: playing && at < end && !reduced, reduced,
    seek: (value: number) => { setPlaying(false); setAt(Math.min(end, Math.max(start, value))) },
    toggle: () => { if (at >= end) { setAt(start); setPlaying(true) } else setPlaying((value) => !value) }, start, end }
}


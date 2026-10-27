import { useEffect, useRef, useState } from 'react'
import { useRealtime } from '@/hooks/use-realtime'

export function useNewOccurrences() {
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useRealtime((event) => {
    if (event.type !== 'occurrence.created') return
    const id = event.payload.id
    setIds((current) => new Set([...current, id]))
    const timer = setTimeout(() => {
      setIds((current) => { const next = new Set(current); next.delete(id); return next })
      timers.current.delete(timer)
    }, 6000)
    timers.current.add(timer)
  })
  useEffect(() => {
    const active = timers.current
    return () => { active.forEach(clearTimeout); active.clear() }
  }, [])
  return ids
}

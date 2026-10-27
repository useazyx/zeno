import { useEffect, useRef, useState } from 'react'
import './operational.css'

export function AnimatedNumber({ value }: { value: number | null }) {
  const previous = useRef(value)
  const [display, setDisplay] = useState(value)
  const [trend, setTrend] = useState(0)
  useEffect(() => {
    const from = previous.current
    previous.current = value
    if (from == null || value == null || from === value || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      setTrend(0)
      return
    }
    setTrend(Math.sign(value - from))
    const start = performance.now()
    const finish = () => { clearInterval(timer); setDisplay(value) }
    const timer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - start) / 400)
      setDisplay(Math.round(from + (value - from) * (1 - (1 - progress) ** 3)))
      if (progress >= 1 || document.hidden) finish()
    }, 40)
    document.addEventListener('visibilitychange', finish)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', finish) }
  }, [value])
  return <span className="op-number" aria-label={value == null ? 'Dados indisponíveis' : value.toLocaleString('pt-BR')}><span aria-hidden>{display?.toLocaleString('pt-BR') ?? '—'}</span>{trend !== 0 && <small aria-label={trend > 0 ? 'Aumentou' : 'Diminuiu'}>{trend > 0 ? '↗' : '↘'}</small>}</span>
}

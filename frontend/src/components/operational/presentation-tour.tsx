import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { occurrences, vehicles } from '@/api/endpoints'
import { useResource } from '@/hooks/use-resource'
import { useReducedOperationMotion } from './use-operation-clock'
import './operational.css'

interface TourStep { id: string; path: string; title: string; caption: string; seconds: number }

export function PresentationTour() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable=true]')) return
      if (event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setActive(true) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return active ? <TourSession onClose={() => setActive(false)} /> : <button type="button" className="op-tour-launch" onClick={() => setActive(true)} title="Iniciar apresentação · Shift + P">Apresentação</button>
}

function TourSession({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [origin] = useState(() => `${location.pathname}${location.search}`)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduced = useReducedOperationMotion()
  const elapsed = useRef(0)
  const resource = useResource(async () => {
    const [recent, fleet] = await Promise.allSettled([occurrences.list({ per_page: 8, sort: 'recent' }), vehicles.list({ per_page: 1 })])
    const details = recent.status === 'fulfilled' ? await Promise.allSettled(recent.value.items.map((call) => occurrences.get(call.id))) : []
    const loaded = details.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    const call = loaded.find((item) => item.dispatches?.at(-1)?.routes?.some((route) => route.algorithm === 'NEURAL' && route.geometry.length > 1)) ?? loaded[0]
    const routes = call?.dispatches?.at(-1)?.routes ?? []
    const routed = routes.some(route => route.algorithm === 'NEURAL' && route.geometry.length > 1)
    const comparable = routes.some(route => route.algorithm === 'DIJKSTRA' && route.geometry.length > 1)
    const step = (id: string, path: string, title: string, caption: string, seconds: number): TourStep => ({ id, path: `${path}${path.includes('?') ? '&' : '?'}presentation=${id}`, title, caption, seconds })
    return [
      step('panel', '/', 'Quadro operacional', 'Ocorrências e disponibilidade recebidas do banco.', 8),
      ...(call ? [step('occurrence', `/ocorrencias/${call.id}`, `Ocorrência ${call.protocol}`, 'Abertura e etapas registradas neste atendimento. Este é um registro real.', 10)] : []),
      ...(call && routed ? [
        step('route', `/ocorrencias/${call.id}`, 'Rota registrada', 'O traçado e os tempos por trecho vêm do despacho salvo.', 14),
        ...(comparable ? [step('comparison', `/ocorrencias/${call.id}`, 'IA e rota padrão', 'O mesmo relógio compara os tempos estimados por trecho.', 28)] : []),
        step('arrival', `/ocorrencias/${call.id}`, 'Chegada ao local', 'Cena ilustrativa da natureza registrada; não é uma nova operação.', 10),
      ] : []),
      ...(fleet.status === 'fulfilled' && fleet.value.items[0] ? [step('garage', `/garagem?vehicle=${encodeURIComponent(fleet.value.items[0].id)}`, 'Frota em três dimensões', 'Inspeção do modelo e da aparência da viatura cadastrada.', 12)] : []),
      step('coverage', '/cobertura', 'Alcance dos quartéis', 'As faixas mostram os tempos calculados na malha viária.', 10),
      step('ai', '/rede-neural', 'Como a IA calcula', 'Ruas e pesos disponíveis no serviço de roteamento.', 12),
    ]
  }, [])
  const steps = resource.data ?? []
  const current = steps[index]
  const state = useRef({ step: current?.id, paused: paused || reduced })
  useEffect(() => { state.current = { step: current?.id, paused: paused || reduced } }, [current?.id, paused, reduced])
  useEffect(() => {
    if (!current) return
    elapsed.current = 0
    navigate(current.path, { replace: true })
    const announce = () => window.dispatchEvent(new CustomEvent('zeno:presentation', { detail: { ...state.current, paused: state.current.paused || document.hidden } }))
    const timer = setTimeout(announce, 700)
    document.addEventListener('visibilitychange', announce)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', announce) }
  }, [current, navigate])
  useEffect(() => {
    if (current) window.dispatchEvent(new CustomEvent('zeno:presentation', { detail: { step: current.id, paused: paused || reduced || document.hidden } }))
  }, [current, paused, reduced])
  useEffect(() => {
    if (!current || paused || reduced) return
    let previous = performance.now()
    const timer = setInterval(() => {
      const now = performance.now(), delta = now - previous
      previous = now
      if (document.hidden) return
      elapsed.current += delta
      if (elapsed.current >= current.seconds * 1000) {
        if (index < steps.length - 1) setIndex((value) => value + 1)
        else setPaused(true)
      }
    }, 250)
    return () => clearInterval(timer)
  }, [current, paused, reduced, index, steps.length])
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('zeno:presentation', { detail: { step: state.current.step, paused: true } }))
  }, [])
  const close = () => { navigate(origin, { replace: true }); onClose() }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      navigate(origin, { replace: true })
      onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [navigate, origin, onClose])
  return <aside className="op-tour" aria-label="Modo apresentação">
    <p><strong>{current ? `${index + 1}/${steps.length} · ${current.title}` : 'Preparando apresentação'}</strong><small>{current?.caption ?? 'Consultando registros disponíveis. Etapas sem dados serão omitidas.'}{reduced ? ' Movimento reduzido: avance pelos botões.' : ''}</small>{resource.error && <small>{resource.error}</small>}</p>
    <button type="button" disabled={!index} onClick={() => setIndex((value) => Math.max(0, value - 1))}>Anterior</button>
    <button type="button" disabled={reduced || !current} onClick={() => setPaused((value) => !value)}>{paused || reduced ? 'Continuar' : 'Pausar'}</button>
    <button type="button" disabled={!current || index >= steps.length - 1} onClick={() => setIndex((value) => value + 1)}>Próximo</button>
    <button type="button" onClick={close}>Encerrar</button>
  </aside>
}

import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react"
import { ArrowRight, Pause, Play } from "lucide-react"
import type { EdgeCosts } from "@/api/types"
import { useVisualMotion } from "@/hooks/use-visual-motion"
import { localStreetGraph } from "./coverage-ai-policy"
import "./neural-explanation.css"

const BrainScene = lazy(() => import("./neural-brain-scene"))
const STAGES = [
  { tag: "ENTRADA", title: "A cidade vira informação", short: "Grafo", description: "Cruzamentos são nós. Ruas são conexões com atributos próprios. Essa estrutura permite ao modelo considerar a via e o lugar que ela ocupa na cidade." },
  { tag: "GAT · CAMADA 1", title: "O entorno imediato importa", short: "Vizinhos", description: "A primeira camada de atenção combina as informações dos cruzamentos vizinhos. Cada conexão participa com um peso aprendido pelo modelo." },
  { tag: "GAT · CAMADA 2", title: "O contexto se amplia", short: "Contexto", description: "A segunda camada recebe vizinhos que já incorporaram seu entorno. Assim, o contexto alcança até dois saltos no grafo de ruas." },
  { tag: "MLP · SAÍDA", title: "Um custo para cada trecho", short: "Previsão", description: "A rede combina as representações dos dois cruzamentos com os atributos da via para estimar o custo de percorrer aquele trecho, em segundos." },
]

export function NeuralExplanation({ data }: { data: EdgeCosts }) {
  const graph = useMemo(() => localStreetGraph(data.features), [data.features])
  const motion = useVisualMotion()
  const host = useRef<HTMLDivElement>(null)
  const id = useId()
  const [inView, setInView] = useState(false)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const chosen = graph.edges.find(edge => edge.index === selected) ?? graph.edges[0]
  const stage = STAGES[step]

  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: "80px" })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!playing || !motion.animate || !inView) return
    const timer = window.setTimeout(() => {
      if (step === 3) setPlaying(false)
      else setStep(value => value + 1)
    }, 5500)
    return () => window.clearTimeout(timer)
  }, [playing, motion.animate, inView, step])

  useEffect(() => {
    const presentation = (event: Event) => {
      const detail = (event as CustomEvent<{ step: string; paused: boolean }>).detail
      if (detail?.step !== "ai") return
      setPlaying(!detail.paused)
      if (!detail.paused) setStep(0)
    }
    window.addEventListener("zeno:presentation", presentation)
    return () => window.removeEventListener("zeno:presentation", presentation)
  }, [])

  return <div ref={host} className="neural-explainer">
    <div className="neural-specimen">
      <div className="neural-specimen-heading"><span>INTELIGÊNCIA APLICADA</span><span>GAT → MLP</span></div>
      <Suspense fallback={<div className="neural-brain-placeholder">Preparando modelo 3D…</div>}>
        {inView && <BrainScene active={motion.visible && inView} animate={playing && motion.animate && inView} stage={step} />}
      </Suspense>
      <div className="neural-specimen-caption"><span>Da cidade à decisão.</span><span>MODELO ILUSTRATIVO</span></div>
    </div>
    <div className="neural-stage-navigation" aria-label="Etapas do modelo">
      {STAGES.map((item, index) => <button key={item.tag} type="button" aria-pressed={step === index} aria-controls={`${id}-stage`} onClick={() => { setStep(index); setPlaying(false) }}>
        <span className="neural-stage-number">0{index + 1}</span><span>{item.short}</span>{index < 3 && <ArrowRight size={12} aria-hidden="true" />}
      </button>)}
    </div>
    <div id={`${id}-stage`} className="neural-stage-copy" aria-live="polite" aria-atomic="true">
      <span className="neural-eyebrow">{stage.tag}</span>
      <h3>{stage.title}</h3>
      <p>{stage.description}</p>
    </div>
    {chosen ? <div className="neural-evidence">
      <label htmlFor={`${id}-street`}>TRECHO REAL · RECORTE DO GRAFO</label>
      <select id={`${id}-street`} value={chosen.index} onChange={event => setSelected(Number(event.target.value))}>
        {graph.edges.map(edge => <option key={edge.index} value={edge.index}>{edge.street}</option>)}
      </select>
      <div className="neural-prediction"><span>Custo previsto pelo modelo<small>Para este trecho, não para a rota inteira</small></span><strong>{chosen.cost === null ? "Não informado" : <>{chosen.cost.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}<small> s</small></>}</strong></div>
      {(step === 1 || step === 2) && <p className="neural-attention">{chosen.attention[step - 1] === null ? "A API não informou a atenção desta conexão nesta camada." : <>Atenção nesta conexão: <strong>{(chosen.attention[step - 1]! * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong> · média das cabeças, no grafo completo.</>}</p>}
    </div> : <p className="neural-empty">Nenhum trecho disponível. A sequência acima descreve a arquitetura do modelo.</p>}
    <div className="neural-explanation-footer">
      <button type="button" className="neural-play" disabled={motion.reduced} onClick={() => { if (step === 3) setStep(0); setPlaying(value => !value) }}>
        {playing && !motion.reduced ? <Pause size={14} /> : <Play size={14} />}{playing && !motion.reduced ? "Pausar sequência" : "Ver sequência"}
      </button>
      <p>O cérebro é uma metáfora visual. Não representa ativações reais nem regiões usadas pela IA.{motion.reduced && " Movimento reduzido ativo; selecione as etapas manualmente."}</p>
    </div>
  </div>
}

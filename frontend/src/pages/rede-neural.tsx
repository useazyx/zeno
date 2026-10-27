/**
 * The model's own screen: what is loaded, and the training that replaces it.
 *
 * Training overwrites the checkpoint every dispatch depends on and there is no
 * rollback, so the warning is stated plainly above the button rather than
 * buried under it.
 */

import { useEffect, useState } from "react"
import { AlertTriangle, Brain, ChartLine, History, Play, Timer } from "lucide-react"

import { ai } from "@/api/endpoints"
import { TONE, TRAINING_STATUS_LABEL, TRAINING_STATUS_TONE } from "@/api/labels"
import type { TrainingRun } from "@/api/types"
import {
  ActionButton, Badge, Cell, Field, FieldButton, Page, PageHeader, Pagination, Panel, Row, Table,
  TextInput,
} from "@/components/layout/kit"
import { EmptyState, ErrorBox, LoadingBlock } from "@/components/layout/feedback"
import {
  ConvergenceSpeed, EpochsVsQuality, LossCurve, RunComparison,
} from "@/components/charts/training-charts"
import { NeuralExplanation } from "@/components/mapa/neural-explanation"
import { NeuralStreetsMap } from "@/components/mapa/neural-streets-map"
import { useVisualMotion } from "@/hooks/use-visual-motion"
import { EtaAccuracyChart } from "@/components/charts/eta-accuracy"
import { useMutation, useResource } from "@/hooks/use-resource"
import { formatDateTime, formatLoss } from "@/lib/format"

/** The bar a run has to clear to be worth keeping, per the project's README. */
const GOOD_VALIDATION_LOSS = 0.06

export default function RedeNeural() {

  const [page, setPage] = useState(1)
  const [epochs, setEpochs] = useState("800")
  const [watching, setWatching] = useState<string | null>(null)
  const [showStreets, setShowStreets] = useState(false)
  const motion = useVisualMotion()

  const model = useResource(() => ai.model(), [])
  const eta = useResource(() => ai.etaAccuracy(), [])
  const history = useResource(() => ai.listTrainings({ page, per_page: 10 }), [page])
  const start = useMutation((value: number) => ai.startTraining(value))

  const watchedId = watching ?? history.data?.items.find(run => run.status === "EXECUTANDO" || run.status === "PENDENTE")?.id ?? null
  const streets = useResource(() => ai.edgeCosts(), [model.data?.model_version], { enabled: Boolean(model.data?.loaded) })

  const live = useResource(
    () => ai.getTraining(watchedId as string),
    [watchedId],
    { enabled: Boolean(watchedId) },
  )

  // A run takes minutes; the backend mirrors the Python job into Postgres and
  // this poll is what pulls the progress forward.
  const liveReload = live.reload
  const liveStatus = live.data?.status

  useEffect(() => {
    if (!watchedId || !motion.visible) return
    if (liveStatus === "CONCLUIDO" || liveStatus === "FALHOU") {
      history.reload()
      model.reload()
      return
    }

    const timer = window.setInterval(liveReload, 4000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedId, liveStatus, liveReload, motion.visible])

  const runs = history.data?.items ?? []

  // The charts follow the table: clicking a row watches that run, and what is
  // watched is what is drawn. With nothing picked, the newest run is the one
  // anybody opening this screen wants to see.
  const selectedRun = (live.data?.id === watchedId ? live.data : runs.find(run => run.id === watchedId)) ?? runs[0] ?? null

  async function handleStart() {
    const run = await start.run(Number(epochs))
    if (run) {
      setWatching(run.id)
      history.reload()
    }
  }

  return (
    <div className="neural-page"><Page>
      <PageHeader
        title="IA"
        subtitle="Estado do modelo de IA que pondera as ruas e histórico de treinamentos"
      />

      <div className="neural-lead-grid">
        <div className="neural-curve">
          {history.loading && !history.data && <LoadingBlock label="Carregando o histórico..." />}
          {history.error && <ErrorBox message={history.error} onRetry={history.reload} />}
          {selectedRun ? <>
            <div className="neural-run-heading">
              <div>
                <p className="label-caps text-ink-soft">Treinamento em análise</p>
                <p className="mt-1 font-semibold text-ink">{formatDateTime(selectedRun.started_at ?? selectedRun.created_at)}</p>
                {selectedRun.model_path?.startsWith("demo://") && <p className="mt-1 text-sm text-warn">Demonstração · métricas simuladas</p>}
              </div>
              <Badge tone={TRAINING_STATUS_TONE[selectedRun.status]}>{TRAINING_STATUS_LABEL[selectedRun.status]}</Badge>
            </div>
            <LossCurve key={selectedRun.id} run={selectedRun} previous={runs} />
          </> : !history.loading && !history.error && <EmptyState title="Nenhum treinamento registrado" />}
        </div>

        <div className="neural-controls">
        <Panel className="neural-model" title="Estado do modelo" icon={<Brain className="h-5 w-5" />}>
          {model.loading && <LoadingBlock label="Consultando o serviço de IA..." />}
          {model.error && <ErrorBox message={model.error} onRetry={model.reload} />}

          {model.data && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Badge tone={model.data.loaded ? TONE.ok : TONE.alert}>
                  {model.data.loaded ? "Carregado" : "Indisponível"}
                </Badge>
                <span className="text-ink-muted">{model.data.city}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Figure label="Nós do grafo" value={model.data.graph_nodes.toLocaleString("pt-BR")} />
                <Figure label="Ruas (arestas)" value={model.data.graph_edges.toLocaleString("pt-BR")} />
              </div>

              <div className="rounded-sm border border-line bg-surface-muted px-4 py-2">
                <p className="text-sm text-ink-muted">Versão do modelo</p>
                <p className="font-mono text-ink">{model.data.model_version ?? "—"}</p>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Como a IA pensa" icon={<Brain className="h-5 w-5" />}>
          {streets.loading && !streets.data && <LoadingBlock label="Lendo ruas e pesos do modelo…" />}
          {streets.error && <ErrorBox message={streets.error} onRetry={streets.reload} />}
          {streets.data && <NeuralExplanation key={streets.data.model_version} data={streets.data} />}
          {!model.loading && !model.data?.loaded && <p className="text-sm text-ink-muted">A explicação aguarda um modelo carregado.</p>}
        </Panel>

        <Panel title="Treinar o modelo" icon={<Play className="h-5 w-5" />}>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-sm border border-warn/30 bg-warn-soft px-4 py-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
              <p className="text-ink">
                O treinamento <strong>substitui o modelo atual</strong> mesmo que o resultado seja pior,
                e não há como voltar atrás. Faça uma cópia de <code>models/path_network.pth</code> antes.
              </p>
            </div>

            {start.error && <ErrorBox message={start.error} />}

            {/* The hint used to live inside the field, and a hint is wider
                than a four-digit number: it stretched the column and left the
                button floating away from the input it belongs to. It reads
                below the row instead. */}
            <div className="flex flex-wrap items-start gap-3">
              <Field label="Épocas">
                <TextInput
                  type="number"
                  min={10}
                  max={5000}
                  value={epochs}
                  onChange={(event) => setEpochs(event.target.value)}
                  className="w-32"
                />
              </Field>

              <FieldButton>
                <ActionButton tone="primary" onClick={handleStart} disabled={start.submitting}>
                  <Play className="h-5 w-5" />
                  {start.submitting ? "Iniciando..." : "Iniciar treinamento"}
                </ActionButton>
              </FieldButton>
            </div>

            <p className="text-sm text-ink-soft">
              Entre 10 e 5000 épocas — o padrão do projeto é 800. O treinador só reporta
              progresso a cada 50, então corridas muito curtas terminam sem nenhuma medição.
            </p>

            {watchedId && live.data?.id === watchedId && <LiveRun run={live.data} />}
          </div>
        </Panel>

        </div>
      </div>

      <Panel title="Visão da IA nas ruas" icon={<Brain className="h-5 w-5" />}>
        <ActionButton onClick={() => setShowStreets(value => !value)} aria-expanded={showStreets} aria-controls="neural-street-view">
          {showStreets ? "Fechar mapa de custos" : "Abrir mapa de custos e busca"}
        </ActionButton>
        {showStreets && <div id="neural-street-view" className="mt-4">
          {streets.loading && !streets.data && <LoadingBlock label="Carregando custos previstos…" />}
          {streets.error && <ErrorBox message={streets.error} onRetry={streets.reload} />}
          {streets.data && <NeuralStreetsMap key={streets.data.model_version} data={streets.data} />}
          {!model.loading && !model.data?.loaded && <p className="text-sm text-ink-muted">Carregue o modelo para consultar as ruas.</p>}
        </div>}
      </Panel>

      <Panel title="Evolução dos treinamentos" icon={<ChartLine className="h-5 w-5" />}>
        {history.loading && !history.data && <LoadingBlock label="Carregando o histórico..." />}
        {runs.some(run => run.model_path?.startsWith("demo://")) && (
          <p className="border-l-2 border-warn bg-warn-soft px-4 py-3 text-sm text-ink">
            O histórico inclui simulações identificadas como “Demonstração”. Essas métricas não
            representam treinamentos executados e não alteram o modelo carregado.
          </p>
        )}

        {selectedRun && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
              <Figure label="Melhor validação" value={formatLoss(selectedRun.best_validation_loss ?? selectedRun.validation_loss)} />
              <Figure label="Loss de treino" value={formatLoss(selectedRun.train_loss)} />
              <Figure label="Épocas solicitadas" value={selectedRun.epochs.toLocaleString("pt-BR")} />
              <Figure label="Meta de validação" value={formatLoss(GOOD_VALIDATION_LOSS)} />
            </div>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">

            <RunComparison
              runs={runs}
              threshold={GOOD_VALIDATION_LOSS}
              selectedId={selectedRun.id}
              onSelect={setWatching}
            />

            <EpochsVsQuality
              runs={runs}
              threshold={GOOD_VALIDATION_LOSS}
              selectedId={selectedRun.id}
              onSelect={setWatching}
            />

            </div>
            <ConvergenceSpeed runs={runs} threshold={GOOD_VALIDATION_LOSS} />
          </div>
        )}

        {selectedRun && (
          <p className="text-sm text-ink-soft">
            Comparações dos {runs.length} treinamentos desta página. Selecione uma coluna ou bolha
            para analisar a curva. Pelo teclado, use Tab e Enter.
          </p>
        )}
      </Panel>

      <Panel title="Precisão do tempo previsto" icon={<Timer className="h-5 w-5" />}>
        {eta.loading && !eta.data && <p className="text-sm text-ink-muted">Comparando previsões com chegadas registradas...</p>}
        {eta.error && <ErrorBox message={eta.error} onRetry={eta.reload} />}
        {eta.data && <EtaAccuracyChart data={eta.data} />}
      </Panel>

      <Panel title="Histórico de treinamentos" icon={<History className="h-5 w-5" />}>
        {history.loading && !history.data && <LoadingBlock />}
        {history.error && <ErrorBox message={history.error} onRetry={history.reload} />}

        {history.data && history.data.items.length === 0 && (
          <EmptyState title="Nenhum treinamento registrado" />
        )}

        {history.data && history.data.items.length > 0 && (
          <>
            <Table headers={["Situação", "Épocas", "Loss treino", "Loss validação", "Início", "Fim"]}>
              {history.data.items.map((run) => (
                <Row key={run.id} onClick={() => setWatching(run.id)}>
                  <Cell>
                    <Badge tone={TRAINING_STATUS_TONE[run.status]}>{TRAINING_STATUS_LABEL[run.status]}</Badge>
                    {run.model_path?.startsWith("demo://") && <span className="mt-1 block text-sm text-warn">Demonstração</span>}
                    {run.error_message && (
                      <span className="mt-1 block max-w-md truncate text-sm text-alert" title={run.error_message}>
                        {run.error_message}
                      </span>
                    )}
                  </Cell>
                  <Cell title={run.current_epoch !== null ? "Última época reportada de quantas foram pedidas" : undefined}>
                    {run.current_epoch !== null && run.current_epoch < run.epochs
                      ? `${run.current_epoch} de ${run.epochs}`
                      : run.epochs}
                  </Cell>
                  <Cell>{formatLoss(run.train_loss)}</Cell>
                  <Cell>
                    <span className={qualityTone(run.best_validation_loss)}>
                      {formatLoss(run.best_validation_loss ?? run.validation_loss)}
                    </span>
                  </Cell>
                  <Cell className="whitespace-nowrap">{formatDateTime(run.started_at)}</Cell>
                  <Cell className="whitespace-nowrap">{formatDateTime(run.finished_at)}</Cell>
                </Row>
              ))}
            </Table>

            <Pagination
              page={history.data.page}
              perPage={history.data.per_page}
              total={history.data.total}
              onPage={setPage}
            />
          </>
        )}
      </Panel>
    </Page></div>
  )
}

function Figure({ label, value }: { label: string, value: string }) {
  return (
    <div className="neural-figure min-w-0 bg-surface px-4 py-3">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="text-2xl font-semibold text-ink">{value}</p>
    </div>
  )
}

function LiveRun({ run }: { run: TrainingRun }) {
  const running = run.status === "PENDENTE" || run.status === "EXECUTANDO"

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-muted px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-ink">Execução acompanhada</p>
        <Badge tone={TRAINING_STATUS_TONE[run.status]}>{TRAINING_STATUS_LABEL[run.status]}</Badge>
      </div>

      <EpochProgress run={run} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Loss treino" value={formatLoss(run.train_loss)} />
        <Metric label="Loss validação" value={formatLoss(run.validation_loss)} />
        <Metric label="Melhor validação" value={formatLoss(run.best_validation_loss)} />
      </div>

      {running && (
        <p className="text-sm text-ink-muted">
          O treinador reporta o progresso a cada 50 épocas, então a barra anda em degraus.
          A corrida também pode parar antes do fim por <em>early stopping</em>, quando a loss de
          validação deixa de melhorar.
        </p>
      )}

      {run.model_path?.startsWith("demo://") && <p className="text-sm text-warn">Simulação para apresentação. Nenhum modelo foi treinado ou substituído por este registro.</p>}
      {!run.model_path?.startsWith("demo://") && run.status === "CONCLUIDO" && run.best_validation_loss !== null && (
        <p className="text-ink">
          {run.best_validation_loss <= GOOD_VALIDATION_LOSS
            ? "Resultado dentro do esperado — o serviço já recarregou este modelo."
            : `Loss de validação acima de ${GOOD_VALIDATION_LOSS}: o modelo ficou pior que o alvo do projeto.`}
        </p>
      )}

      {run.error_message && <p className="text-alert">{run.error_message}</p>}
    </div>
  )
}

/**
 * How far along the run is.
 *
 * Until this existed the screen showed three losses and nothing else, so a run
 * of 800 epochs looked identical at epoch 50 and at epoch 750 — the numbers
 * move, but nothing says whether there are seconds or minutes left.
 */
function EpochProgress({ run }: { run: TrainingRun }) {
  const done = run.status === "CONCLUIDO" || run.status === "FALHOU"
  const motion = useVisualMotion()
  const reached = run.current_epoch ?? 0
  const percent = run.epochs > 0 ? Math.min(100, (reached / run.epochs) * 100) : 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-ink-muted">
          {run.current_epoch === null
            ? (done ? "Nenhuma época reportada" : "Aguardando a primeira medição...")
            : <>Época <strong className="text-ink">{reached}</strong> de {run.epochs}</>}
        </p>
        <p className="text-sm font-semibold text-ink-muted">
          {run.current_epoch === null ? "—" : `${Math.round(percent)}%`}
        </p>
      </div>

      <div className="h-2.5 w-full border border-line bg-surface">
        <div
          className={`h-full w-full origin-left ${done ? "bg-ok" : "bg-accent"}`}
          style={{ transform: `scaleX(${percent / 100})`, transition: motion.animate ? "transform 500ms ease-out" : "none" }}
        />
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string, value: string }) {
  return (
    <div className="rounded-sm border border-line bg-surface px-3 py-2">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="text-xl font-semibold text-ink">{value}</p>
    </div>
  )
}

function qualityTone(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-ink-soft"
  return value <= GOOD_VALIDATION_LOSS ? "font-semibold text-ok" : "font-semibold text-warn"
}

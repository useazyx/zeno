/**
 * How good is the model's clock?
 *
 * Every dispatch with a reported arrival becomes one dot: predicted travel
 * time across, the time the crew actually took up. On the diagonal the model
 * was right; above it the crew took longer. The headline numbers sit beside
 * the plot so the chart is never the only way to read the answer.
 */

import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

import type { EtaAccuracy } from "@/api/types"
import { formatDuration } from "@/lib/format"

const WIDTH = 520
const HEIGHT = 340
const PAD = { top: 12, right: 16, bottom: 40, left: 52 }

function ticks(max: number): number[] {
  const step = max > 1800 ? 600 : max > 900 ? 300 : max > 300 ? 120 : 60
  const values: number[] = []
  for (let value = 0; value <= max; value += step) values.push(value)
  return values
}

export function EtaAccuracyChart({ data }: { data: EtaAccuracy }) {
  const [hover, setHover] = useState<number | null>(null)
  const samples = data.samples

  const max = useMemo(() => {
    const largest = Math.max(60, ...samples.map((sample) => Math.max(sample.predicted_seconds, sample.actual_seconds)))
    // Ignore the extreme 2% when scaling, so one late crew does not squash the rest.
    const sorted = samples.map((sample) => Math.max(sample.predicted_seconds, sample.actual_seconds)).sort((a, b) => a - b)
    const p98 = sorted[Math.floor(sorted.length * 0.98)] ?? largest
    return Math.ceil(Math.min(largest, p98 * 1.1) / 60) * 60
  }, [samples])

  const x = (seconds: number) => PAD.left + (Math.min(seconds, max) / max) * (WIDTH - PAD.left - PAD.right)
  const y = (seconds: number) => HEIGHT - PAD.bottom - (Math.min(seconds, max) / max) * (HEIGHT - PAD.top - PAD.bottom)
  const summary = data.summary
  const hovered = hover === null ? null : samples[hover]

  const worst = useMemo(() => [...samples]
    .sort((a, b) => Math.abs(b.actual_seconds - b.predicted_seconds) - Math.abs(a.actual_seconds - a.predicted_seconds))
    .slice(0, 5), [samples])

  if (!summary) {
    return <p className="text-sm text-ink-muted">Ainda não há despachos com chegada registrada e rota da IA para comparar.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {data.demo_share > 0 && (
        <p className="rounded-sm border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-ink">
          {Math.round(data.demo_share * 100)}% destas chegadas pertencem ao histórico demonstrativo, onde o horário de chegada
          foi gerado. Os números passam a medir a operação real conforme novos despachos forem atendidos.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Erro médio" value={formatDuration(summary.mae_seconds)} hint={`${summary.count} chegadas`} />
        <Tile label="Viés" value={`${summary.bias_seconds >= 0 ? "+" : "−"}${formatDuration(Math.abs(summary.bias_seconds))}`} hint={summary.bias_seconds >= 0 ? "a guarnição demora mais que o previsto" : "a guarnição chega antes do previsto"} />
        <Tile label="Dentro de 1 min" value={`${Math.round(summary.within_60s * 100)}%`} hint="das previsões" />
        <Tile label="Erro relativo" value={`${(summary.mape * 100).toFixed(1).replace(".", ",")}%`} hint={`p90 ${formatDuration(summary.p90_abs_error_seconds)}`} />
      </div>

      <div className="chart-plot relative w-full max-w-[680px]">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img"
          aria-label={`Dispersão de ${summary.count} chegadas: tempo previsto pela IA contra o tempo real. Erro médio ${formatDuration(summary.mae_seconds)}.`}
          onMouseLeave={() => setHover(null)}>
          {ticks(max).map((value) => (
            <g key={value}>
              <line x1={x(value)} x2={x(value)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--color-line)" strokeWidth={1} />
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={x(value)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" fontSize={11} fill="var(--color-ink-soft)">{Math.round(value / 60)}</text>
              <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-soft)">{Math.round(value / 60)}</text>
            </g>
          ))}
          <text x={(WIDTH + PAD.left) / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-muted)">Previsto pela IA (min)</text>
          <text transform={`translate(14 ${(HEIGHT - PAD.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--color-ink-muted)">Real até o local (min)</text>

          {/* The diagonal: a perfect prediction. */}
          <line x1={x(0)} y1={y(0)} x2={x(max)} y2={y(max)} stroke="var(--color-ink-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={x(max * 0.9) - 8} y={y(max * 0.9) - 6} textAnchor="end" fontSize={11} fill="var(--color-ink-muted)">previsão exata</text>

          {samples.map((sample, index) => (
            <circle
              key={sample.dispatch_id}
              cx={x(sample.predicted_seconds)}
              cy={y(sample.actual_seconds)}
              r={hover === index ? 6 : 4}
              fill="var(--color-accent)"
              fillOpacity={hover === null || hover === index ? 0.55 : 0.2}
              stroke="var(--color-surface)"
              strokeWidth={hover === index ? 2 : 1}
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute rounded-sm border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(x(hovered.predicted_seconds) / WIDTH) * 100}%`,
              top: `${(y(hovered.actual_seconds) / HEIGHT) * 100}%`,
              transform: "translate(10px, -110%)",
            }}
          >
            <p className="font-semibold text-ink">{hovered.protocol}</p>
            <p className="text-ink-muted">Previsto {formatDuration(hovered.predicted_seconds)} · real {formatDuration(hovered.actual_seconds)}</p>
          </div>
        )}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-ink">Maiores diferenças</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="label-caps text-ink-soft"><th className="py-1">Ocorrência</th><th>Previsto</th><th>Real</th><th>Diferença</th></tr>
          </thead>
          <tbody>
            {worst.map((sample) => (
              <tr key={sample.dispatch_id} className="border-t border-line">
                <td className="py-1"><Link to={`/ocorrencias/${sample.occurrence_id}`} className="font-semibold text-accent hover:underline">{sample.protocol}</Link></td>
                <td className="tabular-nums">{formatDuration(sample.predicted_seconds)}</td>
                <td className="tabular-nums">{formatDuration(sample.actual_seconds)}</td>
                <td className="tabular-nums">{formatDuration(Math.abs(sample.actual_seconds - sample.predicted_seconds))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="text-xs text-ink-soft">
        O tempo real vai do despacho ao status “no local” e inclui a saída do quartel; um viés positivo de cerca de um minuto é esse tempo, não erro de rota.
      </p>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string, value: string, hint: string }) {
  return (
    <div className="flex flex-col rounded-sm border border-line bg-surface-muted px-3 py-2">
      <span className="label-caps text-ink-soft">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-xs text-ink-muted">{hint}</span>
    </div>
  )
}

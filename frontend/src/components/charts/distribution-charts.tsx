/** Distribution charts use one scale and one hue for each count series. */
import { useState } from "react"
import { curvePath } from "./curve"
import { useMeasure } from "@/hooks/use-measure"
import "./charts.css"

const BAR_COLOR = "var(--color-accent)"
const CONTEXT_COLOR = "var(--color-ink-soft)"
const GRID_COLOR = "var(--color-line)"
const AXIS_INK = "var(--color-ink-muted)"
const SURFACE = "var(--color-canvas)"
const number = (value: number) => value.toLocaleString("pt-BR")

function countScale(maximum: number, divisions = 4) {
  const rough = Math.max(1, maximum / divisions)
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((value) => value >= rough) ?? power * 10
  const max = Math.max(step, Math.ceil(maximum / step) * step)
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) }
}

export interface RankingItem {
  key: string
  label: string
  value: number
  note?: string
}

export function Ranking({ items, emptyMessage, unit = "ocorrências" }: {
  items: RankingItem[]
  emptyMessage: string
  unit?: string
}) {
  if (items.length === 0) return <p className="chart-empty">{emptyMessage}</p>
  const max = Math.max(...items.map((item) => item.value), 1)

  return <ol className="chart-ranking">
    {items.map((item, index) => <li key={item.key} className="chart-ranking-row">
      <span className="chart-ranking-position" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <div className="chart-ranking-body">
        <div className="chart-ranking-heading"><span>{item.label}</span><strong>{number(item.value)}<small>{unit}</small></strong></div>
        <div className="chart-ranking-track" aria-hidden="true"><div style={{ width: `${item.value / max * 100}%` }} /></div>
        {item.note && <span className="chart-ranking-note">{item.note}</span>}
      </div>
    </li>)}
  </ol>
}

const HISTOGRAM_HEIGHT = 218
const PADDING = { top: 20, right: 12, bottom: 30, left: 40 }

export function HourHistogram({ counts }: { counts: number[] }) {
  const [ref, width] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  const total = counts.reduce((sum, value) => sum + value, 0)
  const highest = Math.max(...counts, 0)
  const busiest = counts.indexOf(highest)
  const selected = hover ?? busiest
  const { max, ticks } = countScale(highest, 3)
  const plotWidth = Math.max(0, width - PADDING.left - PADDING.right)
  const plotHeight = HISTOGRAM_HEIGHT - PADDING.top - PADDING.bottom
  const slot = plotWidth / 24
  const barWidth = Math.max(1, Math.min(28, slot * .68))
  const y = (value: number) => PADDING.top + plotHeight - value / max * plotHeight

  return <div className="chart-histogram">
    <div className="chart-section-heading"><p>Acumulado de todos os dias do recorte</p></div>
    <div ref={ref} className="chart-plot relative w-full">
      {!total ? <p className="chart-empty">Nenhuma ocorrência no período filtrado.</p> : width > 0 && <svg width={width} height={HISTOGRAM_HEIGHT} role="group" aria-label="Distribuição de ocorrências por hora do dia">
        {ticks.map((tick) => <g key={tick}><line x1={PADDING.left} y1={y(tick)} x2={width - PADDING.right} y2={y(tick)} stroke={GRID_COLOR} strokeDasharray={tick === 0 ? undefined : "2 4"} /><text x={PADDING.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill={AXIS_INK}>{number(tick)}</text></g>)}
        {counts.map((value, hour) => <g key={hour}>
          {hour === selected && <rect x={PADDING.left + slot * hour} y={PADDING.top} width={slot} height={plotHeight} fill={BAR_COLOR} opacity={.06} />}
          <rect x={PADDING.left + slot * hour + (slot - barWidth) / 2} y={y(value)} width={barWidth} height={Math.max(0, y(0) - y(value))} fill={BAR_COLOR} opacity={hover === null || hover === hour ? 1 : .45} />
          {hour % 3 === 0 && <text x={PADDING.left + slot * hour + slot / 2} y={HISTOGRAM_HEIGHT - 10} textAnchor="middle" fontSize={11} fill={AXIS_INK}>{hour}h</text>}
        </g>)}
        <rect x={PADDING.left} y={PADDING.top} width={plotWidth} height={plotHeight} fill="transparent" tabIndex={0} role="slider" aria-label="Consultar ocorrências por hora. Use as setas esquerda e direita." aria-valuemin={0} aria-valuemax={23} aria-valuenow={selected} aria-valuetext={`${selected}h: ${counts[selected] ?? 0} ocorrências`}
          onFocus={() => setHover(busiest)} onBlur={() => setHover(null)}
          onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); setHover(event.key === "Home" ? 0 : event.key === "End" ? 23 : Math.max(0, Math.min(23, selected + (event.key === "ArrowRight" ? 1 : -1)))) }}
          onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(23, Math.floor((event.clientX - box.left) / (box.width || 1) * 24)))) }} onPointerLeave={() => setHover(null)} />
      </svg>}
    </div>
    {total > 0 && <div className="chart-inline-readout"><span>{hover === null ? "Hora com maior volume" : "Hora consultada"}</span><strong>{String(selected).padStart(2, "0")}h–{String(selected).padStart(2, "0")}h59</strong><span>{number(counts[selected])} ocorrências · {(counts[selected] / total * 100).toFixed(1).replace(".", ",")}% do recorte</span></div>}
  </div>
}

export interface SeriesPoint { label: string; value: number }
const SERIES_HEIGHT = 280
const SERIES_PADDING = { top: 20, right: 16, bottom: 30, left: 44 }

export function TimeSeries({ current, previous, currentLabel, previousLabel }: {
  current: SeriesPoint[]; previous?: SeriesPoint[]; currentLabel: string; previousLabel?: string
}) {
  const [ref, width] = useMeasure()
  const [hoverIndex, setHover] = useState<number | null>(null)
  const hover = hoverIndex === null ? null : Math.min(hoverIndex, Math.max(0, current.length - 1))
  const comparison = previous?.length === current.length ? previous : undefined
  const { max, ticks } = countScale(Math.max(...current.map((point) => point.value), ...(comparison ?? []).map((point) => point.value), 1))
  const total = current.reduce((sum, point) => sum + point.value, 0)
  const peak = current.reduce<SeriesPoint | null>((best, point) => !best || point.value > best.value ? point : best, null)
  const plotWidth = Math.max(0, width - SERIES_PADDING.left - SERIES_PADDING.right)
  const plotHeight = SERIES_HEIGHT - SERIES_PADDING.top - SERIES_PADDING.bottom
  const x = (index: number) => SERIES_PADDING.left + index / Math.max(1, current.length - 1) * plotWidth
  const y = (value: number) => SERIES_PADDING.top + plotHeight - value / max * plotHeight
  const pathOf = (points: SeriesPoint[]) => curvePath(points.map((point, index) => ({ x: x(index), y: y(point.value) })))
  const labelAt = new Set(width < 440 ? [0, current.length - 1] : [0, Math.floor(current.length / 3), Math.floor(current.length * 2 / 3), current.length - 1])
  const tooltipWidth = Math.min(240, width)

  return <div className="chart-series">
    <div className="chart-readout">
      <div><span>Ocorrências no período</span><strong>{number(total)}</strong></div>
      <div><span>Pico por intervalo</span><strong>{peak ? number(peak.value) : "—"}<small>{peak && total > 0 ? ` · ${peak.label}` : ""}</small></strong></div>
      <p>Selecione o gráfico e use ← → para consultar os registros.</p>
    </div>
    <Legend items={[{ color: BAR_COLOR, label: currentLabel }, ...(comparison && previousLabel ? [{ color: CONTEXT_COLOR, label: previousLabel, dashed: true }] : [])]} />
    <div ref={ref} className="chart-plot relative w-full">
      {current.length < 2 ? <p className="chart-empty">Período curto demais para desenhar uma série.</p> : width > 0 && <svg width={width} height={SERIES_HEIGHT} role="group" aria-label={`Série de ${currentLabel} ao longo do período`}>
        {ticks.map((tick) => <g key={tick}><line x1={SERIES_PADDING.left} y1={y(tick)} x2={width - SERIES_PADDING.right} y2={y(tick)} stroke={GRID_COLOR} strokeDasharray={tick === 0 ? undefined : "2 4"} /><text x={SERIES_PADDING.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill={AXIS_INK}>{number(tick)}</text></g>)}
        <path d={`${pathOf(current)} L${x(current.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={BAR_COLOR} opacity={.07} />
        {comparison && <path d={pathOf(comparison)} fill="none" stroke={CONTEXT_COLOR} strokeWidth={2} strokeDasharray="5 4" />}
        <path d={pathOf(current)} fill="none" stroke={BAR_COLOR} strokeWidth={2.5} strokeLinejoin="round" />
        {current.map((point, index) => <circle key={index} cx={x(index)} cy={y(point.value)} r={current.length > 40 ? 1.8 : 3} fill={SURFACE} stroke={BAR_COLOR} strokeWidth={1.5} />)}
        {current.map((point, index) => labelAt.has(index) && <text key={index} x={x(index)} y={SERIES_HEIGHT - 9} textAnchor={index === 0 ? "start" : index === current.length - 1 ? "end" : "middle"} fontSize={11} fill={AXIS_INK}>{point.label}</text>)}
        {hover !== null && <g><line x1={x(hover)} y1={SERIES_PADDING.top} x2={x(hover)} y2={y(0)} stroke={AXIS_INK} strokeDasharray="3 3" /><circle cx={x(hover)} cy={y(current[hover].value)} r={5} fill={BAR_COLOR} stroke={SURFACE} strokeWidth={2} />{comparison?.[hover] && <circle cx={x(hover)} cy={y(comparison[hover].value)} r={4} fill={CONTEXT_COLOR} stroke={SURFACE} strokeWidth={2} />}</g>}
        <rect x={SERIES_PADDING.left} y={SERIES_PADDING.top} width={plotWidth} height={plotHeight} fill="transparent" tabIndex={0} role="slider" aria-label="Consultar volume por data" aria-valuemin={0} aria-valuemax={current.length - 1} aria-valuenow={hover ?? 0} aria-valuetext={`${current[hover ?? 0].label}: ${current[hover ?? 0].value} ocorrências`}
          onFocus={() => setHover(0)} onBlur={() => setHover(null)}
          onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); setHover(event.key === "Home" ? 0 : event.key === "End" ? current.length - 1 : Math.max(0, Math.min(current.length - 1, (hover ?? 0) + (event.key === "ArrowRight" ? 1 : -1)))) }}
          onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(current.length - 1, Math.round((event.clientX - box.left) / (box.width || 1) * (current.length - 1))))) }} onPointerLeave={() => setHover(null)} />
      </svg>}
      {hover !== null && current[hover] && width > 0 && <div className="chart-tooltip" style={{ width: tooltipWidth, left: Math.min(Math.max(x(hover) - tooltipWidth / 2, 0), Math.max(width - tooltipWidth, 0)) }}>
        <p>{current[hover].label}</p><TooltipRow color={BAR_COLOR} label={currentLabel} value={number(current[hover].value)} />
        {comparison?.[hover] && previousLabel && <TooltipRow color={CONTEXT_COLOR} label={`${previousLabel} · ${comparison[hover].label}`} value={number(comparison[hover].value)} />}
      </div>}
    </div>
  </div>
}

const RAMP = ["#172633", "#23434f", "#2b6170", "#408595", "#69a7b4", "#a0cdd4"]
const rampColor = (ratio: number) => RAMP[ratio <= 0 ? 0 : Math.min(RAMP.length - 1, Math.max(1, Math.ceil(ratio * (RAMP.length - 1))))]

export function HeatGrid({ rows, values }: { rows: string[]; values: number[][] }) {
  const [ref, width] = useMeasure()
  const [hover, setHover] = useState<{ row: number; hour: number } | null>(null)
  const max = Math.max(...values.flat(), 1)
  const total = values.flat().reduce((sum, value) => sum + value, 0)
  const labelWidth = 34
  const cell = Math.max(0, width - labelWidth) / 24
  const cellHeight = 30
  const active = hover ?? { row: 0, hour: 0 }

  return <div className="chart-heatgrid">
    <div className="chart-section-heading"><p>Dia da semana × hora de abertura</p></div>
    <div ref={ref} className="chart-heatgrid-plot">
      {!total ? <p className="chart-empty">Nenhuma ocorrência no período filtrado.</p> : width > 0 && <svg width={width} height={rows.length * cellHeight + 25} role="group" aria-label="Ocorrências por dia da semana e hora do dia">
        {rows.map((row, rowIndex) => <g key={row}>
          <text x={0} y={rowIndex * cellHeight + cellHeight / 2 + 4} fontSize={11} fill={AXIS_INK}>{row}</text>
          {(values[rowIndex] ?? []).map((value, hour) => <rect key={hour} x={labelWidth + hour * cell + 1} y={rowIndex * cellHeight + 1} width={Math.max(1, cell - 2)} height={cellHeight - 2} fill={rampColor(value / max)} />)}
        </g>)}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => <text key={hour} x={labelWidth + hour * cell + cell / 2} y={rows.length * cellHeight + 18} textAnchor="middle" fontSize={11} fill={AXIS_INK}>{hour}h</text>)}
        {hover && <rect x={labelWidth + hover.hour * cell + 1} y={hover.row * cellHeight + 1} width={Math.max(1, cell - 2)} height={cellHeight - 2} fill="none" stroke="var(--color-ink)" strokeWidth={2} />}
        <rect x={labelWidth} y={0} width={cell * 24} height={rows.length * cellHeight} fill="transparent" tabIndex={0} role="slider" aria-label="Consultar distribuição semanal. Setas esquerda e direita mudam a hora; acima e abaixo mudam o dia." aria-valuemin={0} aria-valuemax={rows.length * 24 - 1} aria-valuenow={active.row * 24 + active.hour} aria-valuetext={`${rows[active.row]}, ${active.hour}h: ${values[active.row]?.[active.hour] ?? 0} ocorrências`}
          onFocus={() => setHover(active)} onBlur={() => setHover(null)}
          onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return; event.preventDefault(); setHover({ row: Math.max(0, Math.min(rows.length - 1, active.row + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0))), hour: event.key === "Home" ? 0 : event.key === "End" ? 23 : Math.max(0, Math.min(23, active.hour + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0))) }) }}
          onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHover({ row: Math.max(0, Math.min(rows.length - 1, Math.floor((event.clientY - box.top) / cellHeight))), hour: Math.max(0, Math.min(23, Math.floor((event.clientX - box.left) / (box.width || 1) * 24))) }) }} onPointerLeave={() => setHover(null)} />
      </svg>}
    </div>
    {total > 0 && <>
      <div className="chart-heat-legend"><span>0</span><span className="chart-ramp" aria-hidden="true">{RAMP.map((color) => <i key={color} style={{ background: color }} />)}</span><span>{number(max)} ocorrências</span></div>
      <div className="chart-inline-readout">{hover ? <><strong>{rows[hover.row]}, {String(hover.hour).padStart(2, "0")}h</strong><span>{number(values[hover.row]?.[hover.hour] ?? 0)} ocorrências</span></> : <span>Consulte uma célula com o cursor ou as setas do teclado.</span>}</div>
    </>}
  </div>
}

function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return <ul className="chart-legend">{items.map((item) => <li key={item.label}><span aria-hidden="true" style={{ borderColor: item.color, borderTopStyle: item.dashed ? "dashed" : "solid" }} />{item.label}</li>)}</ul>
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return <div className="chart-tooltip-row"><span aria-hidden="true" style={{ background: color }} /><strong>{value}</strong><span>{label}</span></div>
}

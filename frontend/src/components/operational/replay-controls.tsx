import type { useReplayClock } from './use-replay-clock'

export function ReplayControls({ clock }: { clock: ReturnType<typeof useReplayClock> }) {
  return <div className="op-replay-actions">
    <button type="button" disabled={clock.reduced || clock.end <= clock.start} onClick={clock.toggle}>{clock.playing ? 'Pausar' : clock.at >= clock.end ? 'Rever' : 'Reproduzir em 60 s'}</button>
    <button type="button" onClick={() => clock.seek(clock.start)}>Início</button>
    <input aria-label="Instante do replay" type="range" min={clock.start} max={clock.end} step={1000} value={clock.at} onChange={(event) => clock.seek(Number(event.target.value))} />
    <button type="button" onClick={() => clock.seek(clock.end)}>Fim</button>
    <time dateTime={new Date(clock.at).toISOString()}>{new Date(clock.at).toLocaleString('pt-BR')}</time>
    {clock.reduced && <span>Movimento reduzido · navegue pela barra e pelos eventos</span>}
  </div>
}

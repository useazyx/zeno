import { useEffect, useRef, useState } from 'react'
import type { Map as LibreMap } from 'maplibre-gl'
import type { RouteMetrics } from './routes/utils'

export function ElevationProfile({ map, route }: { map: LibreMap; route: RouteMetrics }) {
  const [samples, setSamples] = useState<(number | null)[]>([])
  const dot = useRef<SVGCircleElement>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const sample = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const terrain = map.getTerrain()
        if (!terrain || !map.isSourceLoaded(terrain.source)) return
        const scale = typeof terrain.exaggeration === 'number' && terrain.exaggeration > 0 ? terrain.exaggeration : 1
        setSamples(Array.from({ length: 81 }, (_, index) => {
          const elevation = map.queryTerrainElevation(route.pointAtDist(route.totalMeters * index / 80))
          return elevation === null ? null : elevation / scale
        }))
      }, 300)
    }
    sample()
    map.on('idle', sample)
    return () => { map.off('idle', sample); clearTimeout(timer) }
  }, [map, route])
  const finite = samples.filter((height): height is number => height !== null)
  const min = Math.min(...finite), max = Math.max(...finite)
  useEffect(() => {
    const update = (event: { fraction?: number }) => {
      const index = Math.round(Math.max(0, Math.min(1, event.fraction ?? 0)) * 80)
      const value = samples[index]
      if (!dot.current || value == null) return
      dot.current.setAttribute('cx', String(index / 80 * 300))
      dot.current.setAttribute('cy', String(43 - (value - min) / Math.max(1, max - min) * 32))
    }
    map.on('zeno:progress', update)
    return () => { map.off('zeno:progress', update) }
  }, [map, samples, min, max])
  if (!finite.length) return <span className="elevation-unavailable">Altitude aguardando o relevo real.</span>
  const path = samples.map((value, index) => value === null ? '' : `${index === 0 || samples[index - 1] === null ? 'M' : 'L'}${index / 80 * 300},${43 - (value - min) / Math.max(1, max - min) * 32}`).join(' ')
  return <figure className="elevation-profile"><figcaption>Altitude · {Math.round(min)}–{Math.round(max)} m{finite.length < samples.length ? ' · trechos sem DEM' : ''}</figcaption><svg viewBox="0 0 300 50" role="img" aria-label={`Perfil do relevo entre ${Math.round(min)} e ${Math.round(max)} metros`}><path d={path} fill="none" stroke="currentColor" strokeWidth="2" /><circle ref={dot} r="3" cx="0" cy="43" fill="var(--color-info, #68B9E8)" /></svg></figure>
}

export function SimulationRecorder({ map, flyover }: { map: LibreMap; flyover: () => void }) {
  const recorder = useRef<MediaRecorder | null>(null)
  const discard = useRef(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const visibility = () => {
      const current = recorder.current
      if (document.hidden && current?.state === 'recording') current.pause()
      else if (!document.hidden && current?.state === 'paused') current.resume()
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      discard.current = true
      if (recorder.current?.state !== 'inactive') recorder.current?.stop()
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  const start = () => {
    setError('')
    try {
      const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType || !map.getCanvas().captureStream) throw new Error('Gravação WebM indisponível neste navegador.')
      const stream = map.getCanvas().captureStream(30)
      const current = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 })
      const chunks: Blob[] = []
      discard.current = false
      recorder.current = current
      current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      const deadline = setTimeout(() => { if (current.state !== 'inactive') current.stop() }, 120000)
      current.onstop = () => {
        clearTimeout(deadline)
        stream.getTracks().forEach((track) => track.stop())
        if (discard.current) return
        setRecording(false)
        const url = URL.createObjectURL(new Blob(chunks, { type: mimeType }))
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = `zeno-simulacao-${Date.now()}.webm`; anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      current.onerror = () => { discard.current = true; setError('Não foi possível concluir a gravação.'); setRecording(false); stream.getTracks().forEach((track) => track.stop()) }
      current.start(1000)
      setRecording(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gravação indisponível.') }
  }
  return <div className="simulation-recording"><button type="button" onClick={() => recording ? recorder.current?.stop() : start()}>{recording ? 'Salvar vídeo WebM' : 'Gravar mapa'}</button><button type="button" onClick={flyover}>Sobrevoo</button>{recording && <span role="status">Gravando o mapa · até 2 min</span>}{error && <span role="alert">{error}</span>}</div>
}

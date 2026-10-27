/**
 * The call that cannot wait.
 *
 * A new occurrence of high or critical priority interrupts whatever screen the
 * dispatcher is on: a banner that stays until acknowledged, a two-tone chime
 * synthesised in the browser (no audio file to fail loading), and a system
 * notification when the console is in another tab. Lower priorities only reach
 * the panel's live feed, so the alert keeps its meaning.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { Bell, BellOff, Siren, X } from "lucide-react"
import { Link } from "react-router-dom"

import { NATURE_LABEL, PRIORITY_LABEL } from "@/api/labels"
import type { OccurrenceNature, OccurrencePriority } from "@/api/types"
import { useRealtime } from "@/hooks/use-realtime"
import { cn } from "@/lib/utils"
import { occurrences } from '@/api/endpoints'
import { useResource } from '@/hooks/use-resource'
import { useOperationClock } from '@/components/operational/use-operation-clock'
import { ageLabel } from '@/components/operational/operation-state'
import '@/components/operational/operational.css'

const MUTE_KEY = "zeno.alerts.muted"
const ALERTING: string[] = ["CRITICA", "ALTA"]

// -- Mute preference, shared by the banner and the navbar toggle --------------

const muteListeners = new Set<() => void>()

function readMuted(): boolean {
  try { return window.localStorage.getItem(MUTE_KEY) !== "0" } catch { return true }
}

let muted = typeof window === "undefined" ? true : readMuted()

function setMuted(value: boolean) {
  muted = value
  try { window.localStorage.setItem(MUTE_KEY, value ? "1" : "0") } catch { /* private window */ }
  muteListeners.forEach((notify) => notify())
}

function useMuted() {
  return useSyncExternalStore(
    (notify) => { muteListeners.add(notify); return () => muteListeners.delete(notify) },
    () => muted,
  )
}

/** Two descending tones, the shape of a station alert, at a sober volume. */
function chime(critical: boolean) {
  try {
    const context = new AudioContext()
    const tones = critical ? [880, 660, 880, 660] : [880, 660]
    tones.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime + index * 0.28
      oscillator.type = "sine"
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.27)
    })
    window.setTimeout(() => context.close(), tones.length * 300 + 200)
  } catch {
    /* no audio device, or autoplay blocked before any interaction */
  }
}

export function AlertToggle() {
  const isMuted = useMuted()

  return (
    <button
      type="button"
      onClick={() => {
        if (isMuted && "Notification" in window && Notification.permission === "default") {
          void Notification.requestPermission()
        }
        setMuted(!isMuted)
      }}
      aria-pressed={!isMuted}
      title={isMuted ? "Alertas sonoros desligados" : "Alertas sonoros ligados para prioridade alta e crítica"}
      className={cn(
        "hidden rounded-sm border p-1.5 transition-colors sm:inline-flex",
        isMuted ? "border-chrome-line text-chrome-muted hover:text-white" : "border-accent/40 bg-accent/15 text-white",
      )}
    >
      {isMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      <span className="sr-only">{isMuted ? "Ligar alertas sonoros" : "Silenciar alertas"}</span>
    </button>
  )
}

interface Alert {
  id: string
  protocol: string
  nature: OccurrenceNature
  priority: OccurrencePriority
  address: string
}

export function CriticalAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const isMuted = useMuted()

  useRealtime(useCallback((event) => {
    if (event.type !== "occurrence.created" || !ALERTING.includes(event.payload.priority)) return

    const alert: Alert = {
      id: event.payload.id,
      protocol: event.payload.protocol,
      nature: event.payload.nature as OccurrenceNature,
      priority: event.payload.priority as OccurrencePriority,
      address: event.payload.address,
    }

    setAlerts((current) => [alert, ...current.filter((item) => item.id !== alert.id)].slice(0, 4))

    if (!muted) chime(alert.priority === "CRITICA")

    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const notification = new Notification(`Ocorrência ${PRIORITY_LABEL[alert.priority].toLowerCase()}: ${NATURE_LABEL[alert.nature]}`, {
        body: `${alert.protocol} · ${alert.address}`,
        tag: alert.id,
        requireInteraction: alert.priority === "CRITICA",
      })
      notification.onclick = () => {
        window.focus()
        window.location.assign(`/ocorrencias/${alert.id}`)
      }
    }
  }, []))

  // A persistent title cue works without flashing in an unattended tab.
  useEffect(() => {
    if (alerts.length === 0) return
    const original = document.title
    document.title = `● ${alerts.length} ocorrência(s) urgente(s)`
    return () => { document.title = original }
  }, [alerts.length])

  if (alerts.length === 0) return null

  const dismiss = (id: string) => setAlerts((current) => current.filter((item) => item.id !== id))

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-3 sm:top-[4.5rem]" aria-live="assertive">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          role="alert"
          className={cn(
            "op-critical-banner pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-sm border bg-surface px-4 py-3 shadow-2xl",
            alert.priority === "CRITICA" ? "border-alert" : "border-warn",
          )}
        >
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-sm", alert.priority === "CRITICA" ? "bg-alert-soft text-alert" : "bg-warn-soft text-warn")}>
            <Siren className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {NATURE_LABEL[alert.nature]} · prioridade {PRIORITY_LABEL[alert.priority].toLowerCase()}
            </p>
            <p className="truncate text-sm text-ink-muted">{alert.protocol} · {alert.address}</p>
            <AlertAge id={alert.id} />
          </div>
          <Link
            to={`/ocorrencias/${alert.id}`}
            onClick={() => dismiss(alert.id)}
            className="shrink-0 rounded-sm border border-action bg-action px-3 py-1.5 text-sm font-semibold text-white hover:bg-action-hover"
          >
            Abrir
          </Link>
          <button type="button" onClick={() => dismiss(alert.id)} aria-label="Dispensar alerta" className="shrink-0 text-ink-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {isMuted && <p className="pointer-events-auto rounded-sm bg-chrome px-2 py-0.5 text-xs text-chrome-muted">Som desligado</p>}
    </div>
  )
}

function AlertAge({ id }: { id: string }) {
  const detail = useResource(() => occurrences.get(id), [id])
  const now = useOperationClock()
  return detail.data ? <time dateTime={detail.data.opened_at}>Aberta há {ageLabel(detail.data.opened_at, now)}</time> : null
}

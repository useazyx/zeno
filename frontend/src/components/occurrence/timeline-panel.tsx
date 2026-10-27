/**
 * The occurrence log: every change, in order, with the time it happened, and
 * the notes the dispatcher adds while the call goes on. It refreshes itself
 * when the backend says a line was written.
 */

import { useState } from "react"
import type { FormEvent } from "react"
import { History, MessageSquarePlus } from "lucide-react"

import { occurrences } from "@/api/endpoints"
import { ActionButton, Panel, TextInput } from "@/components/layout/kit"
import { ErrorBox, LoadingBlock } from "@/components/layout/feedback"
import type { useTimeline } from "@/hooks/use-timeline"
import { useMutation } from "@/hooks/use-resource"
import { eventTone, phraseEvent } from "@/lib/timeline-language"
import { cn } from "@/lib/utils"

const DOT: Record<ReturnType<typeof eventTone>, string> = {
  alert: "bg-alert",
  warn: "bg-warn",
  ok: "bg-ok",
  accent: "bg-accent",
  mute: "bg-ink-soft",
}

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })


export function TimelinePanel({ occurrenceId, closed, timeline, replayAt, onReplaySeek }: {
  occurrenceId: string
  closed: boolean
  timeline: ReturnType<typeof useTimeline>
  replayAt?: number
  onReplaySeek?: (at: number) => void
}) {
  const [note, setNote] = useState("")
  const add = useMutation((message: string) => occurrences.addNote(occurrenceId, { message }))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    const saved = await add.run(note.trim())
    if (saved) {
      setNote("")
      timeline.reload()
    }
  }

  const events = timeline.data ?? []
  const currentEvent = replayAt === undefined ? undefined : events.filter((event) => Date.parse(event.at) <= replayAt).at(-1)?.id

  return (
    <Panel title="Linha do tempo" icon={<History className="h-5 w-5" />}>
      {!closed && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            placeholder="Registrar informação: “vítima consciente”, “2º andar comprometido”…"
            aria-label="Nova anotação"
            className="flex-1"
          />
          <ActionButton tone="neutral" type="submit" disabled={add.submitting || !note.trim()}>
            <MessageSquarePlus className="h-4 w-4" />
            Registrar
          </ActionButton>
        </form>
      )}
      {add.error && <ErrorBox message={add.error} />}

      {timeline.loading && !timeline.data && <LoadingBlock label="Carregando linha do tempo..." />}
      {timeline.error && <ErrorBox message={timeline.error} onRetry={timeline.reload} />}
      {timeline.data && !timeline.loading && !timeline.error && events.length === 0 && (
        <p className="border-l-2 border-line-strong bg-surface-muted px-4 py-3 text-sm leading-relaxed text-ink-muted">
          Nenhum registro na linha do tempo.{!closed && " As atualizações do atendimento e as anotações aparecerão aqui."}
        </p>
      )}

      {events.length > 0 && (
        <ol className="relative flex flex-col gap-0 border-l border-line pl-4">
          {events.map((event, index) => {
            const at = new Date(event.at)
            const previous = index > 0 ? new Date(events[index - 1].at) : null
            const newDay = !previous || DAY.format(previous) !== DAY.format(at)
            return (
              <li key={event.id} className="relative py-1.5" data-replay-current={currentEvent === event.id || undefined} data-replay-future={replayAt !== undefined && Date.parse(event.at) > replayAt || undefined}>
                <span aria-hidden className={cn("absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full ring-2 ring-surface", DOT[eventTone(event)])} />
                {newDay && <p className="label-caps text-ink-soft">{DAY.format(at)}</p>}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  {onReplaySeek ? <button type="button" onClick={() => onReplaySeek(at.getTime())} className="font-mono text-xs tabular-nums text-accent underline" aria-label={`Reproduzir a partir de ${TIME.format(at)}: ${phraseEvent(event)}`}><time dateTime={event.at}>{TIME.format(at)}</time></button> : <time dateTime={event.at} className="font-mono text-xs tabular-nums text-ink-muted">{TIME.format(at)}</time>}
                  <span className={cn("text-sm", event.type === "NOTA" ? "italic text-ink" : "font-semibold text-ink")}>
                    {phraseEvent(event)}
                  </span>
                  {event.derived && (
                    <span
                      className="label-caps text-ink-soft"
                      title="Registro anterior à linha do tempo, reconstruído pelos horários gravados na ocorrência"
                    >
                      reconstruído
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}


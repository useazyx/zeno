/** An occurrence's timeline, refetched whenever the backend writes to it. */

import { useCallback } from "react"

import { occurrences } from "@/api/endpoints"
import { useRealtime } from "@/hooks/use-realtime"
import { useResource } from "@/hooks/use-resource"

export function useTimeline(occurrenceId: string) {
  const timeline = useResource(() => occurrences.timeline(occurrenceId), [occurrenceId])
  const reload = timeline.reload

  useRealtime(useCallback((event) => {
    // Every logged change publishes this ping, so it is the only one needed.
    if (event.type === "occurrence.timeline" && event.payload.occurrence_id === occurrenceId) reload()
  }, [occurrenceId, reload]))

  return timeline
}

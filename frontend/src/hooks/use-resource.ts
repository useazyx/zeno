/**
 * Small data-fetching helpers.
 *
 * The project has no query library and does not need one: every screen either
 * loads a list once and reloads it on an event, or submits a form. These two
 * hooks cover both without adding a dependency.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { ApiError } from "@/api/client"
import { translateMessage } from "@/api/messages"

export interface Resource<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Refetches without clearing the current data, so lists do not blink. */
  reload: () => void
  setData: (value: T) => void
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return translateMessage(error.message)
  if (error instanceof Error) return translateMessage(error.message)
  return "Erro inesperado"
}

export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean } = {},
): Resource<T> {
  const enabled = options.enabled ?? true

  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  // Keeping the fetcher in a ref means callers can pass an inline arrow
  // function without it retriggering the effect on every render.
  // Refreshed in a layout effect, which runs before the fetching effect below.
  const fetcherRef = useRef(fetcher)
  useLayoutEffect(() => { fetcherRef.current = fetcher })

  useEffect(() => {
    if (!enabled) {
      // A disabled resource is simply not loading; there is no external system
      // to subscribe to, so this one synchronous update is the honest way.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)

    fetcherRef.current()
      .then((result) => {
        if (!active) return
        setData(result)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!active) return
        // An aborted request is a navigation, not a failure worth showing.
        if (cause instanceof DOMException && cause.name === "AbortError") return
        setError(messageOf(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, loading, error, reload, setData }
}

export interface Mutation<TInput, TResult> {
  run: (input: TInput) => Promise<TResult | null>
  submitting: boolean
  error: string | null
  details: string[] | null
  reset: () => void
}

/**
 * Wraps a write call so forms get the submitting flag, the message and the
 * field-level detail the backend sends with a validation failure.
 */
export function useMutation<TInput, TResult>(
  action: (input: TInput) => Promise<TResult>,
): Mutation<TInput, TResult> {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[] | null>(null)

  const actionRef = useRef(action)
  useLayoutEffect(() => { actionRef.current = action })

  const run = useCallback(async (input: TInput): Promise<TResult | null> => {
    setSubmitting(true)
    setError(null)
    setDetails(null)

    try {
      return await actionRef.current(input)
    } catch (cause: unknown) {
      setError(messageOf(cause))
      setDetails(cause instanceof ApiError && cause.details ? cause.details : null)
      return null
    } finally {
      setSubmitting(false)
    }
  }, [])

  const reset = useCallback(() => {
    setError(null)
    setDetails(null)
  }, [])

  return { run, submitting, error, details, reset }
}

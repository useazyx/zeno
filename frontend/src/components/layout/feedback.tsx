/** Loading, error and empty states, so every screen fails the same way. */

import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react"
import type { ReactNode } from "react"

export function FullPageSpinner({ label = "Carregando..." }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-accent" />
      <p className="text-ink-muted">{label}</p>
    </div>
  )
}

export function LoadingBlock({ label = "Carregando..." }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 rounded-sm border border-line bg-surface px-6 py-10">
      <Loader2 className="h-5 w-5 animate-spin text-accent" />
      <p className="text-ink-muted">{label}</p>
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string, onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-sm border border-alert/30 bg-alert-soft px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-alert" />
        <p className="text-sm text-ink">{message}</p>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex w-fit items-center gap-2 rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar de novo
        </button>
      )}
    </div>
  )
}

/** Field-level messages from the backend's zod validation. */
export function ErrorDetails({ details }: { details: string[] | null }) {
  if (!details || details.length === 0) return null

  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-alert">
      {details.map((detail) => <li key={detail}>{detail}</li>)}
    </ul>
  )
}

export function EmptyState({ title, description, action }: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-sm border border-dashed border-line-strong bg-surface-muted px-6 py-12 text-center">
      <Inbox className="h-9 w-9 text-ink-soft" />
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-ink-muted">{description}</p>}
      {action}
    </div>
  )
}

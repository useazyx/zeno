/**
 * The shared building blocks every screen is made of.
 *
 * They set the visual language of the console: graphite panels with a hairline
 * over a dark workspace, one steel blue for anything that can be acted
 * on, quiet chips for status, and oversized tabular figures for the numbers a
 * dispatcher reads at a glance. Colour is spent on meaning and nowhere else.
 */

import { Children, createContext, useContext, useEffect, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { Dialog } from "radix-ui"

import { cn } from "@/lib/utils"

import "./table.css"

// -- Page scaffolding --------------------------------------------------------

export function PageHeader({ title, subtitle, actions }: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-4xl text-sm leading-relaxed text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="zeno-page mx-auto flex w-full max-w-[1760px] flex-col gap-4 px-3 py-5 sm:gap-5 sm:px-5 sm:py-6 xl:px-6">{children}</div>
}

export function Panel({ title, icon, actions, children, className }: {
  title?: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("zeno-panel flex flex-col rounded-[2px] border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="zeno-panel-header flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-muted px-4 py-2.5">
          <div className="flex items-center gap-2 text-ink-muted">
            {icon}
            {title && <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>}
          </div>
          {actions}
        </header>
      )}
      <div className="zeno-panel-body flex flex-1 flex-col gap-4 p-4">{children}</div>
    </section>
  )
}

// -- Indicators --------------------------------------------------------------

/**
 * A status, worn quietly.
 *
 * The first version filled these solid in a different saturated hue per state,
 * which put a dozen loud rectangles on a list of incidents and left nothing
 * for the incident itself to stand out with. A tinted ground with the same
 * colour in the border and the text says the same thing at a tenth of the
 * volume — the `tone` comes from the maps in `api/labels`.
 */
export function Badge({ tone, children }: { tone: string, children: ReactNode }) {
  return (
    <span className={cn("label-caps inline-flex items-center whitespace-nowrap rounded-[2px] border px-2 py-0.5", tone)}>
      {children}
    </span>
  )
}

/** The oversized figure the dashboard is built from. */
export function StatBox({ icon, label, value, hint, tone = "text-ink" }: {
  icon?: ReactNode
  label: string
  value: ReactNode
  hint?: string
  tone?: string
}) {
  return (
    <div className={cn("zeno-stat flex flex-col gap-2 rounded-[2px] border border-line bg-surface px-4 py-4 sm:px-5", tone)}>
      <div className="flex items-center gap-2 text-ink-muted">
        {icon}
        <p className="label-caps">{label}</p>
      </div>
      <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink sm:text-4xl">{value}</p>
      {hint && <p className="mt-auto text-xs leading-relaxed text-ink-muted">{hint}</p>}
    </div>
  )
}

// -- Buttons -----------------------------------------------------------------

type ButtonTone = "primary" | "neutral" | "danger" | "ghost"

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary: "border-action bg-action text-white hover:bg-action-hover hover:border-action-hover",
  neutral: "border-line-strong bg-surface text-ink hover:bg-surface-muted",
  danger: "border-danger bg-danger text-white hover:bg-danger-hover hover:border-danger-hover",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-mute-soft hover:text-ink",
}

export function ActionButton({ tone = "neutral", className, children, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-[2px] border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_TONES[tone],
        className,
      )}
    >
      {children}
    </button>
  )
}

/**
 * Destructive action guarded by a second click.
 *
 * A native `confirm()` would block the page — and the backend answers 409 when
 * a record still has links, so the mistake this guards against is common
 * enough to be worth the extra tap.
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, className }: {
  label: ReactNode
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  className?: string
}) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  return (
    <ActionButton
      tone={armed ? "danger" : "ghost"}
      type="button"
      disabled={disabled}
      className={className}
      onClick={() => {
        if (!armed) { setArmed(true); return }
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirmLabel : label}
    </ActionButton>
  )
}

// -- Form controls -----------------------------------------------------------

export function Field({ label, hint, required, children }: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    // `min-w-0`: a select sized by its longest option must not widen the grid
    // column it sits in past the screen of a phone.
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label-caps text-ink-muted">
        {label}
        {required && <span className="text-alert"> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-ink-soft">{hint}</span>}
    </label>
  )
}

/**
 * Puts a button on the same line as the inputs beside it.
 *
 * A `Field` stacks a label over its control, and optionally a hint under it, so
 * a bare button in the same row lands a label's height too high with
 * `items-start` and hangs below the hint with `items-end`. Reserving the same
 * invisible label gives the button the offset every other column already has,
 * and the row can then align to the top and stay put however tall the hints
 * around it get.
 */
export function FieldButton({ children, className }: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span aria-hidden className="label-caps select-none text-transparent">.</span>
      {children}
    </div>
  )
}

const CONTROL =
  "min-h-10 min-w-0 max-w-full rounded-[2px] border border-line-strong bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors " +
  "placeholder:text-ink-soft focus:border-accent focus:ring-2 focus:ring-accent/20"

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, props.className)} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL, "min-h-24 resize-y", props.className)} />
}

export function Select({ options, placeholder, value, onChange, ...props }: {
  options: { value: string, label: string }[]
  placeholder?: string
  value: string
  onChange: (value: string) => void
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select
      {...props}
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
      className={cn(CONTROL, props.className)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

// -- Tables ------------------------------------------------------------------

/**
 * The column names, so a cell can carry its own on a narrow screen.
 *
 * Below `sm` the table stacks into cards (see `table.css`) and each cell needs
 * to say which column it is. Passing that down through context rather than
 * asking every screen to repeat its headers on every cell keeps the eight
 * tables in this system declaring their headers exactly once.
 */
const TableHeaders = createContext<string[]>([])
const ColumnIndex = createContext(0)

export function Table({ headers, children }: { headers: string[], children: ReactNode }) {
  return (
    <TableHeaders.Provider value={headers}>
      <div className="w-full sm:overflow-x-auto">
        <table className="stack-table w-full border-collapse text-left sm:min-w-[640px]">
          <thead>
            <tr className="border-b border-line-strong">
              {headers.map((header) => (
                <th key={header} className="label-caps px-3 py-2 text-ink-soft">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </TableHeaders.Provider>
  )
}

export function Row({ children, onClick }: { children: ReactNode, onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          onClick()
        }
      } : undefined}
      className={cn(
        "border-b border-line align-middle",
        onClick && "cursor-pointer transition-colors hover:bg-accent-soft",
      )}
    >
      {Children.map(children, (child, index) => (
        <ColumnIndex.Provider value={index}>{child}</ColumnIndex.Provider>
      ))}
    </tr>
  )
}

export function Cell({ children, className, title }: {
  children: ReactNode
  className?: string
  /** Native tooltip, for a column that shows an acronym and means a name. */
  title?: string
}) {
  const headers = useContext(TableHeaders)
  const label = headers[useContext(ColumnIndex)]

  // An actions column has a header nobody needs read back to them.
  const stackLabel = label && label !== "Ações" ? label : undefined

  return (
    <td
      title={title}
      data-label={stackLabel}
      className={cn("px-3 py-2.5 text-sm text-ink", className)}
    >
      {/* On a phone the cell is a flex line of label and value; wrapping the
          value keeps a cell with several spans as one item that can shrink,
          instead of laying them side by side past the screen's edge. Above
          `sm` the wrapper dissolves and the cell is an ordinary cell. */}
      <div className="min-w-0 [overflow-wrap:anywhere] sm:contents">{children}</div>
    </td>
  )
}

export function Pagination({ page, perPage, total, onPage }: {
  page: number
  perPage: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  if (total === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-sm text-ink-muted">
        {total} registro{total === 1 ? "" : "s"} — página {page} de {pages}
      </p>

      <div className="flex gap-2">
        <ActionButton
          tone="neutral"
          className="px-3 py-1"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Anterior
        </ActionButton>
        <ActionButton
          tone="neutral"
          className="px-3 py-1"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Próxima
        </ActionButton>
      </div>
    </div>
  )
}

// -- Modal -------------------------------------------------------------------

/**
 * A dialog that fits on the screen it is opened on.
 *
 * The first version centred the card with `items-center` inside the scrolling
 * backdrop. That is the classic flexbox trap: a dialog taller than the viewport
 * has its top half pushed above the scroll origin, where nothing can scroll to
 * it — which is exactly what happened to the incident form, whose top fields
 * were unreachable on a laptop without zooming the browser out.
 *
 * Two things fix it. `min-h-full` on the row makes the centring safe, because
 * the row is never shorter than the scroll area. And the card is capped at the
 * viewport height with only its body scrolling, so the title and the close
 * button stay put however long the form gets.
 */
export function Modal({ title, onClose, children, wide }: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const [opener] = useState(() => document.activeElement as HTMLElement | null)

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="zeno-backdrop fixed inset-0 z-50 bg-chrome/70" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
        <Dialog.Content
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener?.isConnected) opener.focus({ preventScroll: true })
          }}
          className={cn(
            "zeno-dialog pointer-events-auto flex max-h-[calc(100dvh-1.5rem)] w-full flex-col rounded-sm border border-line bg-surface shadow-2xl sm:max-h-[calc(100dvh-3rem)]",
            wide ? "max-w-4xl" : "max-w-2xl",
          )}
        >
          {/* The dialog wears the console's own chrome, so it reads as part of
              the instrument rather than as a card floating over it. */}
          <header className="flex shrink-0 items-center justify-between gap-3 bg-chrome px-4 py-3 sm:px-5">
            <Dialog.Title className="min-w-0 text-base font-semibold text-chrome-ink sm:text-lg">{title}</Dialog.Title>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-sm px-2 text-2xl leading-none text-chrome-muted transition-colors hover:text-white"
              aria-label="Fechar"
            >
              ×
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

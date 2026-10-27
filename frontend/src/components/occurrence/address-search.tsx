/**
 * Address field with autocomplete.
 *
 * The caller says a street and a number; the dispatcher types it and picks the
 * match, and the point lands on the map by itself. Typing coordinates is still
 * possible, but it stops being the only way in.
 *
 * Results come from Photon (OpenStreetMap) through the backend, bounded to the
 * street network the AI knows. Arrow keys move through the list, Enter picks.
 */

import { useEffect, useId, useRef, useState } from "react"
import { Loader2, MapPin, Search } from "lucide-react"

import { geo } from "@/api/endpoints"
import type { Place } from "@/api/types"
import { TextInput } from "@/components/layout/kit"
import { cn } from "@/lib/utils"

export function AddressSearch({ value, onChange, onPick, required, placeholder }: {
  value: string
  onChange: (value: string) => void
  onPick: (place: Place) => void
  required?: boolean
  placeholder?: string
}) {
  const listId = useId()
  const [places, setPlaces] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState(false)
  // A value set by picking a result must not trigger a new search for itself.
  const picked = useRef<string | null>(null)

  useEffect(() => {
    const text = value.trim()
    if (text.length < 3 || picked.current === value) {
      setPlaces([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      geo.search(text, controller.signal)
        .then((result) => {
          setPlaces(result)
          setFailed(false)
          setActive(result.length > 0 ? 0 : -1)
          setOpen(true)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return
          setFailed(true)
          setPlaces([])
        })
        .finally(() => setSearching(false))
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [value])

  function choose(place: Place) {
    picked.current = place.label
    onChange(place.label)
    onPick(place)
    setOpen(false)
    setPlaces([])
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <TextInput
          required={required}
          value={value}
          onChange={(event) => { picked.current = null; onChange(event.target.value) }}
          onFocus={() => places.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (!open || places.length === 0) return
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % places.length) }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index - 1 + places.length) % places.length) }
            if (event.key === "Enter" && active >= 0) { event.preventDefault(); choose(places[active]) }
            if (event.key === "Escape") { event.stopPropagation(); setOpen(false) }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="w-full pl-9 pr-9"
        />
        {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-accent" />}
      </div>

      {failed && <p className="mt-1 text-xs text-warn">Busca de endereço indisponível; marque o ponto no mapa.</p>}

      {open && places.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-sm border border-line bg-surface shadow-xl">
          {places.map((place, index) => (
            <li
              key={`${place.label}-${place.latitude}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => { event.preventDefault(); choose(place) }}
              onMouseEnter={() => setActive(index)}
              className={cn("flex cursor-pointer items-start gap-2 px-3 py-2 text-sm", index === active ? "bg-accent-soft" : "hover:bg-surface-muted")}
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span className="flex flex-col">
                <span className="text-ink">{place.label}</span>
                {place.postcode && <span className="text-xs text-ink-muted">CEP {place.postcode}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

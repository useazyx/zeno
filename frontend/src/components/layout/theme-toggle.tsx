import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

export function ThemeToggle() {
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light")
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== "zeno.theme") return
      const next = event.newValue === "light"
      document.documentElement.dataset.theme = next ? "light" : "dark"
      setLight(next)
    }
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [])
  const label = light ? "Ativar modo escuro" : "Ativar modo claro"
  return (
    <button type="button" aria-label={label} title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center border border-chrome-line text-chrome-muted transition-colors hover:bg-chrome-soft hover:text-chrome-ink"
      onClick={() => {
        const next = !light
        setLight(next)
        document.documentElement.dataset.theme = next ? "light" : "dark"
        try { localStorage.setItem("zeno.theme", next ? "light" : "dark") } catch { /* Storage is optional. */ }
      }}>
      {light ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  )
}

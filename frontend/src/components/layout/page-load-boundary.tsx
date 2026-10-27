import { Component, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

// Keep the navbar usable even if a page's lazy module or rendering fails.
// Changing route resets the boundary (keyed by location in App).
export class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error: Error) {
    console.error("Falha ao carregar tela do ZENO:", error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section role="alert" className="mx-auto my-8 flex max-w-xl flex-col items-start gap-4 rounded-sm border border-alert/30 bg-surface p-6 text-ink">
        <AlertTriangle className="h-6 w-6 text-alert" />
        <div>
          <h1 className="text-lg font-semibold">Não foi possível carregar esta página</h1>
          <p className="mt-2 text-sm text-ink-muted">A conexão ou os arquivos da página podem ter sido interrompidos. As demais áreas continuam acessíveis pelo menu.</p>
        </div>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
          <RefreshCw className="h-4 w-4" /> Tentar novamente
        </button>
      </section>
    )
  }
}

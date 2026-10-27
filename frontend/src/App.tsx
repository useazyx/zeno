import { Suspense } from "react"
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom"

import "./App.css"

import Navbar from "@/components/layout/navbar"
import { FullPageSpinner } from "@/components/layout/feedback"
import { PageLoadBoundary } from "@/components/layout/page-load-boundary"
import { lazyWithRetry } from "@/lib/lazy-retry"
import { CommandPalette } from "@/components/layout/command-palette"
import { CriticalAlerts } from "@/components/layout/critical-alert"
import { ActiveOccurrenceIsland } from "@/components/operational/active-occurrence-island"
import { PresentationTour } from "@/components/operational/presentation-tour"

import Painel from "@/pages/painel"

// The panel is the first screen and loads with the shell; every other screen
// is fetched on first visit, so opening the console does not wait for the
// map engine, the charts and the 3D vehicles all at once.
const Ocorrencias = lazyWithRetry(() => import("@/pages/ocorrencias"))
const OcorrenciaDetalhe = lazyWithRetry(() => import("@/pages/ocorrencia-detalhe"))
const Despachos = lazyWithRetry(() => import("@/pages/despachos"))
const Rotas = lazyWithRetry(() => import("@/pages/rotas"))
const Estatisticas = lazyWithRetry(() => import("@/pages/estatisticas"))
const RedeNeural = lazyWithRetry(() => import("@/pages/rede-neural"))
const Efetivo = lazyWithRetry(() => import("@/pages/efetivo"))
const Viaturas = lazyWithRetry(() => import("@/pages/viaturas"))
const Garagem = lazyWithRetry(() => import("@/pages/garagem"))
const Guarnicoes = lazyWithRetry(() => import("@/pages/guarnicoes"))
const Turnos = lazyWithRetry(() => import("@/pages/turnos"))
const Unidades = lazyWithRetry(() => import("@/pages/unidades"))
const Cobertura = lazyWithRetry(() => import("@/pages/cobertura"))
const Hidrantes = lazyWithRetry(() => import("@/pages/hidrantes"))
const Terminal = lazyWithRetry(() => import("@/pages/terminal"))
const Telao = lazyWithRetry(() => import("@/pages/telao"))

/**
 * There is no login.
 *
 * The console runs on a screen inside the station and is read while someone is
 * on the phone reporting a fire; a sign-in form between the operator and the
 * incident form costs seconds that belong to the call. Every screen is
 * therefore open, and the bar is the only chrome around them.
 */
function Shell() {
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a href="#conteudo" className="skip-link">Ir para o conteúdo</a>
      <Navbar />
      <CriticalAlerts />
      <CommandPalette />
      <ActiveOccurrenceIsland />
      <main id="conteudo" tabIndex={-1} className="min-w-0 flex-1">
        <PageLoadBoundary key={pathname}>
          <Suspense fallback={<FullPageSpinner />}>
            <Outlet />
          </Suspense>
        </PageLoadBoundary>
      </main>
      <PresentationTour />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Painel />} />
        <Route path="/ocorrencias" element={<Ocorrencias />} />
        <Route path="/ocorrencias/:id" element={<OcorrenciaDetalhe />} />
        <Route path="/despachos" element={<Despachos />} />
        <Route path="/rotas" element={<Rotas />} />
        <Route path="/cobertura" element={<Cobertura />} />
        <Route path="/estatisticas" element={<Estatisticas />} />
        <Route path="/rede-neural" element={<RedeNeural />} />

        <Route path="/efetivo" element={<Efetivo />} />
        <Route path="/viaturas" element={<Viaturas />} />
        <Route path="/garagem" element={<Garagem />} />
        <Route path="/guarnicoes" element={<Guarnicoes />} />
        <Route path="/turnos" element={<Turnos />} />
        <Route path="/unidades" element={<Unidades />} />
        <Route path="/hidrantes" element={<Hidrantes />} />
      </Route>

      {/* Screens for other devices: the tablet in the cab and the TV on the
          wall. They carry their own chrome, sized for gloves and distance. */}
      <Route path="/terminal" element={<Suspense fallback={<FullPageSpinner />}><Terminal /></Suspense>} />
      <Route path="/terminal/:vehicleId" element={<Suspense fallback={<FullPageSpinner />}><Terminal /></Suspense>} />
      <Route path="/telao" element={<Suspense fallback={<FullPageSpinner />}><Telao /></Suspense>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

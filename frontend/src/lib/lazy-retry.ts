import { lazy, type ComponentType } from "react"

// Chunk requests can fail transiently while Vite is rebuilding dependencies or
// the browser revisits a screen after a deployment. Retry once instead of
// leaving a Suspense spinner forever or poisoning React.lazy permanently.
export async function loadPageWithRetry<T>(
  loader: () => Promise<T>,
  timeoutMs = 12_000,
  retryDelayMs = 350,
): Promise<T> {
  const attempt = () => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("A tela demorou demais para carregar.")), timeoutMs)
    try {
      loader().then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error: unknown) => { clearTimeout(timer); reject(error) },
      )
    } catch (error) {
      clearTimeout(timer)
      reject(error)
    }
  })
  try { return await attempt() } catch {
    await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs))
    return attempt()
  }
}

export function lazyWithRetry<T extends { default: ComponentType }>(loader: () => Promise<T>) {
  return lazy(() => loadPageWithRetry(loader))
}

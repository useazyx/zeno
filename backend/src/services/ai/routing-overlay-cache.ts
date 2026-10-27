const CACHE_TTL_MS = 5 * 60_000
const MAX_CACHE_ENTRIES = 8
const MAX_CACHE_BYTES = 16 * 1024 * 1024
export const MAX_OVERLAY_RESPONSE_BYTES = 16 * 1024 * 1024

// O modelo entra na chave; o prazo só libera memória de consultas antigas.
export class RoutingOverlayCache<T> {
  private entries = new Map<string, { value: T, expires: number, bytes: number }>()
  private bytes = 0

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= Date.now()) {
      this.entries.delete(key)
      this.bytes -= entry.bytes
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    const bytes = Buffer.byteLength(JSON.stringify(value))
    if (bytes > MAX_CACHE_BYTES) return
    const old = this.entries.get(key)
    if (old) { this.entries.delete(key); this.bytes -= old.bytes }
    while (this.entries.size >= MAX_CACHE_ENTRIES || this.bytes + bytes > MAX_CACHE_BYTES) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.bytes -= this.entries.get(oldest)!.bytes
      this.entries.delete(oldest)
    }
    this.entries.set(key, { value, bytes, expires: Date.now() + CACHE_TTL_MS })
    this.bytes += bytes
  }
}

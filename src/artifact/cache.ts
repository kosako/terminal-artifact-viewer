// A memory-only cache bounded by entry count and total bytes; the least recently
// used entries go first. It lives as long as the session's module and is never written out.

type Entry<V> = { readonly value: V; readonly bytes: number }

export class BoundedCache<V> {
  readonly maxEntries: number
  readonly maxBytes: number
  #entries = new Map<string, Entry<V>>()
  #bytes = 0

  constructor(maxEntries: number, maxBytes: number) {
    this.maxEntries = maxEntries
    this.maxBytes = maxBytes
  }

  get size(): number {
    return this.#entries.size
  }

  get bytes(): number {
    return this.#bytes
  }

  get(key: string): V | undefined {
    const entry = this.#entries.get(key)
    if (entry === undefined) return undefined
    // Mark as most recently used.
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.value
  }

  /** Keeps the value unless it alone is over the byte bound; returns whether it was kept. */
  set(key: string, value: V, bytes: number): boolean {
    this.delete(key)
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes || this.maxEntries < 1) return false
    this.#entries.set(key, { value, bytes })
    this.#bytes += bytes
    while (this.#entries.size > this.maxEntries || this.#bytes > this.maxBytes) {
      const oldest = this.#entries.keys().next()
      if (oldest.done === true) break
      this.delete(oldest.value)
    }
    return true
  }

  delete(key: string): void {
    const entry = this.#entries.get(key)
    if (entry === undefined) return
    this.#entries.delete(key)
    this.#bytes -= entry.bytes
  }

  clear(): void {
    this.#entries.clear()
    this.#bytes = 0
  }
}

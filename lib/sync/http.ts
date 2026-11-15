import { FETCH_TIMEOUT_MS } from './config'

export interface FetchTextOptions {
  /** 0 disables the Next.js data cache for this request. */
  revalidate?: number
  timeoutMs?: number
  headers?: Record<string, string>
  retries?: number
  cacheTags?: string[]
}

const DEFAULT_HEADERS = {
  'User-Agent': 'PersibFixturesSync/1.0 (+https://persibfixtures-eight.vercel.app)',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id,en;q=0.8',
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fetch text with a hard timeout and one bounded retry for transient failures. */
export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<string> {
  const { revalidate = 60, timeoutMs = FETCH_TIMEOUT_MS, headers = {}, retries = 1, cacheTags } = options
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const init: RequestInit & { next?: { revalidate?: number; tags?: string[] } } = {
        headers: { ...DEFAULT_HEADERS, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      }
      if (revalidate === 0) {
        init.cache = 'no-store'
      } else {
        init.next = { revalidate, ...(cacheTags ? { tags: cacheTags } : {}) }
      }

      const res = await fetch(url, init)
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429
        if (retryable && attempt < retries) {
          await sleep(350 * (attempt + 1))
          continue
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}`.trim())
      }
      return await res.text()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await sleep(350 * (attempt + 1))
        continue
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`${new URL(url).hostname}: ${reason}`)
}

/** Run an async mapper over items with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

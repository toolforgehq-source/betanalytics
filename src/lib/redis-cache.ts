/**
 * In-memory TTL cache for Redis reads.
 *
 * On Vercel serverless each instance lives for a few minutes, so even a
 * short TTL (60-300 s) dramatically cuts Upstash command usage without
 * serving truly stale data.
 *
 * Usage:
 *   const data = await cachedRead('my-key', 120, () => expensiveRedisCall())
 *
 * Write-through: call `invalidate('my-key')` after a write so the next
 * read refetches from Redis.
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

// Periodic cleanup to prevent memory leaks in long-lived processes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let lastCleanup = Date.now()

function maybeCleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  const keysToDelete: string[] = []
  store.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      keysToDelete.push(key)
    }
  })
  keysToDelete.forEach(key => store.delete(key))
}

/**
 * Read-through cache: returns cached value if fresh, otherwise calls `fetcher`
 * and caches the result for `ttlSeconds`.
 */
export async function cachedRead<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  maybeCleanup()

  const now = Date.now()
  const cached = store.get(key) as CacheEntry<T> | undefined
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  const value = await fetcher()
  store.set(key, { value, expiresAt: now + ttlSeconds * 1000 })
  return value
}

/**
 * Invalidate a single cache key (call after writes).
 */
export function invalidate(key: string) {
  store.delete(key)
}

/**
 * Invalidate all keys matching a prefix.
 */
export function invalidatePrefix(prefix: string) {
  const keysToDelete: string[] = []
  store.forEach((_, key) => {
    if (key.startsWith(prefix)) {
      keysToDelete.push(key)
    }
  })
  keysToDelete.forEach(key => store.delete(key))
}

/**
 * Check if Upstash returned a rate-limit error.
 * Returns true if the response indicates we've been throttled.
 */
export function isRateLimitError(response: Response): boolean {
  return response.status === 429
}

/**
 * Check if an error message indicates a rate-limit issue.
 */
export function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('rate') || lower.includes('limit') || lower.includes('too many') || lower.includes('ERR max daily request limit exceeded')
}

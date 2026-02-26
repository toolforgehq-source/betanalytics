/**
 * Simple in-memory rate limiter for API endpoints.
 * Uses a sliding window approach per user ID.
 * 
 * In production on Vercel (serverless), each instance has its own memory,
 * so this is approximate — but still prevents a single user from hammering
 * the API from one edge location.
 */

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

// Cleanup old entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now

  const cutoff = now - windowMs
  const keys = Array.from(store.keys())
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const entry = store.get(key)
    if (!entry) continue
    entry.timestamps = entry.timestamps.filter(t => t > cutoff)
    if (entry.timestamps.length === 0) {
      store.delete(key)
    }
  }
}

/**
 * Check if a request should be rate limited.
 * 
 * @param key - Unique identifier (e.g., user ID or IP)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns { limited: boolean, remaining: number, resetMs: number }
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 30,
  windowMs: number = 60 * 1000
): { limited: boolean; remaining: number; resetMs: number } {
  cleanup(windowMs)

  const now = Date.now()
  const cutoff = now - windowMs

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => t > cutoff)

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0]
    const resetMs = oldestInWindow + windowMs - now
    return {
      limited: true,
      remaining: 0,
      resetMs
    }
  }

  // Allow the request
  entry.timestamps.push(now)
  return {
    limited: false,
    remaining: maxRequests - entry.timestamps.length,
    resetMs: 0
  }
}

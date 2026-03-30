import { sendEmail, isEmailConfigured } from './email'
import { bigEdgeAlertEmail } from './email-templates'
import { db } from '@/db'
import type { RankedBet } from './bet-ranking'

const EDGE_THRESHOLD = 10

const ALERT_SUBSCRIBERS_KEY = 'edge_alert_subscribers'
const ALERT_SENT_PREFIX = 'edge_alert_sent:'

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return { url, token, useRedis: !!(url && token) }
}

async function redisCommand(command: string[]): Promise<unknown> {
  const { url, token } = getRedisConfig()
  if (!url || !token) {
    throw new Error('Redis not configured')
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  })

  if (response.status === 429) {
    console.warn(`[EdgeAlerts] Redis rate-limited on ${command[0]} — returning null`)
    return null
  }

  const data = await response.json()
  if (data.error) {
    const msg = String(data.error).toLowerCase()
    if (msg.includes('rate') || msg.includes('limit') || msg.includes('too many') || msg.includes('max daily')) {
      console.warn(`[EdgeAlerts] Upstash limit hit on ${command[0]}: ${data.error}`)
      return null
    }
    throw new Error(data.error)
  }
  return data.result
}

export async function isUserSubscribedToAlerts(userId: string): Promise<boolean> {
  const { useRedis } = getRedisConfig()
  if (!useRedis) return false

  try {
    const result = await redisCommand(['SISMEMBER', ALERT_SUBSCRIBERS_KEY, userId])
    return result === 1
  } catch (error) {
    console.error('[EdgeAlerts] Error checking subscription:', error)
    return false
  }
}

export async function subscribeToAlerts(userId: string): Promise<boolean> {
  const { useRedis } = getRedisConfig()
  if (!useRedis) return false

  try {
    await redisCommand(['SADD', ALERT_SUBSCRIBERS_KEY, userId])
    console.log(`[EdgeAlerts] User ${userId} subscribed to alerts`)
    return true
  } catch (error) {
    console.error('[EdgeAlerts] Error subscribing:', error)
    return false
  }
}

export async function unsubscribeFromAlerts(userId: string): Promise<boolean> {
  const { useRedis } = getRedisConfig()
  if (!useRedis) return false

  try {
    await redisCommand(['SREM', ALERT_SUBSCRIBERS_KEY, userId])
    console.log(`[EdgeAlerts] User ${userId} unsubscribed from alerts`)
    return true
  } catch (error) {
    console.error('[EdgeAlerts] Error unsubscribing:', error)
    return false
  }
}

export async function getAlertSubscriberIds(): Promise<string[]> {
  const { useRedis } = getRedisConfig()
  if (!useRedis) return []

  try {
    const members = await redisCommand(['SMEMBERS', ALERT_SUBSCRIBERS_KEY]) as string[]
    return members || []
  } catch (error) {
    console.error('[EdgeAlerts] Error getting subscribers:', error)
    return []
  }
}

function getTodayDateKey(): string {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' }).replace(/\//g, '-')
}

async function hasAlertBeenSentToday(): Promise<boolean> {
  const { useRedis } = getRedisConfig()
  if (!useRedis) return false

  try {
    const key = `${ALERT_SENT_PREFIX}${getTodayDateKey()}`
    const result = await redisCommand(['EXISTS', key])
    return result === 1
  } catch (error) {
    console.error('[EdgeAlerts] Error checking sent status:', error)
    return false
  }
}

async function markAlertSentToday(): Promise<void> {
  const { useRedis } = getRedisConfig()
  if (!useRedis) return

  try {
    const key = `${ALERT_SENT_PREFIX}${getTodayDateKey()}`
    // Use SET with EX option (1 command instead of separate SET + EXPIRE = 2 commands)
    await redisCommand(['SET', key, '1', 'EX', `${24 * 60 * 60}`])
  } catch (error) {
    console.error('[EdgeAlerts] Error marking sent:', error)
  }
}

export async function checkAndSendEdgeAlerts(allRankedBets: RankedBet[]): Promise<{ sent: number; skipped: string | null }> {
  if (!isEmailConfigured()) {
    return { sent: 0, skipped: 'email not configured' }
  }

  const bigEdgeBets = allRankedBets.filter(bet => bet.edge >= EDGE_THRESHOLD)
  if (bigEdgeBets.length === 0) {
    return { sent: 0, skipped: 'no bets with edge >= 10%' }
  }

  const alreadySent = await hasAlertBeenSentToday()
  if (alreadySent) {
    return { sent: 0, skipped: 'alert already sent today' }
  }

  const subscriberIds = await getAlertSubscriberIds()
  if (subscriberIds.length === 0) {
    return { sent: 0, skipped: 'no subscribers' }
  }

  const topEdgeBet = bigEdgeBets[0]
  const isHome = topEdgeBet.team === topEdgeBet.homeTeam
  const opponent = isHome ? topEdgeBet.awayTeam : topEdgeBet.homeTeam
  const modelProb = topEdgeBet.eloProbability ?? topEdgeBet.consensusProbability

  let sent = 0
  for (const userId of subscriberIds) {
    try {
      const user = await db.users.findById(userId)
      if (!user) continue

      const sub = await db.subscriptions.findByUserId(userId)
      if (!sub || sub.status !== 'active') continue

      const { subject, html } = bigEdgeAlertEmail(
        user.name,
        topEdgeBet.team,
        opponent,
        topEdgeBet.sportName,
        topEdgeBet.edge,
        modelProb,
        topEdgeBet.impliedProbability,
        topEdgeBet.bestPrice,
        topEdgeBet.bestBook,
        topEdgeBet.commenceTime
      )

      const result = await sendEmail({ to: user.email, subject, html })
      if (result.success) {
        sent++
      }
    } catch (error) {
      console.error(`[EdgeAlerts] Error sending to user ${userId}:`, error)
    }
  }

  if (sent > 0) {
    await markAlertSentToday()
  }

  console.log(`[EdgeAlerts] Sent ${sent} alerts for ${topEdgeBet.team} (+${topEdgeBet.edge.toFixed(1)}% edge)`)
  return { sent, skipped: null }
}

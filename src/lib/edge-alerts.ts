import { sendEmail, isEmailConfigured } from './email'
import { bigEdgeAlertEmail } from './email-templates'
import { db } from '@/db'
import type { RankedBet } from './bet-ranking'
import { kvSet, kvExists, kvSadd, kvSrem, kvSmembers, kvSismember, isDbConfigured } from '@/lib/pg-kv'

const EDGE_THRESHOLD = 10

const ALERT_SUBSCRIBERS_KEY = 'edge_alert_subscribers'
const ALERT_SENT_PREFIX = 'edge_alert_sent:'

export async function isUserSubscribedToAlerts(userId: string): Promise<boolean> {
  if (!isDbConfigured()) return false

  try {
    const result = await kvSismember(ALERT_SUBSCRIBERS_KEY, userId)
    return result
  } catch (error) {
    console.error('[EdgeAlerts] Error checking subscription:', error)
    return false
  }
}

export async function subscribeToAlerts(userId: string): Promise<boolean> {
  if (!isDbConfigured()) return false

  try {
    await kvSadd(ALERT_SUBSCRIBERS_KEY, userId)
    console.log(`[EdgeAlerts] User ${userId} subscribed to alerts`)
    return true
  } catch (error) {
    console.error('[EdgeAlerts] Error subscribing:', error)
    return false
  }
}

export async function unsubscribeFromAlerts(userId: string): Promise<boolean> {
  if (!isDbConfigured()) return false

  try {
    await kvSrem(ALERT_SUBSCRIBERS_KEY, userId)
    console.log(`[EdgeAlerts] User ${userId} unsubscribed from alerts`)
    return true
  } catch (error) {
    console.error('[EdgeAlerts] Error unsubscribing:', error)
    return false
  }
}

export async function getAlertSubscriberIds(): Promise<string[]> {
  if (!isDbConfigured()) return []

  try {
    const members = await kvSmembers(ALERT_SUBSCRIBERS_KEY)
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
  if (!isDbConfigured()) return false

  try {
    const key = `${ALERT_SENT_PREFIX}${getTodayDateKey()}`
    const result = await kvExists(key)
    return result
  } catch (error) {
    console.error('[EdgeAlerts] Error checking sent status:', error)
    return false
  }
}

async function markAlertSentToday(): Promise<void> {
  if (!isDbConfigured()) return

  try {
    const key = `${ALERT_SENT_PREFIX}${getTodayDateKey()}`
    // Use SET with EX option (1 command instead of separate SET + EXPIRE = 2 commands)
    await kvSet(key, '1', 24 * 60 * 60)
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

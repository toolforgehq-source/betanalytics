import { NextResponse } from 'next/server'
import { isEmailConfigured, sendEmail } from '@/lib/email'
import { seasonalNudgeEmail } from '@/lib/email-templates'
import { getAlertSubscriberIds } from '@/lib/edge-alerts'
import { db } from '@/db'

const SPORT_DISPLAY_NAMES: Record<string, string> = {
  'basketball_nba': 'NBA',
  'americanfootball_nfl': 'NFL',
  'icehockey_nhl': 'NHL',
  'baseball_mlb': 'MLB',
  'basketball_ncaab': 'NCAAB',
  'americanfootball_ncaaf': 'NCAAF',
  'soccer_epl': 'Premier League',
  'soccer_spain_la_liga': 'La Liga',
  'soccer_germany_bundesliga': 'Bundesliga',
  'soccer_italy_serie_a': 'Serie A',
  'soccer_france_ligue_one': 'Ligue 1',
  'soccer_usa_mls': 'MLS',
  'soccer_uefa_champs_league': 'Champions League',
}

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
    console.warn(`[SeasonalNudge] Redis rate-limited on ${command[0]} — returning null`)
    return null
  }

  const data = await response.json()
  if (data.error) {
    const msg = String(data.error).toLowerCase()
    if (msg.includes('rate') || msg.includes('limit') || msg.includes('too many') || msg.includes('max daily')) {
      console.warn(`[SeasonalNudge] Upstash limit hit on ${command[0]}: ${data.error}`)
      return null
    }
    throw new Error(data.error)
  }
  return data.result
}

function getWeekKey(weeksAgo: number = 0): string {
  const now = new Date()
  const target = new Date(now.getTime() - weeksAgo * 7 * 24 * 60 * 60 * 1000)
  const year = target.getFullYear()
  const startOfYear = new Date(year, 0, 1)
  const weekNum = Math.ceil(((target.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000) + startOfYear.getDay() + 1) / 7)
  return `active_sports:${year}:w${weekNum}`
}

async function getActiveSportsFromCache(): Promise<Record<string, number>> {
  const { useRedis } = getRedisConfig()
  if (!useRedis) return {}

  try {
    const cacheKey = 'betanalytics:cached_espn_odds'
    const raw = await redisCommand(['GET', cacheKey]) as string | null
    if (!raw) return {}

    const data = JSON.parse(raw)
    const games = data.games || []
    const sportCounts: Record<string, number> = {}

    for (const game of games) {
      const sportKey = game.sport || game.league || 'unknown'
      const displayName = SPORT_DISPLAY_NAMES[sportKey] || game.league || sportKey
      sportCounts[displayName] = (sportCounts[displayName] || 0) + 1
    }

    return sportCounts
  } catch (error) {
    console.error('[SeasonalNudge] Error reading cached odds:', error)
    return {}
  }
}

async function storeThisWeekSports(sportNames: string[]): Promise<void> {
  const { useRedis } = getRedisConfig()
  if (!useRedis || sportNames.length === 0) return

  try {
    const key = getWeekKey(0)
    await redisCommand(['DEL', key])
    if (sportNames.length > 0) {
        await redisCommand(['SADD', key, ...sportNames])
        // Note: SADD doesn't support EX, so EXPIRE is still needed here
        await redisCommand(['EXPIRE', key, `${30 * 24 * 60 * 60}`])
    }
  } catch (error) {
    console.error('[SeasonalNudge] Error storing sports:', error)
  }
}

async function getLastWeekSports(): Promise<string[]> {
  const { useRedis } = getRedisConfig()
  if (!useRedis) return []

  try {
    const key = getWeekKey(1)
    const members = await redisCommand(['SMEMBERS', key]) as string[]
    return members || []
  } catch (error) {
    console.error('[SeasonalNudge] Error reading last week sports:', error)
    return []
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({ message: 'Email not configured - skipping' }, { status: 200 })
  }

  try {
    const currentSportCounts = await getActiveSportsFromCache()
    const currentSportNames = Object.keys(currentSportCounts)

    console.log(`[SeasonalNudge] Active sports this week: ${currentSportNames.join(', ') || 'none'}`)

    await storeThisWeekSports(currentSportNames)

    const lastWeekSports = await getLastWeekSports()
    console.log(`[SeasonalNudge] Active sports last week: ${lastWeekSports.join(', ') || 'none'}`)

    if (lastWeekSports.length === 0) {
      console.log('[SeasonalNudge] No last week data yet - skipping nudge (first run)')
      return NextResponse.json({
        message: 'First run - stored current sports, no comparison available yet',
        currentSports: currentSportNames,
      })
    }

    const endingSports = lastWeekSports.filter(sport => !currentSportNames.includes(sport))

    if (endingSports.length === 0) {
      console.log('[SeasonalNudge] No sports ended - no nudge needed')
      return NextResponse.json({
        message: 'No sport transitions detected',
        currentSports: currentSportNames,
        lastWeekSports,
      })
    }

    console.log(`[SeasonalNudge] Sports winding down: ${endingSports.join(', ')}`)

    const activeSports = currentSportNames
      .map(name => ({ name, gameCount: currentSportCounts[name] || 0 }))
      .sort((a, b) => b.gameCount - a.gameCount)

    const subscriberIds = await getAlertSubscriberIds()
    if (subscriberIds.length === 0) {
      console.log('[SeasonalNudge] No alert subscribers - skipping')
      return NextResponse.json({
        message: 'Sport transition detected but no subscribers',
        endingSports,
        currentSports: currentSportNames,
      })
    }

    let sent = 0
    let errors = 0
    for (const userId of subscriberIds) {
      try {
        const user = await db.users.findById(userId)
        if (!user) continue

        const sub = await db.subscriptions.findByUserId(userId)
        if (!sub || sub.status !== 'active') continue

        const { subject, html } = seasonalNudgeEmail(user.name, endingSports, activeSports)
        const result = await sendEmail({ to: user.email, subject, html })
        if (result.success) {
          sent++
        } else {
          errors++
        }
      } catch (error) {
        console.error(`[SeasonalNudge] Error sending to user ${userId}:`, error)
        errors++
      }
    }

    console.log(`[SeasonalNudge] Sent ${sent} nudges, ${errors} errors`)
    return NextResponse.json({
      message: `Seasonal nudge sent: ${endingSports.join(', ')} winding down`,
      endingSports,
      activeSports: currentSportNames,
      sent,
      errors,
    })
  } catch (error) {
    console.error('[SeasonalNudge] Error:', error)
    return NextResponse.json({ error: 'Failed to process seasonal nudge' }, { status: 500 })
  }
}

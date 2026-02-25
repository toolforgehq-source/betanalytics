/**
 * Cron job: Send alert emails to subscribed users
 * 
 * Runs on a schedule (configured in vercel.json).
 * 
 * Flow:
 * 1. Fetch today's picks from pick-tracking
 * 2. Get all subscribed users from Redis set "alert_subscribers"
 * 3. For each user, load their alert preferences
 * 4. Filter picks by their preferences (sports, bet types, min edge, min probability)
 * 5. Check quiet hours and frequency
 * 6. Send email via Resend with matching picks
 * 7. Track last-sent timestamp to avoid duplicate emails
 */

import { NextResponse } from 'next/server'
import { getAllPicks, type StoredPick } from '@/lib/pick-tracking'
import { sendEmail, isEmailConfigured } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ============================================
// TYPES
// ============================================

interface AlertPreferences {
  emailEnabled: boolean
  pushEnabled: boolean
  email: string
  bestBetOfDay: boolean
  highEdgePicks: boolean
  parlayOfDay: boolean
  topPlayerProps: boolean
  lineMovements: boolean
  minEdge: number
  minProbability: number
  sports: string[]
  betTypes: string[]
  frequency: 'instant' | 'hourly' | 'daily_morning' | 'daily_evening'
  quietHoursStart: string
  quietHoursEnd: string
}

// ============================================
// REDIS HELPERS
// ============================================

async function redisCommand(command: string[]): Promise<unknown> {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  })

  const data = await response.json()
  if (data.error) {
    console.error('[send-alerts redis] Error:', data.error)
    return null
  }
  return data.result
}

// ============================================
// PICK FILTERING
// ============================================

function sportMatchesPrefs(pickSport: string, prefsSports: string[]): boolean {
  if (prefsSports.length === 0) return true // empty = all sports
  const sportUpper = pickSport.toUpperCase()
  return prefsSports.some(s => {
    const su = s.toUpperCase()
    if (su === sportUpper) return true
    // Handle common aliases
    if (su === 'NBA' && sportUpper.includes('NBA')) return true
    if (su === 'NFL' && sportUpper.includes('NFL')) return true
    if (su === 'NHL' && sportUpper.includes('NHL')) return true
    if (su === 'MLB' && sportUpper.includes('MLB')) return true
    if (su === 'NCAAB' && (sportUpper.includes('NCAAB') || sportUpper.includes('COLLEGE BASKETBALL'))) return true
    if (su === 'NCAAF' && (sportUpper.includes('NCAAF') || sportUpper.includes('COLLEGE FOOTBALL'))) return true
    if (su === 'EPL' && (sportUpper.includes('EPL') || sportUpper.includes('PREMIER'))) return true
    return false
  })
}

function betTypeMatchesPrefs(pickBetType: string, prefsBetTypes: string[]): boolean {
  if (prefsBetTypes.length === 0) return true // empty = all bet types
  const bt = pickBetType.toLowerCase()
  return prefsBetTypes.some(t => {
    const tl = t.toLowerCase()
    if (tl === bt) return true
    if (tl === 'player props' && bt === 'prop') return true
    return false
  })
}

function filterPicksForUser(picks: StoredPick[], prefs: AlertPreferences): StoredPick[] {
  return picks.filter(pick => {
    // Filter by sport
    if (!sportMatchesPrefs(pick.sportName || pick.sport, prefs.sports)) return false

    // Filter by bet type
    if (!betTypeMatchesPrefs(pick.betType, prefs.betTypes)) return false

    // Filter by minimum edge
    if (pick.edge < prefs.minEdge) return false

    // Filter by minimum probability (consensusProbability is already 0-100 scale)
    if (pick.consensusProbability < prefs.minProbability) return false

    // Filter by alert type preferences
    if (pick.pickType === 'best_bet' && !prefs.bestBetOfDay) return false
    if (pick.pickType === 'parlay_leg' && !prefs.parlayOfDay) return false
    if (pick.pickType === 'prop' && !prefs.topPlayerProps) return false
    if (pick.pickType === 'game_specific' && !prefs.highEdgePicks) return false

    return true
  })
}

// ============================================
// QUIET HOURS CHECK
// ============================================

function isInQuietHours(prefs: AlertPreferences): boolean {
  const now = new Date()
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const currentMinutes = etNow.getHours() * 60 + etNow.getMinutes()

  const [startH, startM] = prefs.quietHoursStart.split(':').map(Number)
  const [endH, endM] = prefs.quietHoursEnd.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  if (startMinutes <= endMinutes) {
    // Simple range: e.g. 22:00 to 23:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  } else {
    // Wraps midnight: e.g. 23:00 to 07:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
}

// ============================================
// EMAIL TEMPLATE
// ============================================

function buildAlertEmail(picks: StoredPick[], userEmail: string): { subject: string; html: string } {
  const bestBet = picks.find(p => p.pickType === 'best_bet')
  // All picks are rendered in the table; bestBet gets a callout above it

  const subject = bestBet
    ? `BetAnalytics: ${bestBet.team} ${bestBet.betType === 'moneyline' ? 'ML' : bestBet.betType === 'spread' ? bestBet.line! > 0 ? `+${bestBet.line}` : `${bestBet.line}` : bestBet.betType === 'total' ? `${bestBet.team.includes('Over') ? 'O' : 'U'} ${bestBet.line}` : ''} — Best Bet of the Day`
    : `BetAnalytics: ${picks.length} High-Edge Pick${picks.length !== 1 ? 's' : ''} Found`

  // Exclude bestBet from the table rows since it gets its own callout
  const tablePicks = bestBet ? picks.filter(p => p.id !== bestBet.id) : picks
  const pickRows = tablePicks.map(pick => {
    const odds = pick.odds > 0 ? `+${pick.odds}` : `${pick.odds}`
    const edge = pick.edge.toFixed(1)
    const prob = pick.consensusProbability.toFixed(0)
    const betLabel = pick.betType === 'moneyline' ? 'ML'
      : pick.betType === 'spread' ? `${pick.line! > 0 ? '+' : ''}${pick.line}`
      : pick.betType === 'total' ? `${pick.team.includes('Over') ? 'O' : 'U'} ${pick.line}`
      : 'Prop'

    return `
      <tr style="border-bottom: 1px solid #1e293b;">
        <td style="padding: 12px 16px;">
          <div style="font-weight: 600; color: #f1f5f9;">${pick.team}</div>
          <div style="font-size: 12px; color: #94a3b8;">${pick.awayTeam} @ ${pick.homeTeam}</div>
          <div style="font-size: 11px; color: #64748b;">${pick.sportName || pick.sport}</div>
        </td>
        <td style="padding: 12px 16px; text-align: center;">
          <span style="color: #22d3ee; font-weight: 600; font-family: monospace;">${betLabel}</span>
        </td>
        <td style="padding: 12px 16px; text-align: center;">
          <span style="color: #22d3ee; font-weight: 600; font-family: monospace;">${odds}</span>
        </td>
        <td style="padding: 12px 16px; text-align: center;">
          <span style="color: #4ade80; font-weight: 600;">${edge}%</span>
        </td>
        <td style="padding: 12px 16px; text-align: center;">
          <span style="color: #f1f5f9;">${prob}%</span>
        </td>
        <td style="padding: 12px 16px; text-align: center;">
          <span style="font-size: 12px; color: #94a3b8;">${pick.bestBook}</span>
        </td>
      </tr>`
  }).join('')

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #0f172a; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; padding: 24px 16px;">
    
    <!-- Header -->
    <div style="text-align: center; padding: 24px 0; border-bottom: 1px solid #1e293b;">
      <div style="font-size: 24px; font-weight: 700;">
        <span style="background: linear-gradient(to right, #60a5fa, #67e8f9); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">BetAnalytics.ai</span>
      </div>
      <div style="font-size: 13px; color: #64748b; margin-top: 4px;">Elo-Powered Edge Detection</div>
    </div>

    <!-- Best Bet Callout -->
    ${bestBet ? `
    <div style="margin: 24px 0; padding: 20px; background: linear-gradient(135deg, #1e3a5f 0%, #0d2137 100%); border: 1px solid #2563eb40; border-radius: 12px;">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #60a5fa; margin-bottom: 8px;">Best Bet of the Day</div>
      <div style="font-size: 20px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">${bestBet.team}</div>
      <div style="font-size: 14px; color: #94a3b8;">${bestBet.awayTeam} @ ${bestBet.homeTeam} &middot; ${bestBet.sportName || bestBet.sport}</div>
      <div style="display: flex; gap: 24px; margin-top: 16px;">
        <div>
          <div style="font-size: 11px; color: #64748b;">Odds</div>
          <div style="font-size: 18px; font-weight: 600; color: #22d3ee; font-family: monospace;">${bestBet.odds > 0 ? '+' : ''}${bestBet.odds}</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #64748b;">Edge</div>
          <div style="font-size: 18px; font-weight: 600; color: #4ade80;">${bestBet.edge.toFixed(1)}%</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #64748b;">Probability</div>
          <div style="font-size: 18px; font-weight: 600; color: #f1f5f9;">${bestBet.consensusProbability.toFixed(0)}%</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #64748b;">Best Book</div>
          <div style="font-size: 14px; font-weight: 600; color: #f1f5f9;">${bestBet.bestBook}</div>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- All Picks Table -->
    ${picks.length > (bestBet ? 1 : 0) ? `
    <div style="margin: 24px 0;">
      <h2 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #f1f5f9;">
        ${bestBet ? 'Other High-Edge Picks' : 'High-Edge Picks'}
      </h2>
      <table style="width: 100%; border-collapse: collapse; background: #1e293b30; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="border-bottom: 1px solid #334155;">
            <th style="padding: 10px 16px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px;">Pick</th>
            <th style="padding: 10px 16px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">Type</th>
            <th style="padding: 10px 16px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">Odds</th>
            <th style="padding: 10px 16px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">Edge</th>
            <th style="padding: 10px 16px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">Prob</th>
            <th style="padding: 10px 16px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">Book</th>
          </tr>
        </thead>
        <tbody>
          ${pickRows}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- CTA -->
    <div style="text-align: center; margin: 32px 0;">
      <a href="https://betanalytics.ai/chat" style="display: inline-block; padding: 14px 32px; background: linear-gradient(to right, #3b82f6, #22d3ee); color: white; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 15px;">
        Open AI Chat for Full Analysis
      </a>
    </div>

    <!-- Quick Links -->
    <div style="display: flex; gap: 16px; justify-content: center; margin: 24px 0;">
      <a href="https://betanalytics.ai/odds" style="color: #60a5fa; font-size: 13px; text-decoration: none;">Odds Board</a>
      <span style="color: #334155;">|</span>
      <a href="https://betanalytics.ai/performance" style="color: #60a5fa; font-size: 13px; text-decoration: none;">Performance</a>
      <span style="color: #334155;">|</span>
      <a href="https://betanalytics.ai/betslip" style="color: #60a5fa; font-size: 13px; text-decoration: none;">Parlay Builder</a>
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #1e293b; padding-top: 24px; margin-top: 32px; text-align: center;">
      <p style="font-size: 11px; color: #475569; margin: 0 0 8px 0;">
        Sports betting involves risk. Only bet what you can afford to lose.
      </p>
      <p style="font-size: 11px; color: #475569; margin: 0;">
        <a href="https://betanalytics.ai/alerts" style="color: #64748b; text-decoration: underline;">Manage alert preferences</a>
        &nbsp;&middot;&nbsp;
        <a href="https://betanalytics.ai" style="color: #64748b; text-decoration: underline;">betanalytics.ai</a>
      </p>
      <p style="font-size: 10px; color: #334155; margin: 12px 0 0 0;">
        Sent to ${userEmail}
      </p>
    </div>

  </div>
</body>
</html>`

  return { subject, html }
}

// ============================================
// MAIN CRON HANDLER
// ============================================

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { message: 'Email not configured - skipping alert dispatch' },
      { status: 200 }
    )
  }

  try {
    // 1. Get today's picks
    const allPicks = await getAllPicks()
    const now = new Date()
    const todayStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York' })

    const todaysPicks = allPicks.filter((p: StoredPick) => {
      const pickDate = new Date(p.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      return pickDate === todayStr && p.status === 'pending'
    })

    if (todaysPicks.length === 0) {
      return NextResponse.json({
        message: 'No picks today — nothing to alert on',
        picksCount: 0,
        emailsSent: 0,
      })
    }

    // 2. Get all subscribed users from Redis set + SCAN fallback for legacy users
    let subscribers = await redisCommand(['SMEMBERS', 'alert_subscribers']) as string[] | null

    // Fallback: SCAN for alert_prefs:* keys to find users who saved prefs before
    // the alert_subscribers set was introduced. Backfill them into the set.
    if (!subscribers || subscribers.length === 0) {
      const scannedEmails: string[] = []
      let cursor = '0'
      do {
        const result = await redisCommand(['SCAN', cursor, 'MATCH', 'alert_prefs:*', 'COUNT', '100']) as [string, string[]] | null
        if (!result) break
        cursor = result[0]
        for (const key of result[1]) {
          const email = key.replace('alert_prefs:', '')
          scannedEmails.push(email)
          // Backfill into the set for future runs
          await redisCommand(['SADD', 'alert_subscribers', email])
        }
      } while (cursor !== '0')

      if (scannedEmails.length > 0) {
        subscribers = scannedEmails
        console.log(`[send-alerts] Backfilled ${scannedEmails.length} subscribers from SCAN`)
      }
    }

    if (!subscribers || subscribers.length === 0) {
      return NextResponse.json({
        message: 'No subscribers — nothing to send',
        picksCount: todaysPicks.length,
        emailsSent: 0,
      })
    }

    console.log(`[send-alerts] ${todaysPicks.length} picks today, ${subscribers.length} subscribers`)

    // 3. Process each subscriber
    let emailsSent = 0
    let emailsSkipped = 0
    const errors: string[] = []

    for (const email of subscribers) {
      try {
        // Load user preferences
        const prefsRaw = await redisCommand(['GET', `alert_prefs:${email}`]) as string | null
        if (!prefsRaw) {
          emailsSkipped++
          continue
        }

        const prefs: AlertPreferences = JSON.parse(prefsRaw)

        // Skip if email not enabled or no email address
        if (!prefs.emailEnabled) {
          emailsSkipped++
          continue
        }

        const targetEmail = prefs.email || email

        // Check quiet hours
        if (isInQuietHours(prefs)) {
          console.log(`[send-alerts] Skipping ${email} — quiet hours`)
          emailsSkipped++
          continue
        }

        // Check frequency — avoid sending too often
        const lastSentKey = `alert_last_sent:${email}`
        const lastSent = await redisCommand(['GET', lastSentKey]) as string | null
        if (lastSent) {
          const lastSentTime = new Date(lastSent)
          const msSinceLast = now.getTime() - lastSentTime.getTime()
          const hoursSinceLast = msSinceLast / (1000 * 60 * 60)

          if (prefs.frequency === 'hourly' && hoursSinceLast < 1) {
            emailsSkipped++
            continue
          }
          if ((prefs.frequency === 'daily_morning' || prefs.frequency === 'daily_evening') && hoursSinceLast < 20) {
            emailsSkipped++
            continue
          }
          // 'instant' — always send, but minimum 15 min gap to avoid spam
          if (prefs.frequency === 'instant' && msSinceLast < 15 * 60 * 1000) {
            emailsSkipped++
            continue
          }
        }

        // Filter picks by user preferences
        const matchingPicks = filterPicksForUser(todaysPicks, prefs)
        if (matchingPicks.length === 0) {
          emailsSkipped++
          continue
        }

        // Build and send email
        const { subject, html } = buildAlertEmail(matchingPicks, targetEmail)
        const result = await sendEmail({ to: targetEmail, subject, html })

        if (result.success) {
          emailsSent++
          // Record last-sent timestamp (expire after 24h)
          await redisCommand(['SET', lastSentKey, now.toISOString(), 'EX', '86400'])
          console.log(`[send-alerts] Sent to ${targetEmail}: ${matchingPicks.length} picks`)
        } else {
          errors.push(`${email}: ${result.error}`)
        }
      } catch (err) {
        errors.push(`${email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    console.log(`[send-alerts] Done. Sent: ${emailsSent}, Skipped: ${emailsSkipped}, Errors: ${errors.length}`)

    return NextResponse.json({
      message: 'Alert dispatch complete',
      picksCount: todaysPicks.length,
      subscribers: subscribers.length,
      emailsSent,
      emailsSkipped,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('[send-alerts] Error:', error)
    return NextResponse.json(
      { error: 'Failed to dispatch alerts', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

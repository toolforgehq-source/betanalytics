import type { TrackedRecommendation } from './recommendation-tracking'

/** Paper-only bankroll report built from selections frozen before kickoff.
 * Never use revised postgame probabilities or replacement odds in the replay.
 */
export interface BankrollSimulation {
  modelVersion: string
  startingBankroll: number
  endingBankroll: number
  profit: number
  amountStaked: number
  roiPercent: number
  maximumDrawdownPercent: number
  picks: number
  wins: number
  losses: number
  pushes: number
  daysTested: number
  incompleteDays: number
  pricesWithoutInitialSnapshot: number
  insufficientSample: boolean
}

function bettingDayET(value: string): string | null {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const year = Number(part('year')), month = Number(part('month'))
  const day = Number(part('day')), hour = Number(part('hour'))
  if (!year || !month || !day) return null
  const keyDate = new Date(Date.UTC(year, month-1, day - (hour < 2 ? 1 : 0)))
  return keyDate.toISOString().slice(0,10)
}

function netProfit(stake: number, odds: number, status: string): number {
  if (status === 'push') return 0
  if (status === 'lost') return -stake
  return stake * (odds > 0 ? odds / 100 : 100 / Math.abs(odds))
}

function money(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100 }

/** All bets on a day use the same starting balance; profits post after that day.
 * The top three risk 3%, 2%, 1% separately. A day with pending picks is excluded,
 * not incorrectly treated as a winning or losing completed day.
 */
export function simulateRecordedTopThree(
  records: TrackedRecommendation[],
  startingBankroll = 60,
  modelVersion = 'elo-integrity-v2'
): BankrollSimulation {
  const groups = new Map<string, TrackedRecommendation[]>()
  for (const r of records) {
    if (r.modelVersion !== modelVersion || r.source !== 'best_bet' ||
        r.lockedIn !== true ||
        (r.confidenceTier !== 'lock' && r.confidenceTier !== 'strong') ||
        r.status === 'void') continue
    const key = bettingDayET(r.commenceTime)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }
  const stakes = [0.03, 0.02, 0.01]
  let bankroll = startingBankroll, peak = bankroll, maxDrawdown = 0
  let invested = 0, wins = 0, losses = 0, pushes = 0
  let daysTested = 0, incompleteDays = 0, unverifiedPrices = 0
  for (const [,dayPicks] of [...groups.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
    const ranked = [...dayPicks].sort((a,b) => {
      if (a.confidenceTier !== b.confidenceTier) return a.confidenceTier === 'lock' ? -1 : 1
      return (b.score || 0) - (a.score || 0)
    })
    const games = new Set<string>()
    const selected: TrackedRecommendation[] = []
    for (const r of ranked) {
      if (games.has(r.gameId)) continue
      games.add(r.gameId)
      selected.push(r)
      if (selected.length === 3) break
    }
    // Never profit-select by excluding unresolved bets.
    if (selected.some(r => r.status === 'pending' || !['won','lost','push'].includes(r.status))) {
      incompleteDays++
      continue
    }
    let dailyPnL = 0
    selected.forEach((r,i) => {
      const price = r.initialOdds ?? r.odds
      if (!Number.isFinite(price) || price === 0) return
      if (r.initialOdds === undefined) unverifiedPrices++
      const stake = money(bankroll * stakes[i])
      invested += stake
      dailyPnL += netProfit(stake, price, r.status)
      if (r.status === 'won') wins++
      else if (r.status === 'lost') losses++
      else pushes++
    })
    bankroll = money(bankroll + dailyPnL)
    peak = Math.max(peak,bankroll)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak-bankroll)/peak*100)
    daysTested++
  }
  return {
    modelVersion, startingBankroll, endingBankroll: bankroll,
    profit: money(bankroll-startingBankroll), amountStaked: money(invested),
    roiPercent: invested > 0 ? Math.round(((bankroll-startingBankroll)/invested)*10000)/100 : 0,
    maximumDrawdownPercent: money(maxDrawdown),
    picks: wins+losses+pushes, wins, losses, pushes, daysTested,
    incompleteDays, pricesWithoutInitialSnapshot: unverifiedPrices,
    insufficientSample: wins+losses < 500,
  }
}

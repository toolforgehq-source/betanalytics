/**
 * Cron job to settle pending bet recommendations
 * 
 * Runs periodically to check game outcomes and update recommendation status.
 * Uses ESPN API to get final scores and determine winners.
 */

import { NextResponse } from 'next/server'
import { 
  getPendingRecommendations, 
  updateRecommendation, 
  calculateProfit,
  type TrackedRecommendation 
} from '@/lib/recommendation-tracking'
import { regradeIncorrectPushes } from '@/lib/pick-tracking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Minimum hours after game start before attempting settlement
const SETTLEMENT_BUFFER_HOURS = 4

/**
 * Map sport key to ESPN sport/league format
 */
function getESPNSportLeague(sport: string): { espnSport: string; espnLeague: string } {
  let espnSport = 'basketball'
  let espnLeague = 'nba'
  
  if (sport.includes('nfl') || (sport.includes('football') && !sport.includes('ncaa'))) {
    espnSport = 'football'
    espnLeague = 'nfl'
  } else if (sport.includes('ncaaf') || (sport.includes('football') && sport.includes('ncaa'))) {
    espnSport = 'football'
    espnLeague = 'college-football'
  } else if (sport.includes('nhl') || sport.includes('hockey')) {
    espnSport = 'hockey'
    espnLeague = 'nhl'
  } else if (sport.includes('mlb') || sport.includes('baseball')) {
    espnSport = 'baseball'
    espnLeague = 'mlb'
  } else if (sport.includes('ncaab') || (sport.includes('basketball') && sport.includes('ncaa'))) {
    espnSport = 'basketball'
    espnLeague = 'mens-college-basketball'
  } else if (sport.includes('epl') || sport === 'soccer_epl') {
    espnSport = 'soccer'
    espnLeague = 'eng.1'
  } else if (sport.includes('serie_a') || sport === 'soccer_italy_serie_a') {
    espnSport = 'soccer'
    espnLeague = 'ita.1'
  } else if (sport.includes('la_liga') || sport === 'soccer_spain_la_liga') {
    espnSport = 'soccer'
    espnLeague = 'esp.1'
  } else if (sport.includes('bundesliga') || sport === 'soccer_germany_bundesliga') {
    espnSport = 'soccer'
    espnLeague = 'ger.1'
  } else if (sport.includes('ligue_one') || sport === 'soccer_france_ligue_one') {
    espnSport = 'soccer'
    espnLeague = 'fra.1'
  } else if (sport.includes('uefa_champs') || sport === 'soccer_uefa_champs_league') {
    espnSport = 'soccer'
    espnLeague = 'uefa.champions'
  } else if (sport.includes('mls') || sport === 'soccer_usa_mls') {
    espnSport = 'soccer'
    espnLeague = 'usa.1'
  } else if (sport.includes('soccer')) {
    espnSport = 'soccer'
    espnLeague = 'eng.1' // Default to EPL for unknown soccer leagues
  }
  
  return { espnSport, espnLeague }
}

interface GameResult {
  completed: boolean
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  winner: string | null
}

/**
 * Fetch game result from ESPN using the event summary endpoint.
 * This works for past games (not just today's scoreboard).
 */
async function fetchGameResult(sport: string, gameId: string): Promise<GameResult | null> {
  try {
    const { espnSport, espnLeague } = getESPNSportLeague(sport)
    
    // Use the event summary endpoint — works for any game, past or present
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/summary?event=${gameId}`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    })
    
    if (!response.ok) {
      // Fallback: try scoreboard with date range
      return fetchGameResultFromScoreboard(sport, gameId)
    }
    
    const data = await response.json()
    return parseESPNGameResult(data)
  } catch (error) {
    console.error(`[SettleBets] Error fetching game ${gameId}:`, error)
    // Fallback to scoreboard
    return fetchGameResultFromScoreboard(sport, gameId)
  }
}

/**
 * Parse ESPN event summary response into a GameResult
 */
function parseESPNGameResult(data: Record<string, unknown>): GameResult | null {
  try {
    const header = data.header as Record<string, unknown> | undefined
    if (!header) return null
    
    const competitions = header.competitions as Record<string, unknown>[] | undefined
    const competition = competitions?.[0]
    if (!competition) return null
    
    const statusObj = competition.status as Record<string, unknown> | undefined
    const statusType = statusObj?.type as Record<string, unknown> | undefined
    const completed = statusType?.completed === true
    
    const competitors = competition.competitors as Record<string, unknown>[] | undefined
    if (!competitors || competitors.length < 2) return null
    
    const homeCompetitor = competitors.find((c) => c.homeAway === 'home')
    const awayCompetitor = competitors.find((c) => c.homeAway === 'away')
    
    if (!homeCompetitor || !awayCompetitor) return null
    
    const homeTeamObj = homeCompetitor.team as Record<string, unknown> | undefined
    const awayTeamObj = awayCompetitor.team as Record<string, unknown> | undefined
    
    const homeScore = parseInt(String(homeCompetitor.score)) || 0
    const awayScore = parseInt(String(awayCompetitor.score)) || 0
    const homeTeam = String(homeTeamObj?.displayName || homeTeamObj?.name || '')
    const awayTeam = String(awayTeamObj?.displayName || awayTeamObj?.name || '')
    
    let winner: string | null = null
    if (completed) {
      if (homeScore > awayScore) {
        winner = homeTeam
      } else if (awayScore > homeScore) {
        winner = awayTeam
      }
    }
    
    return { completed, homeTeam, awayTeam, homeScore, awayScore, winner }
  } catch (error) {
    console.error('[SettleBets] Error parsing ESPN event data:', error)
    return null
  }
}

/**
 * Fallback: Fetch game result from ESPN scoreboard with date range.
 * Tries multiple days in case the game was in the past.
 */
async function fetchGameResultFromScoreboard(sport: string, gameId: string): Promise<GameResult | null> {
  try {
    const { espnSport, espnLeague } = getESPNSportLeague(sport)
    
    // Try last 7 days of scoreboards to find the game
    for (let daysAgo = 0; daysAgo <= 7; daysAgo++) {
      const date = new Date()
      date.setDate(date.getDate() - daysAgo)
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD
      
      const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/scoreboard?dates=${dateStr}`
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      })
      
      if (!response.ok) continue
      
      const data = await response.json()
      const event = data.events?.find((e: { id: string }) => e.id === gameId)
      
      if (event) {
        const competition = event.competitions?.[0]
        if (!competition) continue
        
        const completed = competition.status?.type?.completed === true
        const homeCompetitor = competition.competitors?.find((c: { homeAway: string }) => c.homeAway === 'home')
        const awayCompetitor = competition.competitors?.find((c: { homeAway: string }) => c.homeAway === 'away')
        
        if (!homeCompetitor || !awayCompetitor) continue
        
        const homeScore = parseInt(homeCompetitor.score) || 0
        const awayScore = parseInt(awayCompetitor.score) || 0
        const homeTeam = homeCompetitor.team?.displayName || ''
        const awayTeam = awayCompetitor.team?.displayName || ''
        
        let winner: string | null = null
        if (completed) {
          if (homeScore > awayScore) winner = homeTeam
          else if (awayScore > homeScore) winner = awayTeam
        }
        
        return { completed, homeTeam, awayTeam, homeScore, awayScore, winner }
      }
    }
    
    return null
  } catch (error) {
    console.error(`[SettleBets] Scoreboard fallback error for ${gameId}:`, error)
    return null
  }
}

/**
 * Fuzzy team name matching — handles "Lakers" matching "Los Angeles Lakers" etc.
 */
function teamsMatch(picked: string, actual: string): boolean {
  const p = picked.toLowerCase().trim()
  const a = actual.toLowerCase().trim()
  
  // Direct match
  if (p === a) return true
  
  // Substring match ("Lakers" in "Los Angeles Lakers")
  if (a.includes(p) || p.includes(a)) return true
  
  // Last-word match ("Lakers" === last word of "Los Angeles Lakers")
  const pWords = p.split(/\s+/)
  const aWords = a.split(/\s+/)
  const pLast = pWords[pWords.length - 1]
  const aLast = aWords[aWords.length - 1]
  if (pLast === aLast && pLast.length > 3) return true
  
  return false
}

/**
 * Settle a moneyline bet
 */
function settleMoneylineBet(reco: TrackedRecommendation, gameResult: GameResult): { status: 'won' | 'lost' | 'push' | 'void'; actualResult: string; profit: number } | null {
  if (!gameResult.completed) return null
  
  // Extract team name from selection (e.g., "Lakers ML" -> "Lakers")
  const selectedTeam = reco.selection.replace(' ML', '').trim()
  
  const actualResult = `${gameResult.awayTeam} ${gameResult.awayScore} @ ${gameResult.homeTeam} ${gameResult.homeScore}`
  
  // Handle draw (no winner)
  if (!gameResult.winner) {
    return { status: 'push', actualResult, profit: 0 }
  }
  
  const won = teamsMatch(selectedTeam, gameResult.winner)
  
  return {
    status: won ? 'won' : 'lost',
    actualResult,
    profit: calculateProfit(reco.odds, won)
  }
}

/**
 * Settle a spread bet
 * Example: "Lakers -3.5" — if Lakers won by 4+, it's a win
 */
function settleSpreadBet(reco: TrackedRecommendation, gameResult: GameResult): { status: 'won' | 'lost' | 'push'; actualResult: string; profit: number } | null {
  if (!gameResult.completed) return null
  if (reco.line === undefined || reco.line === null) return null
  
  // Parse team from selection (e.g., "Lakers -3.5" or "Suns +5.5")
  const selectionClean = reco.selection.replace(/\s*[+-]?\d+\.?\d*\s*$/, '').trim()
  
  const isHome = teamsMatch(selectionClean, gameResult.homeTeam)
  const isAway = teamsMatch(selectionClean, gameResult.awayTeam)
  
  if (!isHome && !isAway) {
    console.log(`[SettleBets] Could not match team "${selectionClean}" to ${gameResult.homeTeam} or ${gameResult.awayTeam}`)
    return null
  }
  
  // Calculate margin from picked team's perspective
  const margin = isHome 
    ? (gameResult.homeScore - gameResult.awayScore) 
    : (gameResult.awayScore - gameResult.homeScore)
  
  // Add spread: e.g., margin=5, spread=-3.5 → adjusted=1.5 → win
  const adjustedMargin = margin + reco.line
  
  const actualResult = `${gameResult.awayTeam} ${gameResult.awayScore} @ ${gameResult.homeTeam} ${gameResult.homeScore} (margin: ${margin > 0 ? '+' : ''}${margin}, line: ${reco.line > 0 ? '+' : ''}${reco.line})`
  
  let status: 'won' | 'lost' | 'push'
  if (adjustedMargin > 0) status = 'won'
  else if (adjustedMargin < 0) status = 'lost'
  else status = 'push'
  
  return {
    status,
    actualResult,
    profit: status === 'push' ? 0 : calculateProfit(reco.odds, status === 'won')
  }
}

/**
 * Settle a total (over/under) bet
 * Example: "Over 220.5" — if total was 225, it's a win
 */
function settleTotalBet(reco: TrackedRecommendation, gameResult: GameResult): { status: 'won' | 'lost' | 'push'; actualResult: string; profit: number } | null {
  if (!gameResult.completed) return null
  if (reco.line === undefined || reco.line === null) return null
  
  const actualTotal = gameResult.homeScore + gameResult.awayScore
  const isOver = reco.selection.toLowerCase().includes('over')
  const isUnder = reco.selection.toLowerCase().includes('under')
  
  if (!isOver && !isUnder) return null
  
  const actualResult = `${gameResult.awayTeam} ${gameResult.awayScore} @ ${gameResult.homeTeam} ${gameResult.homeScore} (total: ${actualTotal}, line: ${reco.line})`
  
  let status: 'won' | 'lost' | 'push'
  if (actualTotal > reco.line) status = isOver ? 'won' : 'lost'
  else if (actualTotal < reco.line) status = isUnder ? 'won' : 'lost'
  else status = 'push'
  
  return {
    status,
    actualResult,
    profit: status === 'push' ? 0 : calculateProfit(reco.odds, status === 'won')
  }
}

/**
 * Map our prop market names to ESPN box score stat keys
 */
function getESPNStatKey(market: string): string | null {
  const mapping: Record<string, string> = {
    'player_points': 'points',
    'player_rebounds': 'rebounds',
    'player_assists': 'assists',
    'player_threes': 'threePointFieldGoalsMade',
    'player_steals': 'steals',
    'player_blocks': 'blocks',
    'player_turnovers': 'turnovers',
  }
  return mapping[market] || null
}

/**
 * Extract a player's stat value from ESPN box score data
 */
function extractPlayerStat(
  boxscorePlayers: Record<string, unknown>[],
  playerName: string,
  statKey: string
): number | null {
  const normalizedTarget = playerName.toLowerCase().trim()
  
  for (const teamData of boxscorePlayers) {
    const statistics = (teamData as Record<string, unknown>).statistics as Record<string, unknown>[] | undefined
    if (!statistics || statistics.length === 0) continue
    
    const statSection = statistics[0]
    const keys = (statSection as Record<string, unknown>).keys as string[] | undefined
    const athletes = (statSection as Record<string, unknown>).athletes as Record<string, unknown>[] | undefined
    
    if (!keys || !athletes) continue
    
    for (const athlete of athletes) {
      const athleteInfo = (athlete as Record<string, unknown>).athlete as Record<string, unknown> | undefined
      if (!athleteInfo) continue
      
      const displayName = String(athleteInfo.displayName || '').toLowerCase().trim()
      const shortName = String(athleteInfo.shortName || '').toLowerCase().trim()
      
      // Match by full name or short name
      if (displayName !== normalizedTarget && !displayName.includes(normalizedTarget) && !normalizedTarget.includes(displayName) && shortName !== normalizedTarget) {
        continue
      }
      
      const stats = (athlete as Record<string, unknown>).stats as string[] | undefined
      if (!stats) continue
      
      // Find the stat index
      const statIndex = keys.findIndex(k => {
        if (statKey === 'threePointFieldGoalsMade') {
          return k.startsWith('threePointFieldGoalsMade')
        }
        return k === statKey
      })
      
      if (statIndex === -1) continue
      
      const rawValue = stats[statIndex]
      
      // Handle composite stats like "3-7" (made-attempted) — extract the made portion
      if (rawValue.includes('-')) {
        return parseInt(rawValue.split('-')[0]) || 0
      }
      
      return parseInt(rawValue) || 0
    }
  }
  
  return null
}

/**
 * Find ESPN event ID by searching scoreboards using team names and game date.
 * Prop bets store Odds API hashes as gameId, not ESPN event IDs.
 * This function searches ESPN scoreboards to find the matching game.
 */
async function findESPNEventId(sport: string, gameName: string, commenceTime: string): Promise<string | null> {
  try {
    const { espnSport, espnLeague } = getESPNSportLeague(sport)
    
    // Parse team names from gameName (format: "Team A @ Team B")
    const parts = gameName.split(/\s+@\s+|\s+vs\.?\s+/i)
    if (parts.length < 2) {
      console.log(`[SettleBets] Cannot parse team names from: ${gameName}`)
      return null
    }
    const team1 = parts[0].trim()
    const team2 = parts[1].trim()
    
    // Search scoreboards around the game date (game day and day before/after for timezone differences)
    const gameDate = new Date(commenceTime)
    const datesToCheck: string[] = []
    for (let offset = -1; offset <= 1; offset++) {
      const d = new Date(gameDate)
      d.setDate(d.getDate() + offset)
      datesToCheck.push(d.toISOString().slice(0, 10).replace(/-/g, ''))
    }
    
    for (const dateStr of datesToCheck) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/scoreboard?dates=${dateStr}`
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      })
      
      if (!response.ok) continue
      
      const data = await response.json()
      const events = data.events as Record<string, unknown>[] | undefined
      if (!events) continue
      
      for (const event of events) {
        const competitions = (event as Record<string, unknown>).competitions as Record<string, unknown>[] | undefined
        const competition = competitions?.[0]
        if (!competition) continue
        
        const competitors = competition.competitors as Record<string, unknown>[] | undefined
        if (!competitors || competitors.length < 2) continue
        
        const homeCompetitor = competitors.find((c) => (c as Record<string, unknown>).homeAway === 'home')
        const awayCompetitor = competitors.find((c) => (c as Record<string, unknown>).homeAway === 'away')
        if (!homeCompetitor || !awayCompetitor) continue
        
        const homeTeamObj = (homeCompetitor as Record<string, unknown>).team as Record<string, unknown> | undefined
        const awayTeamObj = (awayCompetitor as Record<string, unknown>).team as Record<string, unknown> | undefined
        const homeName = String(homeTeamObj?.displayName || homeTeamObj?.name || '')
        const awayName = String(awayTeamObj?.displayName || awayTeamObj?.name || '')
        
        // Match if both teams are found (in either order)
        const matchesTeam1 = teamsMatch(team1, homeName) || teamsMatch(team1, awayName)
        const matchesTeam2 = teamsMatch(team2, homeName) || teamsMatch(team2, awayName)
        
        if (matchesTeam1 && matchesTeam2) {
          const eventId = String((event as Record<string, unknown>).id || '')
          console.log(`[SettleBets] Found ESPN event ${eventId} for "${gameName}" (${homeName} vs ${awayName})`)
          return eventId
        }
      }
    }
    
    console.log(`[SettleBets] Could not find ESPN event for "${gameName}" on dates ${datesToCheck.join(', ')}`)
    return null
  } catch (error) {
    console.error(`[SettleBets] Error finding ESPN event for "${gameName}":`, error)
    return null
  }
}

/**
 * Settle a prop bet using ESPN box score data.
 * Handles both ESPN event IDs (numeric) and Odds API hashes (hex) as gameId.
 */
async function settlePropBet(reco: TrackedRecommendation): Promise<{ status: 'won' | 'lost' | 'push'; actualResult: string; profit: number; actualStat: number } | null> {
  if (!reco.playerName || !reco.market) {
    console.log(`[SettleBets] Prop missing playerName or market: ${reco.selection}`)
    return null
  }
  
  const statKey = getESPNStatKey(reco.market)
  if (!statKey) {
    console.log(`[SettleBets] Unknown prop market: ${reco.market}`)
    return null
  }
  
  try {
    const { espnSport, espnLeague } = getESPNSportLeague(reco.sport)
    
    // Determine ESPN event ID: if gameId looks like an ESPN ID (numeric), use it directly.
    // Otherwise, search scoreboards to find the ESPN event by team names.
    const isESPNId = /^\d+$/.test(reco.gameId)
    let espnEventId = isESPNId ? reco.gameId : null
    
    if (!espnEventId) {
      espnEventId = await findESPNEventId(reco.sport, reco.gameName, reco.commenceTime)
      if (!espnEventId) {
        console.log(`[SettleBets] Could not resolve ESPN event for prop: ${reco.selection} (game: ${reco.gameName})`)
        return null
      }
    }
    
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/summary?event=${espnEventId}`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    })
    
    if (!response.ok) {
      console.log(`[SettleBets] ESPN API error for prop game ${espnEventId}: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    
    // Check if game is completed
    const header = data.header as Record<string, unknown> | undefined
    const competitions = header?.competitions as Record<string, unknown>[] | undefined
    const competition = competitions?.[0]
    const statusObj = competition?.status as Record<string, unknown> | undefined
    const statusType = statusObj?.type as Record<string, unknown> | undefined
    const completed = statusType?.completed === true
    
    if (!completed) {
      return null
    }
    
    // Extract box score
    const boxscore = data.boxscore as Record<string, unknown> | undefined
    const boxscorePlayers = boxscore?.players as Record<string, unknown>[] | undefined
    
    if (!boxscorePlayers || boxscorePlayers.length === 0) {
      console.log(`[SettleBets] No box score data for game ${espnEventId}`)
      return null
    }
    
    const actualStat = extractPlayerStat(boxscorePlayers, reco.playerName, statKey)
    
    if (actualStat === null) {
      console.log(`[SettleBets] Could not find stats for ${reco.playerName} in game ${espnEventId}`)
      return null
    }
    
    if (reco.line === undefined || reco.line === null) {
      console.log(`[SettleBets] No line for prop: ${reco.selection}`)
      return null
    }
    
    const isOver = reco.selection.toLowerCase().includes('over')
    const isUnder = reco.selection.toLowerCase().includes('under')
    
    if (!isOver && !isUnder) {
      console.log(`[SettleBets] Cannot determine over/under from: ${reco.selection}`)
      return null
    }
    
    const statLabel = reco.market.replace('player_', '').replace('threes', '3-pointers')
    const actualResult = `${reco.playerName}: ${actualStat} ${statLabel} (line: ${reco.line})`
    
    let status: 'won' | 'lost' | 'push'
    if (actualStat > reco.line) status = isOver ? 'won' : 'lost'
    else if (actualStat < reco.line) status = isUnder ? 'won' : 'lost'
    else status = 'push'
    
    return {
      status,
      actualResult,
      profit: status === 'push' ? 0 : calculateProfit(reco.odds, status === 'won'),
      actualStat
    }
  } catch (error) {
    console.error(`[SettleBets] Error settling prop ${reco.id}:`, error)
    return null
  }
}

export async function GET(request: Request) {
  const startTime = Date.now()
  
  try {
    const { searchParams } = new URL(request.url)
    const force = searchParams.get('force') === 'true'
    
    console.log('[SettleBets] Starting settlement check...')
    
    const pending = await getPendingRecommendations()
    console.log(`[SettleBets] Found ${pending.length} pending recommendations`)
    
    const now = new Date()
    let settled = 0
    let skipped = 0
    let errors = 0
    const results: { id: string; status: string; selection: string }[] = []
    
    for (const reco of pending) {
      // Check if enough time has passed since game start
      const gameTime = new Date(reco.commenceTime)
      const hoursSinceStart = (now.getTime() - gameTime.getTime()) / (1000 * 60 * 60)
      
      if (!force && hoursSinceStart < SETTLEMENT_BUFFER_HOURS) {
        skipped++
        continue
      }
      
      try {
        if (reco.betType === 'prop') {
          // Prop settlement
          const result = await settlePropBet(reco)
          if (result) {
            const updateSuccess = await updateRecommendation(reco.id, {
              status: result.status,
              settledAt: now.toISOString(),
              actualResult: result.actualResult,
              profit: result.profit,
              actualStat: result.actualStat
            })
            if (updateSuccess) {
              settled++
              results.push({ id: reco.id, status: result.status, selection: reco.selection })
            } else {
              console.error(`[SettleBets] Failed to persist prop settlement for ${reco.id}: ${reco.selection}`)
              errors++
              results.push({ id: reco.id, status: 'write_failed', selection: reco.selection })
            }
          } else {
            skipped++
          }
        } else {
          // Team bet settlement (moneyline, spread, total)
          const gameResult = await fetchGameResult(reco.sport, reco.gameId)
          
          if (!gameResult) {
            console.log(`[SettleBets] Could not fetch result for game ${reco.gameId} (${reco.gameName})`)
            skipped++
            continue
          }
          
          if (!gameResult.completed) {
            skipped++
            continue
          }
          
          // Determine settlement based on bet type
          let result: { status: 'won' | 'lost' | 'push' | 'void'; actualResult: string; profit: number } | null = null
          
          if (reco.betType === 'spread') {
            if (reco.line !== undefined && reco.line !== null) {
              result = settleSpreadBet(reco, gameResult)
            } else {
              // Spread bet with missing line — cannot grade accurately.
              // Previously this fell through to moneyline settlement, producing wrong results.
              console.error(`[SettleBets] Spread bet ${reco.id} missing line — skipping (selection: ${reco.selection})`)
              skipped++
              continue
            }
          } else if (reco.betType === 'total') {
            if (reco.line !== undefined && reco.line !== null) {
              result = settleTotalBet(reco, gameResult)
            } else {
              console.error(`[SettleBets] Total bet ${reco.id} missing line — skipping (selection: ${reco.selection})`)
              skipped++
              continue
            }
          } else {
            // Moneyline settlement
            result = settleMoneylineBet(reco, gameResult)
          }
          
          if (result) {
            const updateSuccess = await updateRecommendation(reco.id, {
              status: result.status,
              settledAt: now.toISOString(),
              actualResult: result.actualResult,
              profit: result.profit
            })
            if (updateSuccess) {
              settled++
              results.push({ id: reco.id, status: result.status, selection: reco.selection })
            } else {
              console.error(`[SettleBets] Failed to persist settlement for ${reco.id}: ${reco.selection}`)
              errors++
              results.push({ id: reco.id, status: 'write_failed', selection: reco.selection })
            }
          } else {
            console.log(`[SettleBets] Could not settle ${reco.id}: ${reco.selection} (betType: ${reco.betType})`)
            skipped++
          }
        }
      } catch (error) {
        console.error(`[SettleBets] Error settling ${reco.id}:`, error)
        errors++
      }
    }
    
    console.log(`[SettleBets] Complete: ${settled} settled, ${skipped} skipped, ${errors} errors`)
    
    // After normal settlement, repair any picks that were incorrectly graded as "push"
    // due to the missing line bug (storePick wasn't passing line field).
    // This recovers lines from recommendations and re-grades with ESPN scores.
    let regradeResult = { repaired: 0, lineRecovered: 0, errors: 0, details: [] as string[] }
    try {
      regradeResult = await regradeIncorrectPushes()
      if (regradeResult.repaired > 0) {
        console.log(`[SettleBets] Re-graded ${regradeResult.repaired} incorrectly pushed picks`)
      }
    } catch (err) {
      console.error('[SettleBets] Re-grade repair failed:', err)
    }
    
    return NextResponse.json({
      success: true,
      pending: pending.length,
      settled,
      skipped,
      errors,
      results,
      regrade: regradeResult.repaired > 0 ? regradeResult : undefined,
      durationMs: Date.now() - startTime
    })
    
  } catch (error) {
    console.error('[SettleBets] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to settle bets',
      details: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}

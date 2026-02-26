import { NextResponse } from "next/server"
import { fetchAllOdds, type Game } from "@/lib/odds"
import { americanToImpliedProbability } from "@/lib/bet-ranking"
import { requireDebugAuth } from "@/lib/debug-auth"

export const dynamic = "force-dynamic"

// Current thresholds
const MIN_PROBABILITY = 0.55      // 55% minimum win probability
const MIN_EDGE = 0.03             // 3% minimum edge
const MAX_JUICE_ODDS = -250       // Don't recommend worse than -250

// Reputable books for consensus calculation
const CONSENSUS_BOOKS = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'PointsBet',
  'BetRivers', 'Unibet', 'Barstool', 'WynnBET', 'SuperBook'
]

interface AnalyzedBet {
  game: string
  sport: string
  team: string
  consensusProbability: number
  bestPrice: number
  bestBook: string
  impliedProbability: number
  edge: number
  score: number
  qualified: boolean
  disqualifyReasons: string[]
  booksUsed: number
}

/**
 * Check if a game has a 3-way market (includes Draw option)
 */
function isThreeWayMarket(game: Game): boolean {
  if (!game.moneylines || game.moneylines.length === 0) return false
  
  for (const ml of game.moneylines) {
    const hasDrawOutcome = ml.outcomes.some(o => 
      o.name.toLowerCase() === 'draw' || 
      o.name.toLowerCase() === 'tie' ||
      o.name.toLowerCase() === 'x'
    )
    if (hasDrawOutcome) return true
    if (ml.outcomes.length > 2) return true
  }
  
  return false
}

/**
 * Remove vig from a two-way market
 */
function removeVig(impliedProb1: number, impliedProb2: number): { prob1: number; prob2: number } {
  const total = impliedProb1 + impliedProb2
  return {
    prob1: impliedProb1 / total,
    prob2: impliedProb2 / total
  }
}

/**
 * Analyze a single team in a game - returns all data even if doesn't qualify
 */
function analyzeTeam(game: Game, team: string): AnalyzedBet | null {
  const disqualifyReasons: string[] = []
  
  // Check for 3-way market
  if (isThreeWayMarket(game)) {
    return null // Skip soccer/3-way markets entirely
  }
  
  const isHomeTeam = team === game.homeTeam
  const opponent = isHomeTeam ? game.awayTeam : game.homeTeam
  
  // Calculate consensus probability
  const bookPrices: { book: string; price: number; impliedProb: number; noVigProb: number }[] = []
  
  for (const ml of game.moneylines) {
    if (!CONSENSUS_BOOKS.includes(ml.bookmaker)) continue
    if (ml.outcomes.length !== 2) continue
    
    const teamOutcome = ml.outcomes.find(o => o.name === team)
    const opponentOutcome = ml.outcomes.find(o => o.name === opponent)
    
    if (!teamOutcome || !opponentOutcome) continue
    
    const teamImplied = americanToImpliedProbability(teamOutcome.price)
    const opponentImplied = americanToImpliedProbability(opponentOutcome.price)
    const noVig = removeVig(teamImplied, opponentImplied)
    
    bookPrices.push({
      book: ml.bookmaker,
      price: teamOutcome.price,
      impliedProb: teamImplied,
      noVigProb: noVig.prob1
    })
  }
  
  if (bookPrices.length < 2) {
    return null // Not enough books
  }
  
  // Calculate median no-vig probability
  const sortedProbs = bookPrices.map(b => b.noVigProb).sort((a, b) => a - b)
  const mid = Math.floor(sortedProbs.length / 2)
  const consensusProb = sortedProbs.length % 2 === 0
    ? (sortedProbs[mid - 1] + sortedProbs[mid]) / 2
    : sortedProbs[mid]
  
  // Find best price
  let bestPrice = -Infinity
  let bestBook = ''
  for (const ml of game.moneylines) {
    const outcome = ml.outcomes.find(o => o.name === team)
    if (outcome && outcome.price > bestPrice) {
      bestPrice = outcome.price
      bestBook = ml.bookmaker
    }
  }
  
  if (bestPrice === -Infinity) return null
  
  const impliedProb = americanToImpliedProbability(bestPrice)
  const edge = consensusProb - impliedProb
  
  // Check qualifications
  let qualified = true
  
  if (consensusProb < MIN_PROBABILITY) {
    disqualifyReasons.push(`Probability ${(consensusProb * 100).toFixed(1)}% < 55% minimum`)
    qualified = false
  }
  
  if (edge < MIN_EDGE) {
    disqualifyReasons.push(`Edge ${(edge * 100).toFixed(1)}% < 3% minimum`)
    qualified = false
  }
  
  if (bestPrice < MAX_JUICE_ODDS) {
    disqualifyReasons.push(`Juice ${bestPrice} worse than -250 maximum`)
    qualified = false
  }
  
  const score = consensusProb * 100 + edge * 10
  
  return {
    game: `${game.awayTeam} @ ${game.homeTeam}`,
    sport: game.sportName,
    team,
    consensusProbability: Math.round(consensusProb * 1000) / 10,
    bestPrice,
    bestBook,
    impliedProbability: Math.round(impliedProb * 1000) / 10,
    edge: Math.round(edge * 1000) / 10,
    score: Math.round(score * 10) / 10,
    qualified,
    disqualifyReasons,
    booksUsed: bookPrices.length
  }
}

export async function GET(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  try {
    // Fetch current odds
    const oddsData = await fetchAllOdds()
    
    // Analyze all games
    const allBets: AnalyzedBet[] = []
    let skippedThreeWay = 0
    let skippedNoOdds = 0
    let skippedPastGames = 0
    
    for (const game of oddsData.games) {
      // Skip games that have already started
      if (new Date(game.commenceTime) < new Date()) {
        skippedPastGames++
        continue
      }
      
      // Skip games without moneylines
      if (!game.moneylines || game.moneylines.length === 0) {
        skippedNoOdds++
        continue
      }
      
      // Check for 3-way market
      if (isThreeWayMarket(game)) {
        skippedThreeWay++
        continue
      }
      
      // Analyze both teams
      for (const team of [game.homeTeam, game.awayTeam]) {
        const analysis = analyzeTeam(game, team)
        if (analysis) {
          allBets.push(analysis)
        }
      }
    }
    
    // Sort by score (desc)
    allBets.sort((a, b) => b.score - a.score)
    
    // Get top 10
    const top10 = allBets.slice(0, 10)
    
    // Count qualified
    const qualifiedCount = allBets.filter(b => b.qualified).length
    
    // Analyze threshold impact
    const wouldQualifyAt53 = allBets.filter(b => 
      b.consensusProbability >= 53 && b.edge >= 2.5 && b.bestPrice >= MAX_JUICE_ODDS
    ).length
    
    const wouldQualifyAt54 = allBets.filter(b => 
      b.consensusProbability >= 54 && b.edge >= 2.5 && b.bestPrice >= MAX_JUICE_ODDS
    ).length
    
    // Find "close misses" - games that barely missed
    const closeMisses = allBets.filter(b => 
      !b.qualified && 
      b.consensusProbability >= 52 && 
      b.edge >= 2
    ).slice(0, 5)
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      currentCriteria: {
        minProbability: "55%",
        minEdge: "3%",
        maxJuice: "-250"
      },
      summary: {
        totalGames: oddsData.games.length,
        gamesAnalyzed: oddsData.games.length - skippedThreeWay - skippedNoOdds - skippedPastGames,
        skippedThreeWayMarkets: skippedThreeWay,
        skippedNoOdds: skippedNoOdds,
        skippedPastGames: skippedPastGames,
        totalBetsAnalyzed: allBets.length,
        qualifiedBets: qualifiedCount
      },
      thresholdAnalysis: {
        currentThresholds: {
          qualified: qualifiedCount,
          description: "55% probability, 3% edge"
        },
        relaxedThresholds: {
          at54_2_5: wouldQualifyAt54,
          at53_2_5: wouldQualifyAt53,
          description: "53-54% probability, 2.5% edge"
        }
      },
      top10Bets: top10.map((bet, i) => ({
        rank: i + 1,
        game: bet.game,
        sport: bet.sport,
        team: bet.team,
        winProbability: `${bet.consensusProbability}%`,
        edge: `${bet.edge}%`,
        bestPrice: bet.bestPrice > 0 ? `+${bet.bestPrice}` : `${bet.bestPrice}`,
        bestBook: bet.bestBook,
        score: bet.score,
        qualified: bet.qualified,
        whyNotQualified: bet.disqualifyReasons.length > 0 ? bet.disqualifyReasons : null,
        booksUsed: bet.booksUsed
      })),
      closeMisses: closeMisses.map(bet => ({
        game: bet.game,
        sport: bet.sport,
        team: bet.team,
        winProbability: `${bet.consensusProbability}%`,
        edge: `${bet.edge}%`,
        whyNotQualified: bet.disqualifyReasons
      })),
      recommendation: qualifiedCount === 0 
        ? closeMisses.length > 3 
          ? "Consider relaxing thresholds to 53% probability and 2.5% edge - several close misses found"
          : "Current thresholds are appropriate - no games are even close to qualifying"
        : `${qualifiedCount} games qualify with current thresholds`
    })
    
  } catch (error) {
    console.error("Debug criteria error:", error)
    return NextResponse.json(
      { error: "Failed to analyze criteria", details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

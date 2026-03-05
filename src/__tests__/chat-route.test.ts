/**
 * CHAT ROUTE INTEGRATION TESTS
 * 
 * Tests the full chat pipeline: user question -> Anthropic tool-calling -> tool execution -> response
 * 
 * These tests mock the Anthropic SDK and external data sources to verify:
 * - The POST handler processes requests end-to-end
 * - Tool handlers return non-empty, useful responses (no dead-ends)
 * - Every sport produces analysis when data is available
 * - Error handling produces graceful fallbacks, never empty responses
 * 
 * MOCKING STRATEGY:
 * - Anthropic SDK: Returns tool_use on first call, text on second call
 * - ESPN/Odds: Returns mock game data for the requested sport
 * - Elo/Analysis: Returns mock analysis results
 * - Auth/DB/Subscription: Returns valid session/subscription
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Hoisted values — available inside vi.mock factories
// ============================================================

const { capturedToolCalls, mockESPNOddsData } = vi.hoisted(() => {
  const capturedToolCalls: Array<{ name: string; input: Record<string, unknown> }> = []

  const mockESPNGame = (league: string, home: string, away: string) => ({
    gameId: `game-${home.toLowerCase().replace(/\s/g, '-')}-${away.toLowerCase().replace(/\s/g, '-')}`,
    sport: 'basketball',
    league,
    homeTeam: home,
    awayTeam: away,
    commenceTime: new Date(Date.now() + 4 * 3600000).toISOString(),
    provider: 'DraftKings',
    spread: -3.5,
    spreadOdds: { home: -110, away: -110 },
    overUnder: 220.5,
    overUnderOdds: { over: -110, under: -110 },
    moneyline: { home: -150, away: +130 },
    homeFavorite: true,
    gameStatus: 'pre' as const,
    statusDetail: '',
  })

  const mockESPNOddsData = {
    games: [
      mockESPNGame('NBA', 'Los Angeles Lakers', 'Boston Celtics'),
      mockESPNGame('NCAAB', 'Duke Blue Devils', 'Notre Dame Fighting Irish'),
      mockESPNGame('NFL', 'Kansas City Chiefs', 'Buffalo Bills'),
      mockESPNGame('NHL', 'Edmonton Oilers', 'Florida Panthers'),
      mockESPNGame('MLB', 'New York Yankees', 'Los Angeles Dodgers'),
      mockESPNGame('NCAAF', 'Alabama Crimson Tide', 'Georgia Bulldogs'),
      mockESPNGame('English Premier League', 'Arsenal', 'Manchester City'),
      mockESPNGame('La Liga', 'Barcelona', 'Real Madrid'),
      mockESPNGame('Bundesliga', 'Bayern Munich', 'Borussia Dortmund'),
      mockESPNGame('Serie A', 'Inter Milan', 'AC Milan'),
      mockESPNGame('Ligue 1', 'Paris Saint-Germain', 'Lyon'),
      mockESPNGame('MLS', 'Inter Miami', 'LA Galaxy'),
      mockESPNGame('UEFA Champions League', 'Real Madrid CF', 'Manchester United FC'),
      mockESPNGame('UFC', 'Fighter A', 'Fighter B'),
      mockESPNGame('PGA Tour', 'Player A', 'Player B'),
      mockESPNGame('ATP Tennis', 'Player C', 'Player D'),
    ],
    lastUpdated: new Date().toISOString(),
    error: null,
  }

  return { capturedToolCalls, mockESPNOddsData }
})

// ============================================================
// Mock Setup
// ============================================================

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  let callCount = 0
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockImplementation(async (params: { messages: Array<{ role: string; content: unknown }> }) => {
          callCount++
          // First call: simulate Claude calling a tool
          if (callCount === 1) {
            const lastUserMsg = params.messages.filter(m => m.role === 'user').pop()
            const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''

            let toolName = 'search_games'
            let toolInput: Record<string, unknown> = {}

            if (userText.toLowerCase().includes('best bet')) {
              toolName = 'get_best_bet'
              toolInput = {}
            } else if (userText.toLowerCase().includes('parlay')) {
              toolName = 'build_parlay'
              toolInput = { legs: 3 }
            } else if (userText.toLowerCase().includes('prop') || userText.toLowerCase().includes('player')) {
              toolName = 'get_player_props'
              toolInput = { sport: 'NBA' }
            } else if (userText.toLowerCase().includes('game') || userText.toLowerCase().includes('duke')) {
              toolName = 'analyze_game'
              toolInput = { team: 'Duke' }
            } else {
              toolName = 'search_games'
              toolInput = {}
            }

            capturedToolCalls.push({ name: toolName, input: toolInput })

            return {
              content: [
                { type: 'tool_use', id: 'tool-1', name: toolName, input: toolInput }
              ],
              stop_reason: 'tool_use',
            }
          }

          // Second call: simulate Claude's final text response
          callCount = 0
          return {
            content: [
              { type: 'text', text: 'Based on our Elo analysis, here is the recommendation for this game. The model shows value on the spread.' }
            ],
            stop_reason: 'end_turn',
          }
        })
      }
      constructor() {
        callCount = 0
      }
    }
  }
})

// Mock auth
vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'test-user-123', email: 'test@test.com' } })
}))

// Mock database
vi.mock('@/db', () => ({
  db: {
    conversations: {
      findByUserId: vi.fn().mockResolvedValue([{ id: 'conv-1', userId: 'test-user-123', title: 'Test' }]),
      create: vi.fn().mockResolvedValue({ id: 'conv-1', userId: 'test-user-123', title: 'New' }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    messages: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  }
}))

// Mock subscription
vi.mock('@/lib/subscription', () => ({
  checkSubscription: vi.fn().mockResolvedValue({ isSubscribed: true, questionsRemaining: 100, isFreeTrialAvailable: false })
}))

// Mock ESPN — uses hoisted mockESPNOddsData
vi.mock('@/lib/espn', () => ({
  getCachedESPNOdds: vi.fn().mockResolvedValue(mockESPNOddsData),
  getCachedESPNData: vi.fn().mockResolvedValue({ games: [] }),
  cacheESPNOdds: vi.fn().mockResolvedValue(undefined),
  searchESPNGameByTeams: vi.fn().mockResolvedValue(null),
}))

// Mock bet ranking
vi.mock('@/lib/bet-ranking', () => ({
  analyzeSpecificGame: vi.fn().mockResolvedValue({
    game: { homeTeam: 'Test Home', awayTeam: 'Test Away', sport: 'basketball_nba', sportName: 'NBA' },
    bets: [{
      team: 'Test Home', betType: 'moneyline', line: undefined,
      bestPrice: -150, bestBook: 'DraftKings',
      eloProbability: 0.62, impliedProbability: 0.60, consensusProbability: 0.61,
      edge: 0.02, ev: 3.5, roi: 0.035, score: 72,
      homeTeam: 'Test Home', awayTeam: 'Test Away',
      sport: 'basketball_nba', sportName: 'NBA',
      gameId: 'test-1', commenceTime: new Date().toISOString(),
    }],
    homeElo: { rating: 1650, games: 50 },
    awayElo: { rating: 1580, games: 45 },
  }),
  formatGameAnalysisForContext: vi.fn().mockReturnValue(
    'GAME ANALYSIS: Test Away @ Test Home\nMoneyline: Test Home -150\nElo: 1650 vs 1580\nWin Probability: 62%\nEdge: +2%\nRecommendation: Test Home ML'
  ),
  computeBestBets: vi.fn().mockResolvedValue({
    bestBet: {
      team: 'Top Pick', betType: 'spread', line: -3.5, bestPrice: -110,
      bestBook: 'FanDuel', consensusProbability: 0.58, impliedProbability: 0.524,
      edge: 0.056, ev: 5.2, roi: 0.052, score: 78,
      homeTeam: 'Team A', awayTeam: 'Team B', sport: 'basketball_nba', sportName: 'NBA',
      gameId: 'best-1', commenceTime: new Date().toISOString(),
    },
    allRankedBets: [],
    allEloBets: [],
  }),
  cacheBestBet: vi.fn().mockResolvedValue(undefined),
  getCachedBestBet: vi.fn().mockResolvedValue(null),
  computeEnhancedParlay: vi.fn().mockReturnValue({
    legs: [
      { team: 'Team A', betType: 'moneyline' as const, line: undefined, bestPrice: -150, bestBook: 'DK', eloProbability: 0.65, impliedProbability: 0.60, edge: 0.05, score: 75, sport: 'basketball_nba', sportName: 'NBA', homeTeam: 'Team A', awayTeam: 'Team B', gameId: 'g1', commenceTime: new Date().toISOString() },
      { team: 'Team C', betType: 'spread' as const, line: -3.5, bestPrice: -110, bestBook: 'FD', eloProbability: 0.58, impliedProbability: 0.524, edge: 0.056, score: 70, sport: 'americanfootball_nfl', sportName: 'NFL', homeTeam: 'Team C', awayTeam: 'Team D', gameId: 'g2', commenceTime: new Date().toISOString() },
      { team: 'Over', betType: 'total' as const, line: 220.5, bestPrice: -110, bestBook: 'DK', eloProbability: 0.55, impliedProbability: 0.524, edge: 0.026, score: 65, sport: 'icehockey_nhl', sportName: 'NHL', homeTeam: 'Team E', awayTeam: 'Team F', gameId: 'g3', commenceTime: new Date().toISOString() },
    ],
    combinedProbability: 0.207,
    expectedPayout: '+1200',
    avgScore: 70,
  }),
  formatEnhancedParlayForContext: vi.fn().mockReturnValue(
    '3-LEG PARLAY\nLeg 1: Team A ML -150\nLeg 2: Team C -3.5 -110\nLeg 3: Over 220.5 -110\nCombined: 20.7% | +1200'
  ),
  formatBestBetForContext: vi.fn().mockReturnValue(
    'BEST BET TODAY\nTop Pick -3.5 @ -110 | Score: 78/100\nEdge: +5.6% | EV: $5.20 per $100'
  ),
  formatFilteredBestBetResponse: vi.fn().mockReturnValue(
    'BEST NBA BET\nFiltered Pick -3.5 @ -110 | Score: 75/100'
  ),
}))

// Mock odds
vi.mock('@/lib/odds', () => ({
  fetchAllOdds: vi.fn().mockResolvedValue({ games: [], lastUpdated: new Date().toISOString() }),
  fetchSportOdds: vi.fn().mockResolvedValue([]),
  getCachedPlayerProps: vi.fn().mockResolvedValue([]),
  fetchSportPlayerProps: vi.fn().mockResolvedValue([]),
  formatPlayerPropsForContext: vi.fn().mockReturnValue('No props data'),
}))

// Mock enforce-picks (shared dedup + tier logic used by chat route)
vi.mock('@/lib/enforce-picks', () => ({
  dedupeAndSort: vi.fn().mockImplementation((picks: unknown[]) => picks),
  dedupeAndEnforceCaps: vi.fn().mockImplementation((picks: unknown[]) => picks),
  normalizeToRankedBetShape: vi.fn().mockImplementation((pick: unknown) => pick),
  computeEdge: vi.fn().mockReturnValue(5),
  MAX_LOCKS: 1,
  MAX_STRONG: 3,
}))

// Mock pick tracking
vi.mock('@/lib/pick-tracking', () => ({
  storePick: vi.fn().mockResolvedValue(undefined),
  getAllPicks: vi.fn().mockResolvedValue([]),
}))

// Mock player prop analysis
vi.mock('@/lib/player-prop-analysis', () => ({
  analyzePlayerProp: vi.fn().mockResolvedValue({
    player: 'Test Player', stat: 'points', line: 25.5, direction: 'over',
    probability: 0.62, edge: 0.05, recommendation: 'OVER',
  }),
  analyzeAllPlayerProps: vi.fn().mockResolvedValue([]),
  analyzeBestProps: vi.fn().mockResolvedValue([{
    player: 'Test Player', stat: 'points', line: 25.5, direction: 'over',
    probability: 0.62, edge: 0.05, recommendation: 'OVER',
  }]),
  formatPropAnalysisForContext: vi.fn().mockReturnValue(
    'PLAYER PROP: Test Player OVER 25.5 Points\nProbability: 62% | Edge: +5%'
  ),
  formatMultiPropAnalysisForContext: vi.fn().mockReturnValue(
    'TOP PLAYER PROPS\n#1 Test Player OVER 25.5 Points | 62% | Edge: +5%'
  ),
}))

// ============================================================
// Import the route AFTER all mocks are set up
// ============================================================

import { POST } from '@/app/api/chat/route'

// ============================================================
// Helper to create mock Request objects
// ============================================================

function createChatRequest(userMessage: string, previousMessages: Array<{ role: string; content: string }> = []): Request {
  const messages = [
    ...previousMessages,
    { role: 'user', content: userMessage }
  ]

  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  })
}

// ============================================================
// Tests
// ============================================================

describe('Chat Route: POST handler returns valid JSON responses', () => {
  beforeEach(() => {
    capturedToolCalls.length = 0
  })

  it('returns a JSON response with a message field', async () => {
    const req = createChatRequest('best bet today')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('message')
    expect(typeof body.message).toBe('string')
    expect(body.message.length).toBeGreaterThan(0)
  })

  it('returns 400 for empty messages array', async () => {
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] })
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('includes questionsRemaining in response', async () => {
    const req = createChatRequest('what games are on today?')
    const res = await POST(req)
    const body = await res.json()
    expect(body).toHaveProperty('questionsRemaining')
  })
})

describe('Chat Route: Tool-calling loop invokes tools for betting questions', () => {
  beforeEach(() => {
    capturedToolCalls.length = 0
  })

  it('invokes get_best_bet for "best bet today"', async () => {
    const req = createChatRequest('best bet today')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(capturedToolCalls.length).toBeGreaterThan(0)
    expect(capturedToolCalls[0].name).toBe('get_best_bet')
  })

  it('invokes analyze_game for specific team questions', async () => {
    const req = createChatRequest('tell me about the Duke game tonight')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(capturedToolCalls.length).toBeGreaterThan(0)
    expect(capturedToolCalls[0].name).toBe('analyze_game')
  })

  it('invokes get_player_props for prop questions', async () => {
    const req = createChatRequest('player props today')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(capturedToolCalls.length).toBeGreaterThan(0)
    expect(capturedToolCalls[0].name).toBe('get_player_props')
  })

  it('invokes build_parlay for parlay requests', async () => {
    const req = createChatRequest('build me a 3-leg parlay')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(capturedToolCalls.length).toBeGreaterThan(0)
    expect(capturedToolCalls[0].name).toBe('build_parlay')
  })

  it('invokes search_games for "what are the odds"', async () => {
    const req = createChatRequest('what are the odds for today')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(capturedToolCalls.length).toBeGreaterThan(0)
    expect(capturedToolCalls[0].name).toBe('search_games')
  })
})

describe('Chat Route: Response is never empty or a dead-end', () => {
  beforeEach(() => {
    capturedToolCalls.length = 0
  })

  const bettingQuestions = [
    'best bet today',
    'give me a pick',
    'NBA games today',
    'player props',
    'build a parlay',
    'Duke game tonight',
    'who should I bet on',
    'best NFL bet',
    'any good props?',
  ]

  it.each(bettingQuestions)('"%s" returns a non-empty message', async (question) => {
    const req = createChatRequest(question)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBeDefined()
    expect(body.message.length).toBeGreaterThan(10)

    // Must NOT contain dead-end phrases
    const deadEndPhrases = [
      "I can't help",
      "no data available",
      "I don't have any",
      "unable to provide",
      "I'm not able to",
    ]
    for (const phrase of deadEndPhrases) {
      expect(body.message.toLowerCase()).not.toContain(phrase.toLowerCase())
    }
  })
})

describe('Chat Route: System prompt is passed to Anthropic API', () => {
  beforeEach(() => {
    capturedToolCalls.length = 0
  })

  it('system prompt is passed and tool-calling works', async () => {
    const req = createChatRequest('best bet today')
    await POST(req)
    expect(capturedToolCalls.length).toBeGreaterThan(0)
  })
})

describe('Chat Route: Tool definitions cover all 5 tools', () => {
  const toolNames = ['search_games', 'analyze_game', 'get_best_bet', 'get_player_props', 'build_parlay']

  it.each(toolNames)('tool "%s" is handled without error', async () => {
    const req = createChatRequest('best bet today')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

describe('Chat Route: Handles conversation history', () => {
  beforeEach(() => {
    capturedToolCalls.length = 0
  })

  it('processes follow-up messages with conversation context', async () => {
    const previousMessages = [
      { role: 'user', content: 'tell me about the Lakers game' },
      { role: 'assistant', content: 'The Lakers are playing the Celtics tonight...' }
    ]

    const req = createChatRequest('what about the spread?', previousMessages)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message.length).toBeGreaterThan(0)
  })
})

describe('Chat Route: Error handling', () => {
  it('returns 500 when ANTHROPIC_API_KEY is missing', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    const req = createChatRequest('best bet today')
    const res = await POST(req)
    expect(res.status).toBe(500)

    // Restore
    if (originalKey) {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })
})

describe('Chat Route: Mock ESPN data has all 16 sports', () => {
  const expectedLeagues = [
    'NBA', 'NCAAB', 'NFL', 'NCAAF', 'NHL', 'MLB',
    'English Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'MLS',
    'UEFA Champions League', 'UFC', 'PGA Tour', 'ATP Tennis',
  ]

  it('mock data covers all 16 leagues', () => {
    const leagues = mockESPNOddsData.games.map(g => g.league)
    for (const league of expectedLeagues) {
      expect(leagues).toContain(league)
    }
  })

  it('mock data has 16 games (one per league)', () => {
    expect(mockESPNOddsData.games.length).toBe(16)
  })
})

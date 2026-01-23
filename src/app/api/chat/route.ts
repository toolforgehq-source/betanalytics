import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"
import { db } from "@/db"
import { checkSubscription } from "@/lib/subscription"
import { formatCombinedDataForContext } from "@/lib/combined-data"
import { getCachedESPNOdds } from "@/lib/espn"
import { analyzeSpecificGame, formatGameAnalysisForContext, getCachedSportBets, getFilteredBestBetWithElo, formatFilteredBestBetResponse, getCachedBestBet, formatBestBetForContext, getCachedParlay, formatParlayForContext } from "@/lib/bet-ranking"
import type { Game } from "@/lib/odds"

const SYSTEM_PROMPT = `You are an expert AI sports betting analyst for Betanalytics.ai. Your goal is to help users WIN BETS - not just find mathematical edge.

═══════════════════════════════════════════════════════════
UNIVERSAL RECOMMENDATION RULE (MOST IMPORTANT)
═══════════════════════════════════════════════════════════

You MUST ALWAYS provide a recommendation when asked for betting advice.

NEVER say:
❌ "No good bets today, don't bet"
❌ "Nothing meets criteria, pass"
❌ "I can't recommend anything"
❌ "Which sport do you prefer?" (don't ask follow-up questions)

ALWAYS say:
✅ "Here's the best option available"
✅ "This is the best bet for [specific game/sport/type]"
✅ "This is the top-ranked option from analysis"

QUALITY TIERS (use these labels):

⭐ TIER 1 - RECOMMENDED:
- Meets all criteria (55%+ probability, 3%+ edge, positive EV, 1%+ ROI)
- High confidence
- Label: "RECOMMENDED BET"

🎯 TIER 2 - BEST AVAILABLE:
- Doesn't meet all criteria
- But best option from available games
- Minimal negative EV (under -2%)
- Label: "BEST AVAILABLE (does not meet strict criteria)"

⚠️ TIER 3 - CAUTION:
- Moderate negative EV (-2% to -4%)
- Still better than alternatives
- Label: "CAUTION: Moderate risk"

❌ TIER 4 - HIGH RISK:
- High negative EV (over -4%)
- Only show if specifically asked or no other options
- Label: "HIGH RISK: Significant negative EV"

KEY PRINCIPLE: Users pay $29/month for recommendations. ALWAYS give them actionable information.

═══════════════════════════════════════════════════════════

CRITICAL: You have access to REAL-TIME sports data from SEVEN sources:
1. ESPN API (FREE) - Primary source for betting odds (spreads, totals, moneylines)
2. The Odds API (FALLBACK) - Used when ESPN doesn't have odds for a sport
3. ESPN API - Current injuries, starting lineups, team records, roster information
4. Player Props - Individual player betting lines for NBA, NFL, NHL, NCAAF, NCAAB
5. Weather Data - Conditions for outdoor games (NFL, MLB, MLS, soccer)
6. Soccer Standings - League tables and team form for EPL, La Liga, Bundesliga, Serie A, Ligue 1
7. PRE-COMPUTED BEST BET - Best bet calculated using our ELO RATING MODEL when available, falling back to market consensus (see below)
8. ELO RATING SYSTEM - Our proprietary team rating model that predicts win probabilities based on historical performance

═══════════════════════════════════════════════════════════
CRITICAL: NEVER INVENT OR GUESS ODDS
═══════════════════════════════════════════════════════════

ONLY cite exact lines/odds that appear in the provided context data below.

If a game shows "ODDS UNAVAILABLE" in the data:
- Do NOT guess or invent a spread, moneyline, or total
- Say "Odds are not currently available for this game"
- Ask the user to provide the current line if they want analysis
- Or recommend a different game that HAS odds data

NEVER make up plausible-sounding odds like "+105" or "-3.5" if they're not in the data.
Users trust you to give them REAL odds - inventing numbers destroys that trust.

=== BEST BET INSTRUCTIONS ===

IMPORTANT: When user asks for "best bet", use the PRE-COMPUTED BEST BET from the data below.

The best bet is calculated using the UNIFIED SCORING SYSTEM (45/35/20 weights):
1. Get win probability from ELO MODEL (when available and confident) or market consensus (fallback)
2. Find the best available price across all books
3. Calculate edge: MODEL probability - implied probability from best price
4. Apply HARD FILTERS: odds -250 limit, 52% probability floor, -4.5% ROI floor
5. Calculate SCORE using: Probability (45 pts) + ROI (35 pts) + Edge (20 pts)
6. Rank by SCORE (highest first)

ELO MODEL NOTES:
- When "ELO MODEL PREDICTION" section appears in the data, our Elo model is driving the recommendation
- Elo confidence levels: high (20+ games), medium (10-19 games), low (5-9 games), very_low (<5 games)
- For very_low confidence, we fall back to market consensus
- Always mention the model source (Elo or Market) when explaining recommendations

SCORE BREAKDOWN (always show this in your response):
- Probability Score: ((Win Prob - 50) / 40) × 45 points (max 45)
- ROI Score: 17.5 + (ROI / 20) × 17.5 for positive ROI (max 35, can go negative for bad ROI)
- Edge Score: (Edge / 10) × 20 points (max 20, can go negative)

VALUE PLAY EXCEPTION: Bets with +5% ROI can have probability as low as 48%

DO NOT pick a different game than the pre-computed best bet.
Your job is to EXPLAIN why the pre-computed best bet has the highest SCORE.

If no pre-computed best bet is available, use the PROGRESSIVE FALLBACK data.

═══════════════════════════════════════════════════════════
DATA GROUNDING RULES (CRITICAL)
═══════════════════════════════════════════════════════════

When explaining WHY a bet is recommended, ONLY cite factors that are PRESENT in the provided data:

ALLOWED (if present in data):
- Team records (e.g., "Lakers are 15-8 this season")
- Injuries (e.g., "Key player X is OUT")
- Weather conditions (e.g., "Wind 15mph may affect passing")
- Starting pitchers/goalies (e.g., "Ace pitcher starting")
- League standings/form (e.g., "3rd place in EPL")
- Line movement (e.g., "Line moved from -3 to -5")

NEVER INVENT:
- Historical head-to-head records (unless in data)
- Player stats not in the data
- "Momentum" or "hot streaks" not supported by data
- Coaching matchups or tendencies
- Travel fatigue or schedule spots

If the data doesn't provide context factors, focus on the SCORE and VALUE METRICS.
Say: "Based on the scoring system, this has the best combination of probability and value."

=== RESPONSE TEMPLATES FOR ALL QUERY TYPES ===

CRITICAL: ALWAYS give a recommendation. Use the appropriate template based on query type.

═══════════════════════════════════════════════════════════
TEMPLATE 1: GENERAL "BEST BET" QUERY
═══════════════════════════════════════════════════════════

User asks: "What's the best bet today?" / "Best bet?" / "Give me a pick"

Response format (IMPORTANT: Follow this exact order):

## 🎯 BEST BET TODAY

**[Team] [Line] @ [Odds]** | Score: [X]/100 | [TIER LABEL]

**THE EDGE (Why This Has Value):**
- Our Elo Model: [X]% win probability
- Market Odds: [Y]% implied probability
- EDGE FOUND: +[Z]% (Market is undervaluing this team)

**MATCHUP ANALYSIS:**
- [Home Team] (Elo: [X]) vs [Away Team] (Elo: [Y])
- Elo Difference: [Z] points
- Elo Confidence: [high/medium/low] (based on [N] games of data)
- [2-3 sentences explaining why this team has the edge]

**VALUE METRICS:**
- Win Probability: [X]% (Elo Model)
- Expected Value: $[Y] per $100 bet
- ROI: [Z]%
- Edge: [W]%

**SCORE BREAKDOWN:**
- Probability Score: [X]/45 points
- ROI Score: [Y]/35 points
- Edge Score: [Z]/20 points

[If Tier 2+: "⚠️ Note: This doesn't meet our strict value criteria but is the best available option today."]

**Alternative options:**
#2: [Second best option with brief stats]
#3: [Third best option with brief stats]

═══════════════════════════════════════════════════════════
TEMPLATE 2: SPECIFIC GAME QUERY
═══════════════════════════════════════════════════════════

User asks: "Should I bet on Lakers vs Kings?" / "Patriots game analysis" / "Bills Broncos game"

CRITICAL RULE: When answering a specific-game query, you MUST:
1. Only recommend bets involving the EXACT teams the user asked about
2. NEVER mention teams from other games or from the "BEST BET OF THE DAY" section
3. Put the pick at the VERY TOP of your response

Response format (IMPORTANT: Follow this exact order - PICK FIRST):

## 🎯 [AWAY] @ [HOME]

**Pick: [Team] [Line] @ [Odds]**

**Game Time:** [Time] | **Status:** [SCHEDULED/IN PROGRESS]

**Weather:** [If outdoor game, include temp, conditions, wind]

**THE EDGE (Why This Bet Has Value):**
- Our Elo Model: [X]% probability for [Team] (use "win probability" for ML, "cover probability" for spread, "probability total goes Over/Under" for totals)
- Market Odds: [Y]% implied probability
- EDGE: +[Z]%

**MATCHUP ANALYSIS:**
- Records: [Away Team] (X-Y) vs [Home Team] (X-Y)
- Injuries: [Key injuries for BOTH teams]
- [2-3 sentences on who you think wins and why]

**VALUE METRICS:**
- Probability: [X]%
- Expected Value: $[Y] per $100 bet
- ROI: [Z]%

**Other options for this game:**
- Spread: [Team] [Line] @ [Odds]
- Total: Over/Under [Line] @ [Odds]
- Moneyline: [Team] @ [Odds]

[If all options are -EV: "All bets on this game have negative EV. The above is the least risky option."]

═══════════════════════════════════════════════════════════
TEMPLATE 3: PARLAY REQUEST
═══════════════════════════════════════════════════════════

User asks: "Give me a 3-leg parlay" / "Build me a parlay"

Response format:

## 🎲 BEST [X]-LEG PARLAY

**LEG 1:** [Game 1 bet] | Win Prob: [X]%
[Brief analysis]

**LEG 2:** [Game 2 bet] | Win Prob: [Y]%
[Brief analysis]

**LEG 3:** [Game 3 bet] | Win Prob: [Z]%
[Brief analysis]

**COMBINED:**
- Win Probability: [X]% × [Y]% × [Z]% = [XX]%
- Expected Payout: [odds]
- Status: [TIER LABEL]

⚠️ **PARLAY WARNING:**
All legs must hit. This is entertainment betting, not value betting.
For profit, bet these individually.

═══════════════════════════════════════════════════════════
TEMPLATE 4: PLAYER PROPS REQUEST
═══════════════════════════════════════════════════════════

User asks: "Best player props tonight?" / "Props for NBA?" / "Player prop parlay?"

CRITICAL: Use the PRE-COMPUTED BEST PROP data provided below. Our player stats model tracks historical performance across ALL sports (NBA, NHL, NFL, etc.) and ranks props by model probability and edge.

DO NOT default to NBA-only. Show the TOP props by model edge/probability REGARDLESS OF SPORT. If user asks for a specific sport, filter to that sport only.

Response format:

## 🎯 TOP PLAYER PROPS TONIGHT

**#1 [Player] [Sport] OVER/UNDER [stat] [line]** | [TIER LABEL]
- Model Probability: [X]% (based on [N] games)
- Edge: [Y]%
- Analysis: [Recent performance, matchup]

**#2 [Player] [Sport] OVER/UNDER [stat] [line]**
- Model Probability: [X]%
- Edge: [Y]%
- Analysis: [Brief]

**#3 [Player] [Sport] OVER/UNDER [stat] [line]**
- Model Probability: [X]%
- Edge: [Y]%
- Analysis: [Brief]

[If all -EV: "These are ranked best to worst. #1 is closest to break-even."]

═══════════════════════════════════════════════════════════
TEMPLATE 5: SPORT-SPECIFIC REQUEST
═══════════════════════════════════════════════════════════

User asks: "Best NBA bet?" / "NFL picks?" / "NHL tonight?"

Response format (IMPORTANT: Follow this exact order):

## 🏀 BEST [SPORT] BET TONIGHT

**[Team] [Line] @ [Odds]** | Score: [X]/100 | [TIER LABEL]

**THE EDGE (Why This Has Value):**
- Our Elo Model: [X]% win probability
- Market Odds: [Y]% implied probability
- EDGE: +[Z]% (Market is undervaluing this team)

**MATCHUP ANALYSIS:**
- [Home Team] (Elo: [X]) vs [Away Team] (Elo: [Y])
- Elo Difference: [Z] points
- [Brief explanation of why this team has the edge]

**VALUE METRICS:**
- Win Probability: [X]% (Elo Model)
- Expected Value: $[Y] per $100 bet
- ROI: [Z]%

**Other [SPORT] options tonight:**
#2: [Second best]
#3: [Third best]

═══════════════════════════════════════════════════════════
TEMPLATE 6: DFS PLATFORMS (PrizePicks, Underdog, Sleeper)
═══════════════════════════════════════════════════════════

User asks: "PrizePicks lineup?" / "Underdog picks?" / "Player prop parlay?"

CRITICAL: Use the PRE-COMPUTED BEST PROP data provided below. Our player stats model tracks historical performance across ALL sports (NBA, NHL, NFL, etc.) and ranks props by model probability and edge.

DO NOT default to NBA-only. Pick the TOP 3 props by model edge/probability REGARDLESS OF SPORT. If NHL props have better edge than NBA props, include NHL. Mix sports for the best value.

Response format:

## 🎯 [PLATFORM] LINEUP ([X] LEGS)

**DISCLAIMER:** Lines from sportsbooks - confirm in app before submitting.

**LEG 1:** [Player] [Sport] OVER/UNDER [stat] [line]
- Model Probability: [X]% (based on [N] games)
- Edge: [Y]%
- Analysis: [Brief]

**LEG 2:** [Same format - can be different sport]

**LEG 3:** [Same format - can be different sport]

**COMBINED PROBABILITY:** [XX]%
**STATUS:** [TIER LABEL]

⚠️ Check lineups 1hr before games

═══════════════════════════════════════════════════════════
FALLBACK RULES (When No Strict Value Bets Exist)
═══════════════════════════════════════════════════════════

When no games meet strict criteria, the system uses PROGRESSIVE FALLBACK:
1. Attempt 1: Standard filters (odds -250, prob 52%, ROI -4.5%)
2. Attempt 2: Relax ROI to -6%
3. Attempt 3: Relax ROI to -8%
4. Attempt 4: Relax odds to -300
5. Attempt 5: Relax prob to 50%
6. Final: "No recommended bets today"

IMPORTANT: When recommending fallback bets:
1. Use the HIGHEST SCORED bet from the fallback data (already sorted by score)
2. NEVER recommend odds worse than -300 (hard limit)
3. Show the SCORE and explain why it ranks highest
4. Be honest about negative EV but still provide the recommendation
5. If it's a VALUE PLAY (48%+ prob, 5%+ ROI), label it as such

NEVER refuse to recommend - the fallback data always provides the best available option.

---

=== RECOMMENDATION PHILOSOPHY ===

CRITICAL: When user asks for "best bet", they want the bet with BEST VALUE, not just highest probability!

A bet with 89% probability at -800 odds is TERRIBLE because:
- Risk $800 to win $100
- EV = (0.89 × $12.50) - (0.11 × $100) = +$0.13 per $100 bet
- ROI = 0.13% - AWFUL value!

PRIMARY RECOMMENDATION CRITERIA (ALL must be met):
1. Estimated win probability MUST be 55% or higher
2. Edge must be 3% or higher
3. Expected Value (EV) MUST be positive
4. ROI MUST be 1% or higher (to avoid tiny-edge heavy favorites)
5. Use the PRE-COMPUTED BEST BET which already meets these criteria

RANKING PRIORITY:
1. FIRST: Score (based on ROI + probability + edge)
2. SECOND: Expected Value (EV)
3. THIRD: Win probability

EXAMPLE DECISION:
Option A: 89% probability, 0.1% edge, -800 odds, EV: +$0.13, ROI: 0.13%
Option B: 58% probability, 5% edge, -140 odds, EV: +$5.20, ROI: 5.2%
RECOMMEND: Option B - Much better VALUE ($5.20 vs $0.13 per $100 bet)

NEVER recommend bets with:
- Negative EV (you lose money on average)
- ROI < 1% (tiny edge on heavy favorite - not worth the risk)

=== CONFIDENCE THRESHOLDS ===

HIGH CONFIDENCE (60%+ probability):
- "This is the most confident pick today"
- Default recommendation for "best bet"

MEDIUM CONFIDENCE (55-59% probability):
- "Good probability with decent value"
- Acceptable for "best bet"

VALUE PLAY (50-54% probability):
- "Positive EV but close to coin flip"
- Only show as secondary option, never primary

LONG SHOT (<50% probability):
- "Only bet if you understand +EV betting"
- NEVER the primary "best bet" recommendation

=== RESPONSE FORMAT FOR "BEST BET" REQUESTS ===

## 🎯 BEST BET (Best Value)

**[Team] [Line] @ [Odds]** | Score: [X]/100

**VALUE METRICS:**
- Expected Value: **$[X] per $100 bet**
- ROI: **[Y]%**
- Win Probability: [Z]%
- Edge: [W]%

📊 **Line Movement:** [Opening line] -> [Current line] ([X-point move toward/away from team] - [sharp/public action])
If no opening data: "Opening line data building - next snapshot at [time]"

**Value Calculation:**
- Implied probability from odds: [Y]%
- Our estimated probability: [X]%
- Edge: [X]% - [Y]% = [Z]%
- EV = (Win Prob × Payout) - (Loss Prob × Stake)
- EV = ([X]% × $[payout]) - ([Y]% × $100) = **$[Z]**

**Why This Has Value:**
1. [Specific factor with data citation]
2. [Specific factor with data citation]
3. [Specific factor with data citation]

**Expected Outcome:** [Brief prediction]

---

## 💎 VALUE PLAY (Alternative Option) - OPTIONAL

**[Team] [Line] @ [Odds]**

Win Probability: [X]%
Edge: [Y]%

[If probability >= 55%]: "Lower win probability than the primary pick ([X]% vs [primary]%), but higher edge."
[If probability 50-54%]: "Close to a coin flip - only for bettors who understand variance."
[If probability < 50%]: "More likely to LOSE than win - only for experienced +EV bettors with large bankrolls."

---

## 🔒 LOCK PICK (Highest Probability) - OPTIONAL

**[Team] [Line] @ [Odds]**

Win Probability: [X]%+ 
Edge: [Y]%

Most confident pick, though odds may not be as generous.

---

=== SPECIFIC GAME ANALYSIS (CRITICAL - READ CAREFULLY) ===

WHEN USER ASKS ABOUT A SPECIFIC GAME (e.g., "Patriots game", "Lakers vs Celtics", "Bills Broncos"):

⚠️ CRITICAL RULES FOR SPECIFIC GAME QUERIES:
1. ONLY recommend bets involving the EXACT teams the user asked about
2. NEVER mention teams from other games or from the "BEST BET OF THE DAY" section
3. PUT THE PICK AT THE VERY TOP - before any analysis
4. The team in your pick MUST be one of the two teams in the game header

**RESPONSE FORMAT (PICK FIRST, THEN ANALYSIS):**

## 🎯 [Away] @ [Home]

**Pick: [Team] [Line] @ [Odds]**

**Game Time:** [Time] | **Status:** [SCHEDULED/IN PROGRESS]

**Weather:** [If outdoor game - temp, conditions, wind]

**THE EDGE:**
- Our Model: [X]% probability (use correct label: "win probability" for ML, "cover probability" for spread, "probability total goes Over/Under" for totals)
- Market: [Y]% implied
- Edge: +[Z]%

**MATCHUP ANALYSIS:**
- Records: [Away Team] (X-Y) vs [Home Team] (X-Y)
- Injuries: [Key injuries for BOTH teams from ESPN data]
- [2-3 sentences on who you think wins and why]

**RECOMMENDATION:**
- Why: [Explain why this bet aligns with your analysis]
- Risk: [What could go wrong]

**Other options for this game:**
- Spread: [Option]
- Total: [Option]
- Moneyline: [Option]

---

=== CRITICAL BETTING RULES ===

1. ANALYZE FIRST, RECOMMEND SECOND - Never recommend a bet without first analyzing the game
2. YOUR RECOMMENDATION MUST MATCH YOUR ANALYSIS - If you think Team A wins, recommend Team A
3. PAYOUT DOES NOT EQUAL VALUE - A +500 underdog is NOT a good bet if they're going to lose
4. NEVER recommend an underdog just because the payout is attractive
5. If you think the favorite will win, recommend the favorite (even if the odds aren't exciting)
6. Be honest about uncertainty - if it's a close game, say so
7. Check injury data before every recommendation
8. For props, verify player has props listed (confirms they're expected to play)
9. NEVER guarantee wins - even 70% favorites lose 30% of the time

=== WHEN NO CLEAR EDGE EXISTS ===

If after analysis you don't have a strong opinion:
- Say "This is a close game with no clear edge"
- Offer an "ACTION PICK" (not "best value") for users who want to bet anyway
- The action pick should be the safest option (highest probability, reasonable juice)
- Be clear this is for entertainment, not because you found value

⚠️ ABSOLUTE PLAYER/ROSTER RULES:
8. ONLY mention players whose names appear in the ESPN ROSTER DATA or PLAYER PROPS provided
9. NEVER use training data to cite player names, stats, or coaching staff
10. If a player's name is NOT in the data, DO NOT mention them by name
11. Focus on TEAM-LEVEL factors when roster data is incomplete

=== LINE MOVEMENT INTERPRETATION ===
- Line moved toward a team = Sharp money on that team (increases confidence)
- Reverse line movement = Strong sharp indicator
- Large move (>1.5 points) = Significant information in market
- No movement = Line is efficient

=== WEATHER IMPACT ===
- Wind >15mph: Affects passing games, reduces totals
- Temperature <32F: Scoring typically decreases
- Rain/Snow: Favors running games
- Dome games: Weather irrelevant

=== BETTING EDUCATION (include when showing value plays) ===

There are two ways to bet profitably:

1. HIGH PROBABILITY BETS (55-65% win rate)
   - Win most bets
   - Lower odds (less profit per win)
   - Better user experience
   - Recommended for most users

2. VALUE BETS (45-50% win rate)
   - Lose most bets
   - Higher odds (more profit per win)
   - Requires large bankroll and patience
   - Only for experienced bettors

We focus on #1 for "best bet" recommendations.

You can handle: Game picks, parlays, player props, hedge calculations, arbitrage opportunities, and general betting education.

Always be helpful, educational, and emphasize responsible gambling.

=== DFS PICK'EM PLATFORMS (PrizePicks, Underdog, Sleeper) ===

IMPORTANT: When users ask for picks on DFS platforms like PrizePicks, Underdog Fantasy, or Sleeper Picks, you CAN help them!

We have REAL player prop data from sportsbooks (see PLAYER PROPS section below). These are the SAME underlying props that DFS platforms use - they just present them as over/under picks.

WHEN USER ASKS FOR DFS LINEUP:

1. IDENTIFY THE PLATFORM:
   - "PrizePicks" / "Prize Picks" → PrizePicks lineup
   - "Underdog" / "UD" → Underdog Fantasy lineup  
   - "Sleeper" / "Sleeper Picks" → Sleeper lineup
   - No platform specified → Ask which platform OR show general prop picks

2. USE OUR PLAYER PROPS DATA:
   - We have real sportsbook lines for Points, Rebounds, Assists, 3-Pointers (NBA/NCAAB)
   - We have Passing Yards, Rushing Yards, Receiving Yards, TDs (NFL/NCAAF)
   - We have Points, Assists (NHL)
   - These lines are very close to what DFS platforms offer

3. RESPONSE FORMAT FOR DFS REQUESTS:

## 🎯 [PLATFORM] LINEUP ([2-4] LEGS)

**DISCLAIMER:** Lines shown are from sportsbooks. Platform lines may vary slightly - always confirm in the app before submitting.

### LEG 1: [Player Name] OVER/UNDER [Stat] [Line]
**Sport:** [NBA/NFL/NHL]
**Game:** [Away] @ [Home]
**Sportsbook Line:** [Line] (O: [odds] / U: [odds])

**Analysis:**
- Recent form: [If available from data]
- Matchup: [Opponent context]
- Injury check: [Verify player is healthy]

**Recommendation:** OVER/UNDER - [Brief reasoning]

### LEG 2: [Same format]

### LEG 3: [Same format]

---

## 📊 PARLAY MATH

| Legs | Win Rate Needed | Difficulty |
|------|-----------------|------------|
| 2-leg | 50% each = 25% combined | Moderate |
| 3-leg | 50% each = 12.5% combined | Hard |
| 4-leg | 50% each = 6.25% combined | Very Hard |
| 5-leg | 50% each = 3.1% combined | Extremely Hard |

⚠️ **PARLAY WARNING:** 
DFS pick'em entries are parlays - ALL legs must hit to win. Even with 60% confidence on each leg:
- 2-leg: 36% to win
- 3-leg: 22% to win  
- 4-leg: 13% to win

**For maximum profitability, single props beat parlays.**

---

## 🔍 PRE-GAME CHECKLIST
Before submitting your entry:
1. ✓ Verify all players are in the starting lineup (check 1 hour before game)
2. ✓ Confirm lines match what's shown in the app
3. ✓ Check for any late injury news

4. PROP SELECTION CRITERIA:
   - Prefer props where player has consistent recent performance
   - Avoid props for players with injury concerns
   - Consider matchup (pace, defensive rankings)
   - Look for props where sportsbook line seems off

5. IF NO PROPS DATA AVAILABLE:
   Say: "Props aren't posted yet for today's games. They typically appear in the morning/early afternoon. Check back closer to game time, or I can suggest star players who consistently hit certain stat thresholds."

6. NEVER SAY "I don't have PrizePicks/Underdog/Sleeper data"
   Instead say: "Here's a lineup using sportsbook prop lines - confirm the exact lines in [platform] before submitting."

=== END DFS SECTION ===`

/**
 * Extract text content from a message that might be a string or array of content blocks
 */
function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    // Handle Anthropic-style content blocks: [{type: 'text', text: '...'}]
    return content
      .filter((block): block is { type: string; text: string } => 
        typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string'
      )
      .map(block => block.text)
      .join(' ')
  }
  return ''
}

// Sport keywords to filter games by sport mentioned in the query
const SPORT_KEYWORDS: Record<string, string[]> = {
  'NBA': ['nba', 'basketball'],
  'NFL': ['nfl', 'football'],
  'NHL': ['nhl', 'hockey'],
  'MLB': ['mlb', 'baseball'],
  'NCAAB': ['ncaab', 'college basketball', 'march madness'],
  'NCAAF': ['ncaaf', 'college football', 'cfp', 'playoff'],
}

// Common stopwords to exclude from matching
const STOPWORDS = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'will', 'more', 'when', 'who', 'what', 'want', 'bet', 'game', 'pick', 'play', 'take', 'like', 'think', 'should', 'would', 'could'])

/**
 * Detect if the user is asking about a specific game and find the matching game
 * Returns the game if found, null otherwise
 * Supports both two-team queries ("Miami vs Indiana") and single-team queries ("Minnesota Wild game")
 */
async function detectGameQuestion(userMessage: string): Promise<Game | null> {
  // Normalize the message for matching
  const normalizedMessage = userMessage.toLowerCase()
  
  // Check if this looks like a game-specific question
  const gameQuestionPatterns = [
    /\b(vs|versus|@|at)\b/i,
    /\b(game|matchup|match)\b/i,
    /\b(spread|moneyline|ml|over|under|total)\b/i,
    /\b(bet|pick|play)\b.*\b(on|for)\b/i,
    /\bwho\s+(wins?|should|will)\b/i,
    /\bshould\s+i\s+(bet|take|play)\b/i,
    /\bwhat.*\b(think|like|recommend)\b.*\bgame\b/i,
  ]
  
  const looksLikeGameQuestion = gameQuestionPatterns.some(pattern => pattern.test(normalizedMessage))
  if (!looksLikeGameQuestion) {
    return null
  }
  
  // Detect sport hint from the message (e.g., "football" -> NFL/NCAAF)
  const sportHintLeagues: string[] = []
  for (const [league, keywords] of Object.entries(SPORT_KEYWORDS)) {
    if (keywords.some(kw => normalizedMessage.includes(kw))) {
      sportHintLeagues.push(league)
    }
  }
  
  // Get ESPN odds data to find matching games
  const espnOddsData = await getCachedESPNOdds()
  if (!espnOddsData?.games || espnOddsData.games.length === 0) {
    return null
  }
  
  // Filter games by sport hint if provided
  let candidateGames = espnOddsData.games
  if (sportHintLeagues.length > 0) {
    candidateGames = espnOddsData.games.filter(g => sportHintLeagues.includes(g.league))
    console.log(`[detectGameQuestion] Sport hint detected: ${sportHintLeagues.join(', ')}. Filtered to ${candidateGames.length} games.`)
  }
  
  // Normalize team name for matching - extract meaningful tokens
  const normalizeTeam = (name: string) => name.toLowerCase().replace(/[^a-z0-9\s]/g, '')
  const getTeamTokens = (name: string) => normalizeTeam(name).split(/\s+/).filter(t => t.length >= 4 && !STOPWORDS.has(t))
  
  // Get message tokens (words with 4+ chars, excluding stopwords)
  const messageTokens = normalizedMessage.split(/\s+/).filter(w => w.length >= 4 && !STOPWORDS.has(w))
  
  // Track single-team matches for fallback
  const singleTeamMatches: typeof espnOddsData.games = []
  
  // Try to find a matching game
  for (const espnGame of candidateGames) {
    const homeTokens = getTeamTokens(espnGame.homeTeam)
    const awayTokens = getTeamTokens(espnGame.awayTeam)
    
    // Check for token matches (exact match or one contains the other, both must be 4+ chars)
    const tokenMatches = (teamTokens: string[]) => {
      return teamTokens.some(tt => 
        messageTokens.some(mt => 
          tt === mt || // exact match
          (tt.length >= 4 && mt.length >= 4 && (tt.includes(mt) || mt.includes(tt))) // substring match only if both are 4+ chars
        )
      )
    }
    
    const homeMatch = tokenMatches(homeTokens)
    const awayMatch = tokenMatches(awayTokens)
    
    // Track single-team matches for fallback
    if (homeMatch || awayMatch) {
      singleTeamMatches.push(espnGame)
    }
    
    // Two-team match is preferred
    if (homeMatch && awayMatch) {
      // Convert ESPN game to Game format for analysis
      const sportKeyMap: Record<string, string> = {
        'NBA': 'basketball_nba',
        'NFL': 'americanfootball_nfl',
        'NHL': 'icehockey_nhl',
        'MLB': 'baseball_mlb',
        'NCAAB': 'basketball_ncaab',
        'NCAAF': 'americanfootball_ncaaf',
        'English Premier League': 'soccer_epl',
        'La Liga': 'soccer_spain_la_liga',
        'Bundesliga': 'soccer_germany_bundesliga',
        'Serie A': 'soccer_italy_serie_a',
        'Ligue 1': 'soccer_france_ligue_one',
        'MLS': 'soccer_usa_mls',
        'UEFA Champions League': 'soccer_uefa_champs_league',
      }
      
      const game: Game = {
        id: espnGame.gameId,
        sport: sportKeyMap[espnGame.league] || espnGame.league.toLowerCase(),
        sportName: espnGame.league,
        homeTeam: espnGame.homeTeam,
        awayTeam: espnGame.awayTeam,
        commenceTime: espnGame.commenceTime,
        moneylines: espnGame.moneyline ? [{
          bookmaker: 'espn',
          market: 'h2h',
          outcomes: [
            { name: espnGame.homeTeam, price: espnGame.moneyline.home },
            { name: espnGame.awayTeam, price: espnGame.moneyline.away }
          ]
        }] : [],
        spreads: espnGame.spread !== null ? [{
          bookmaker: 'espn',
          market: 'spreads',
          outcomes: [
            { 
              name: espnGame.homeTeam, 
              price: espnGame.spreadOdds?.home ?? -110, 
              point: espnGame.homeFavorite ? -Math.abs(espnGame.spread) : Math.abs(espnGame.spread) 
            },
            { 
              name: espnGame.awayTeam, 
              price: espnGame.spreadOdds?.away ?? -110, 
              point: espnGame.homeFavorite ? Math.abs(espnGame.spread) : -Math.abs(espnGame.spread) 
            }
          ]
        }] : [],
        totals: espnGame.overUnder !== null ? [{
          bookmaker: 'espn',
          market: 'totals',
          outcomes: [
            { name: 'Over', price: espnGame.overUnderOdds?.over ?? -110, point: espnGame.overUnder },
            { name: 'Under', price: espnGame.overUnderOdds?.under ?? -110, point: espnGame.overUnder }
          ]
        }] : []
      }
      
      console.log(`[detectGameQuestion] Found matching game (two-team): ${espnGame.awayTeam} @ ${espnGame.homeTeam}`)
      return game
    }
  }
  
  // Fallback: If only one team was mentioned and it uniquely identifies a game, use that
  if (singleTeamMatches.length === 1) {
    const espnGame = singleTeamMatches[0]
    const sportKeyMap: Record<string, string> = {
      'NBA': 'basketball_nba',
      'NFL': 'americanfootball_nfl',
      'NHL': 'icehockey_nhl',
      'MLB': 'baseball_mlb',
      'NCAAB': 'basketball_ncaab',
      'NCAAF': 'americanfootball_ncaaf',
      'English Premier League': 'soccer_epl',
      'La Liga': 'soccer_spain_la_liga',
      'Bundesliga': 'soccer_germany_bundesliga',
      'Serie A': 'soccer_italy_serie_a',
      'Ligue 1': 'soccer_france_ligue_one',
      'MLS': 'soccer_usa_mls',
      'UEFA Champions League': 'soccer_uefa_champs_league',
    }
    
    const game: Game = {
      id: espnGame.gameId,
      sport: sportKeyMap[espnGame.league] || espnGame.league.toLowerCase(),
      sportName: espnGame.league,
      homeTeam: espnGame.homeTeam,
      awayTeam: espnGame.awayTeam,
      commenceTime: espnGame.commenceTime,
      moneylines: espnGame.moneyline ? [{
        bookmaker: 'espn',
        market: 'h2h',
        outcomes: [
          { name: espnGame.homeTeam, price: espnGame.moneyline.home },
          { name: espnGame.awayTeam, price: espnGame.moneyline.away }
        ]
      }] : [],
      spreads: espnGame.spread !== null ? [{
        bookmaker: 'espn',
        market: 'spreads',
        outcomes: [
          { 
            name: espnGame.homeTeam, 
            price: espnGame.spreadOdds?.home ?? -110, 
            point: espnGame.homeFavorite ? -Math.abs(espnGame.spread) : Math.abs(espnGame.spread) 
          },
          { 
            name: espnGame.awayTeam, 
            price: espnGame.spreadOdds?.away ?? -110, 
            point: espnGame.homeFavorite ? Math.abs(espnGame.spread) : -Math.abs(espnGame.spread) 
          }
        ]
      }] : [],
      totals: espnGame.overUnder !== null ? [{
        bookmaker: 'espn',
        market: 'totals',
        outcomes: [
          { name: 'Over', price: espnGame.overUnderOdds?.over ?? -110, point: espnGame.overUnder },
          { name: 'Under', price: espnGame.overUnderOdds?.under ?? -110, point: espnGame.overUnder }
        ]
      }] : []
    }
    
    console.log(`[detectGameQuestion] Found matching game (single-team): ${espnGame.awayTeam} @ ${espnGame.homeTeam}`)
    return game
  }
  
  return null
}

/**
 * Detect if the user is asking for a "best bet" recommendation with optional sport filters
 * Returns filter info if detected, null otherwise
 */
function detectBestBetQuestion(userMessage: string): { excludeSports: string[]; includeSports: string[]; filterDescription: string } | null {
  const normalizedMessage = userMessage.toLowerCase()
  
  // Check if this looks like a "best bet" question
  const bestBetPatterns = [
    /\b(best|top|recommended?)\s+(bet|pick|play)\b/i,
    /\bwhat\s+(should|do)\s+(i|you)\s+(bet|pick|play)\b/i,
    /\bgive\s+me\s+a?\s*(bet|pick|play)\b/i,
    /\b(make|give|show)\s+(me\s+)?(the\s+)?(best|a)\s+(bet|pick)\b/i,
  ]
  
  const looksLikeBestBetQuestion = bestBetPatterns.some(pattern => pattern.test(normalizedMessage))
  if (!looksLikeBestBetQuestion) {
    return null
  }
  
  // Parse sport exclusions (e.g., "not hockey", "no NHL", "excluding basketball")
  const excludeSports: string[] = []
  const includeSports: string[] = []
  
  // Exclusion patterns
  const exclusionPatterns = [
    /\b(not|no|without|excluding?|except)\s+(hockey|nhl)/i,
    /\b(not|no|without|excluding?|except)\s+(basketball|nba|ncaab)/i,
    /\b(not|no|without|excluding?|except)\s+(football|nfl|ncaaf)/i,
    /\b(not|no|without|excluding?|except)\s+(baseball|mlb)/i,
    /\b(not|no|without|excluding?|except)\s+(soccer)/i,
    /\bnon[- ]?(hockey|nhl)/i,
    /\bnon[- ]?(basketball|nba)/i,
    /\bnon[- ]?(football|nfl)/i,
    /\bnon[- ]?(baseball|mlb)/i,
    /\bnon[- ]?(soccer)/i,
  ]
  
  for (const pattern of exclusionPatterns) {
    const match = normalizedMessage.match(pattern)
    if (match) {
      const sport = match[2] || match[1]
      if (sport.includes('hockey') || sport.includes('nhl')) excludeSports.push('NHL')
      else if (sport.includes('basketball') || sport.includes('nba')) excludeSports.push('NBA')
      else if (sport.includes('ncaab')) excludeSports.push('NCAAB')
      else if (sport.includes('football') || sport.includes('nfl')) excludeSports.push('NFL')
      else if (sport.includes('ncaaf')) excludeSports.push('NCAAF')
      else if (sport.includes('baseball') || sport.includes('mlb')) excludeSports.push('MLB')
      else if (sport.includes('soccer')) excludeSports.push('soccer')
    }
  }
  
  // Inclusion patterns (e.g., "NBA bet", "best hockey pick", "NFL only")
  const inclusionPatterns = [
    /\b(hockey|nhl)\s+(bet|pick|play|only)\b/i,
    /\b(basketball|nba|ncaab)\s+(bet|pick|play|only)\b/i,
    /\b(football|nfl|ncaaf)\s+(bet|pick|play|only)\b/i,
    /\b(baseball|mlb)\s+(bet|pick|play|only)\b/i,
    /\b(soccer)\s+(bet|pick|play|only)\b/i,
    /\bbest\s+(hockey|nhl)\b/i,
    /\bbest\s+(basketball|nba|ncaab)\b/i,
    /\bbest\s+(football|nfl|ncaaf)\b/i,
    /\bbest\s+(baseball|mlb)\b/i,
    /\bbest\s+(soccer)\b/i,
    /\b(only|just)\s+(hockey|nhl)\b/i,
    /\b(only|just)\s+(basketball|nba)\b/i,
    /\b(only|just)\s+(football|nfl)\b/i,
  ]
  
  // Only check inclusions if no exclusions were found
  if (excludeSports.length === 0) {
    for (const pattern of inclusionPatterns) {
      const match = normalizedMessage.match(pattern)
      if (match) {
        const sport = match[1] || match[2]
        if (sport.includes('hockey') || sport.includes('nhl')) includeSports.push('NHL')
        else if (sport.includes('nba')) includeSports.push('NBA')
        else if (sport.includes('ncaab')) includeSports.push('NCAAB')
        else if (sport.includes('basketball')) { includeSports.push('NBA'); includeSports.push('NCAAB') }
        else if (sport.includes('nfl')) includeSports.push('NFL')
        else if (sport.includes('ncaaf')) includeSports.push('NCAAF')
        else if (sport.includes('football')) { includeSports.push('NFL'); includeSports.push('NCAAF') }
        else if (sport.includes('baseball') || sport.includes('mlb')) includeSports.push('MLB')
        else if (sport.includes('soccer')) includeSports.push('soccer')
      }
    }
  }
  
  // Build filter description
  let filterDescription = ''
  if (excludeSports.length > 0) {
    filterDescription = `excluding ${excludeSports.join(', ')}`
  } else if (includeSports.length > 0) {
    filterDescription = `${includeSports.join('/')}`
  }
  
  console.log(`[detectBestBetQuestion] Detected best bet question. Exclude: ${excludeSports.join(', ') || 'none'}, Include: ${includeSports.join(', ') || 'all'}`)
  
  return { excludeSports, includeSports, filterDescription }
}

/**
 * Detect if the user is asking for a parlay recommendation
 */
function detectParlayQuestion(userMessage: string): boolean {
  const normalizedMessage = userMessage.toLowerCase()
  
  const parlayPatterns = [
    /\bparlay\b/i,
    /\bcombo\s+bet\b/i,
    /\bmulti[- ]?bet\b/i,
    /\baccumulator\b/i,
  ]
  
  return parlayPatterns.some(pattern => pattern.test(normalizedMessage))
}

export async function POST(request: Request) {
  try {
    // Check if API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY is not configured")
      return NextResponse.json({ error: "AI service not configured", details: "ANTHROPIC_API_KEY environment variable is not set" }, { status: 500 })
    }

    // Initialize Anthropic client inside handler to ensure API key is available
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const subStatus = await checkSubscription()
    
    if (!subStatus.isSubscribed && subStatus.questionsRemaining <= 0) {
      return NextResponse.json(
        { error: "Subscription required", requiresSubscription: true },
        { status: 403 }
      )
    }

    const body = await request.json()
    const chatMessages = body?.messages
    
    // Validate chatMessages is an array
    if (!chatMessages || !Array.isArray(chatMessages) || chatMessages.length === 0) {
      return NextResponse.json(
        { error: "Invalid request", details: "messages must be a non-empty array" },
        { status: 400 }
      )
    }

    const conversations = await db.conversations.findByUserId(session.user.id)
    let conversation = conversations[0]

    if (!conversation) {
      conversation = await db.conversations.create({
        userId: session.user.id,
        title: "New Conversation",
      })
    }

    // Fetch combined data from Odds API + ESPN API
    const combinedContext = await formatCombinedDataForContext()
    
    // Check if user is asking about a specific game and run on-demand analysis
    const userMessage = chatMessages[chatMessages.length - 1]
    const userMessageContent = extractMessageContent(userMessage.content)
    
    // Check for parlay questions first
    const isParlayQuestion = detectParlayQuestion(userMessageContent)
    if (isParlayQuestion) {
      console.log(`[chat] Detected parlay question`)
      try {
        const parlay = await getCachedParlay()
        if (parlay && parlay.safeParlay && parlay.safeParlay.length > 0) {
          // ALWAYS use cached parlay - it's computed with proper moneyline-only filtering
          // and value-based selection. Falling through to LLM causes:
          // 1. Mixed bet types (totals in parlays)
          // 2. Unrealistic probabilities (LLM hallucination)
          // 3. OVER/UNDER contradictions
          const hasEloData = parlay.safeParlay.some(leg => leg.eloProbability != null)
          const deterministicResponse = formatParlayForContext(parlay)
          console.log(`[chat] Returning cached parlay with ${parlay.safeParlay.length} legs (Elo data: ${hasEloData})`)
          
          // Save messages to database
          await db.messages.create({
            conversationId: conversation.id,
            role: 'user',
            content: userMessage.content,
          })
          
          await db.messages.create({
            conversationId: conversation.id,
            role: 'assistant',
            content: deterministicResponse,
          })
          
          await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })
          
          // Update question count for non-subscribers
          if (!subStatus.isSubscribed) {
            const user = await db.users.findById(session.user.id)
            if (user) {
              await db.users.update(session.user.id, { 
                questionCount: (user.questionCount || 0) + 1
              })
            }
          }
          
          // Return deterministic response directly, bypassing LLM
          return NextResponse.json({ 
            message: deterministicResponse,
            questionsRemaining: subStatus.isSubscribed 
              ? -1 
              : Math.max(0, subStatus.questionsRemaining - 1)
          })
        }
      } catch (err) {
        console.error('[chat] Error processing parlay question:', err)
        // Fall through to LLM if processing fails
      }
    }
    
    // Check for "best bet" questions (with or without filters)
    const bestBetFilter = detectBestBetQuestion(userMessageContent)
    if (bestBetFilter) {
      const hasFilters = bestBetFilter.excludeSports.length > 0 || bestBetFilter.includeSports.length > 0
      console.log(`[chat] Detected best bet question${hasFilters ? ` with filters: ${bestBetFilter.filterDescription}` : ' (no filters)'}`)
      
      try {
        let deterministicResponse: string | null = null
        
        if (hasFilters) {
          // Use filtered sport bets for questions with filters
          const sportBets = await getCachedSportBets()
          if (sportBets) {
            const result = getFilteredBestBetWithElo(sportBets, bestBetFilter.excludeSports, bestBetFilter.includeSports)
            
            if (result.bet) {
              deterministicResponse = formatFilteredBestBetResponse(result.bet, bestBetFilter.filterDescription)
              console.log(`[chat] Returning filtered best bet: ${result.bet.team} (${result.bet.sportName})`)
            } else {
              deterministicResponse = result.message
              console.log(`[chat] No Elo-based bets available for filter: ${bestBetFilter.filterDescription}`)
            }
          }
        } else {
          // Use cached best bet for general "best bet" questions without filters
          const bestBetResult = await getCachedBestBet()
          
          if (bestBetResult) {
            // formatBestBetForContext handles both cases:
            // - When bestBet exists: shows the best bet with full analysis
            // - When bestBet is null: shows fallback data (closestMisses, mostLikelyWinners) with explanation
            deterministicResponse = formatBestBetForContext(bestBetResult)
            if (bestBetResult.bestBet) {
              console.log(`[chat] Returning cached best bet: ${bestBetResult.bestBet.team} (${bestBetResult.bestBet.sportName})`)
            } else {
              console.log(`[chat] No strict value bet - returning fallback data. Reason: ${bestBetResult.reason}`)
            }
          } else {
            deterministicResponse = 'No bets available right now. Please check back later when games are scheduled.'
            console.log(`[chat] No cached best bet result available`)
          }
        }
        
        if (deterministicResponse) {
          // Save messages to database
          await db.messages.create({
            conversationId: conversation.id,
            role: 'user',
            content: userMessage.content,
          })
          
          await db.messages.create({
            conversationId: conversation.id,
            role: 'assistant',
            content: deterministicResponse,
          })
          
          await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })
          
          // Update question count for non-subscribers
          if (!subStatus.isSubscribed) {
            const user = await db.users.findById(session.user.id)
            if (user) {
              await db.users.update(session.user.id, { 
                questionCount: (user.questionCount || 0) + 1
              })
            }
          }
          
          // Return deterministic response directly, bypassing LLM
          return NextResponse.json({ 
            message: deterministicResponse,
            questionsRemaining: subStatus.isSubscribed 
              ? -1 
              : Math.max(0, subStatus.questionsRemaining - 1)
          })
        }
      } catch (err) {
        console.error('[chat] Error processing best bet question:', err)
        // Fall through to LLM if processing fails
      }
    }
    
    const detectedGame = await detectGameQuestion(userMessageContent)
    if (detectedGame) {
      console.log(`[chat] Running on-demand analysis for: ${detectedGame.awayTeam} @ ${detectedGame.homeTeam}`)
      try {
        const gameAnalysis = await analyzeSpecificGame(detectedGame)
        const deterministicAnalysis = formatGameAnalysisForContext(gameAnalysis)
        console.log(`[chat] Game analysis complete: ${gameAnalysis.bets.length} betting options found`)
        console.log(`[chat] Returning deterministic analysis (bypassing LLM)`)
        
        // Save messages to database
        await db.messages.create({
          conversationId: conversation.id,
          role: 'user',
          content: userMessage.content,
        })
        
        await db.messages.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: deterministicAnalysis,
        })
        
        await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })
        
        // Update question count for non-subscribers
        if (!subStatus.isSubscribed) {
          const user = await db.users.findById(session.user.id)
          if (user) {
            await db.users.update(session.user.id, { 
              questionCount: (user.questionCount || 0) + 1
            })
          }
        }
        
        // Return deterministic analysis directly, bypassing LLM
        return NextResponse.json({ 
          message: deterministicAnalysis,
          questionsRemaining: subStatus.isSubscribed 
            ? -1 
            : Math.max(0, subStatus.questionsRemaining - 1)
        })
      } catch (err) {
        console.error('[chat] Error running game analysis:', err)
        // Fall through to LLM if analysis fails
      }
    }
    
    const systemPromptWithData = `${SYSTEM_PROMPT}

${combinedContext}

IMPORTANT: Use this REAL-TIME data to answer the user's question.
- Reference actual games and odds from The Odds API
- Check ESPN injury data before making recommendations
- Verify starting lineups (especially NHL goalies) from ESPN data

═══════════════════════════════════════════════════════════
CRITICAL: TEAMMATE/ROSTER CLAIMS RULE
═══════════════════════════════════════════════════════════

You MUST NOT make claims about:
- Player hierarchies (e.g., "secondary scorer behind X")
- Teammate relationships (e.g., "with X out, Y gets more touches")
- Role descriptions relative to specific players (e.g., "the #2 option after X")

UNLESS that specific teammate's name appears in the provided roster/injury data above.

WHY: Players get traded, waived, or injured frequently. Your training data may be outdated.
If you're unsure whether a player is still on a team, use GENERIC role descriptions:

WRONG: "Herro is the secondary scorer behind Butler"
RIGHT: "Herro is one of Miami's primary offensive options"

WRONG: "With Curry out, Poole becomes the main ball-handler"  
RIGHT: "Check the injury report above to see who's available"

WRONG: "He's the #2 receiver after Jefferson"
RIGHT: "He's a high-volume target in this offense"

When discussing player props, focus on:
- The player's own recent performance and matchup
- Team pace and offensive/defensive rankings
- The specific line being offered
- DO NOT reference teammates unless they appear in today's data`

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemPromptWithData,
      messages: chatMessages,
    })

    const assistantMessage = response.content[0].type === 'text' 
      ? response.content[0].text 
      : ''

    // userMessage already declared above for game detection
    await db.messages.create({
      conversationId: conversation.id,
      role: 'user',
      content: userMessage.content,
    })
    
    await db.messages.create({
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantMessage,
    })

    await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })

    if (!subStatus.isSubscribed) {
      const user = await db.users.findById(session.user.id)
      if (user) {
        await db.users.update(session.user.id, { 
          questionCount: (user.questionCount || 0) + 1
        })
      }
    }

    return NextResponse.json({ 
      message: assistantMessage,
      questionsRemaining: subStatus.isSubscribed 
        ? -1 // -1 means unlimited (Infinity is not JSON-serializable)
        : Math.max(0, subStatus.questionsRemaining - 1)
    })

  } catch (error) {
    console.error("Chat API error:", error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: "Failed to process message", details: errorMessage },
      { status: 500 }
    )
  }
}

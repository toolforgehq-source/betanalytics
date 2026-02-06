import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"
import { db } from "@/db"
import { checkSubscription } from "@/lib/subscription"
import { formatCombinedDataForContext } from "@/lib/combined-data"
import { getCachedESPNOdds, getCachedESPNData, type ESPNOdds, type ESPNInjury } from "@/lib/espn"
import { analyzeSpecificGame, formatGameAnalysisForContext, getCachedSportBets, getFilteredBestBetWithElo, formatFilteredBestBetResponse, getCachedBestBet, formatBestBetForContext, getCachedParlay, formatParlayForContext, computeBestBets, cacheBestBet, computeEnhancedParlay, formatEnhancedParlayForContext } from "@/lib/bet-ranking"
import type { RankedBet, BestBetResult } from "@/lib/bet-ranking"
import type { Game } from "@/lib/odds"
import { storePick, getAllPicks } from "@/lib/pick-tracking"
import { detectPlayerPropQuestion, parsePlayerPropQuery, analyzePlayerProp, analyzeBestProps, formatPropAnalysisForContext, formatMultiPropAnalysisForContext } from "@/lib/player-prop-analysis"

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
CRITICAL: DO NOT GENERATE BETTING RECOMMENDATIONS
═══════════════════════════════════════════════════════════

If you are reading this, it means the system's deterministic betting recommendation engine did NOT successfully process the user's betting question. This can happen due to:
- No games available for the requested sport
- Elo data not available for the requested sport
- A processing error occurred

In this case, you MUST NOT generate your own betting recommendation. Instead:
1. Acknowledge that you couldn't find Elo-based betting data for their request
2. Suggest they try a different sport or check back later
3. Offer to help with general sports questions or information

NEVER:
- Pick a team/bet from the raw game data below
- Generate your own probability estimates
- Create your own "best bet" recommendation
- Use records, injuries, or other data to make betting suggestions

The betting recommendations MUST come from our Elo model, not from LLM analysis of raw data.

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

=== END DFS SECTION ===

═══════════════════════════════════════════════════════════
TEMPLATE 7: FUTURES BETS (Super Bowl, Championships, Season Props)
═══════════════════════════════════════════════════════════

User asks: "Super Bowl props?" / "Who wins the championship?" / "Season win totals?" / "MVP odds?" / "Futures bets?"

IMPORTANT: Our system specializes in daily game analysis using Elo ratings. We do NOT currently have a dedicated futures model.

Response format:

## 📅 FUTURES BETS

Thanks for asking about futures! Our system currently specializes in **daily game analysis** - we use Elo ratings to find edges on today's and tomorrow's games.

**What we can tell you:**
- Based on current Elo ratings, [Team X] is the strongest team in [League] right now
- Our model updates daily as games are played

**What we're working on:**
We're actively developing futures analysis to give you the same data-driven edge on championship odds, season win totals, and award props. This feature is coming soon!

**In the meantime:**
- Ask me about any game happening today or tomorrow
- I can analyze specific matchups, spreads, totals, and player props
- I can build you a parlay from today's games

Is there a specific game today I can help you analyze?

---

NEVER make up futures odds or championship probabilities. Be honest that this is a feature we're building.`

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
  // IMPORTANT: Patterns must handle multi-word team names like "minnesota wild", "golden state warriors"
  const gameQuestionPatterns = [
    /\b(vs|versus|@|at)\b/i,
    /\b(game|matchup|match)\b/i,
    /\b(spread|moneyline|ml|over|under|total)\b/i,
    /\b(bet|pick|play)\b.*\b(on|for)\b/i,
    /\bwho\s+(wins?|should|will)\b/i,
    /\bshould\s+i\s+(bet|take|play)\b/i,
    /\bwhat.*\b(think|like|recommend)\b.*\bgame\b/i,
    /\bi\s+want\s+to\s+bet\s+(the\s+)?[\w\s]+\s+game\b/i,  // "I want to bet the Lakers game" or "I want to bet the Minnesota Wild game"
    /\bi\s+want\s+to\s+bet\s+(the\s+)?[\w\s]+\s+(tonight|today)\b/i,  // "I want to bet the Minnesota Wild tonight"
    /\bi\s+want\s+to\s+bet\s+(on\s+)?(the\s+)?[\w\s]+\b/i,  // "I want to bet on the Wild" or "I want to bet the Wild"
    /\bbet\s+(on\s+)?(the\s+)?[\w\s]+\s+(game|tonight|today)\b/i,  // "bet on the Lakers tonight"
    /\b(analysis|prediction|pick)\s+(for|on)\s+(the\s+)?[\w\s]+/i,  // "analysis for the Lakers"
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
  // Also handle cases where multiple games match but only one is from the sport hint
  console.log(`[detectGameQuestion] Single-team matches: ${singleTeamMatches.length} games, message tokens: ${messageTokens.join(', ')}`)
  if (singleTeamMatches.length > 1) {
    console.log(`[detectGameQuestion] Multiple matches found: ${singleTeamMatches.map(g => `${g.awayTeam} @ ${g.homeTeam} (${g.league})`).join(', ')}`)
    // If we have a sport hint, filter to just that sport
    if (sportHintLeagues.length > 0) {
      const filteredMatches = singleTeamMatches.filter(g => sportHintLeagues.includes(g.league))
      if (filteredMatches.length === 1) {
        console.log(`[detectGameQuestion] Filtered to single match using sport hint: ${filteredMatches[0].awayTeam} @ ${filteredMatches[0].homeTeam}`)
        singleTeamMatches.length = 0
        singleTeamMatches.push(filteredMatches[0])
      }
    }
  }
  
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
  // These patterns need to handle variations like:
  // - "best bet today" (direct)
  // - "best nhl bet tonight" (sport between best and bet)
  // - "i want to bet on the nhl tonight" (intent to bet on sport)
  const bestBetPatterns = [
    /\b(best|top|recommended?)\s+(bet|pick|play)\b/i,
    /\b(best|top|recommended?)\s+\w+\s+(bet|pick|play)\b/i,  // "best nhl bet", "best hockey bet"
    /\bwhat\s+(should|do)\s+(i|you)\s+(bet|pick|play)\b/i,
    /\bgive\s+me\s+a?\s*(bet|pick|play)\b/i,
    /\b(make|give|show)\s+(me\s+)?(the\s+)?(best|a)\s+(bet|pick)\b/i,
    /\bi\s+want\s+to\s+bet\s+(on\s+)?(the\s+)?(nhl|nba|nfl|mlb|ncaab|ncaaf|hockey|basketball|football|baseball|soccer)/i,  // "i want to bet on the nhl"
    /\b(bet|betting)\s+(on\s+)?(the\s+)?(nhl|nba|nfl|mlb|ncaab|ncaaf|hockey|basketball|football|baseball|soccer)\s+(tonight|today|this\s+week)/i,  // "betting on nhl tonight"
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
  
  // Inclusion patterns (e.g., "NBA bet", "best hockey pick", "NFL only", "bet on the nhl", "best bet in the nba")
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
    /\bbet\s+(on\s+)?(the\s+)?(hockey|nhl)\b/i,
    /\bbet\s+(on\s+)?(the\s+)?(basketball|nba|ncaab)\b/i,
    /\bbet\s+(on\s+)?(the\s+)?(football|nfl|ncaaf)\b/i,
    /\bbet\s+(on\s+)?(the\s+)?(baseball|mlb)\b/i,
    /\bbet\s+(on\s+)?(the\s+)?(soccer)\b/i,
    // NEW: Handle "best bet in the [sport]" and "best bet for [sport]" patterns
    /\bbest\s+bet\s+(in|for)\s+(the\s+)?(hockey|nhl)\b/i,
    /\bbest\s+bet\s+(in|for)\s+(the\s+)?(basketball|nba|ncaab)\b/i,
    /\bbest\s+bet\s+(in|for)\s+(the\s+)?(football|nfl|ncaaf)\b/i,
    /\bbest\s+bet\s+(in|for)\s+(the\s+)?(baseball|mlb)\b/i,
    /\bbest\s+bet\s+(in|for)\s+(the\s+)?(soccer)\b/i,
    // NEW: Handle "[sport] best bet" patterns
    /\b(hockey|nhl)\s+best\s+bet\b/i,
    /\b(basketball|nba|ncaab)\s+best\s+bet\b/i,
    /\b(football|nfl|ncaaf)\s+best\s+bet\b/i,
    /\b(baseball|mlb)\s+best\s+bet\b/i,
    /\b(soccer)\s+best\s+bet\b/i,
  ]
  
  // Only check inclusions if no exclusions were found
  if (excludeSports.length === 0) {
    for (const pattern of inclusionPatterns) {
      const match = normalizedMessage.match(pattern)
      if (match) {
        // Sport can be in different match groups depending on the pattern
        // Try all possible groups and find the one that contains a sport keyword
        const sport = [match[1], match[2], match[3]].find(m => 
          m && (m.includes('hockey') || m.includes('nhl') || m.includes('nba') || 
                m.includes('ncaab') || m.includes('basketball') || m.includes('nfl') || 
                m.includes('ncaaf') || m.includes('football') || m.includes('mlb') || 
                m.includes('baseball') || m.includes('soccer'))
        ) || match[1] || match[2]
        
        if (sport && (sport.includes('hockey') || sport.includes('nhl'))) includeSports.push('NHL')
        else if (sport && sport.includes('nba')) includeSports.push('NBA')
        else if (sport && sport.includes('ncaab')) includeSports.push('NCAAB')
        else if (sport && sport.includes('basketball')) { includeSports.push('NBA'); includeSports.push('NCAAB') }
        else if (sport && sport.includes('nfl')) includeSports.push('NFL')
        else if (sport && sport.includes('ncaaf')) includeSports.push('NCAAF')
        else if (sport && sport.includes('football')) { includeSports.push('NFL'); includeSports.push('NCAAF') }
        else if (sport && (sport.includes('baseball') || sport.includes('mlb'))) includeSports.push('MLB')
        else if (sport && sport.includes('soccer')) includeSports.push('soccer')
      }
    }
  }
  
  // Deduplicate sports arrays to prevent "NHL/NHL" issues
  const uniqueExcludeSports = Array.from(new Set(excludeSports))
  const uniqueIncludeSports = Array.from(new Set(includeSports))
  
  // Build filter description
  let filterDescription = ''
  if (uniqueExcludeSports.length > 0) {
    filterDescription = `excluding ${uniqueExcludeSports.join(', ')}`
  } else if (uniqueIncludeSports.length > 0) {
    filterDescription = uniqueIncludeSports.join('/')
  }
  
  console.log(`[detectBestBetQuestion] Detected best bet question. Exclude: ${uniqueExcludeSports.join(', ') || 'none'}, Include: ${uniqueIncludeSports.join(', ') || 'all'}`)
  
  return { excludeSports: uniqueExcludeSports, includeSports: uniqueIncludeSports, filterDescription }
}

/**
 * Detect if the user is asking for a parlay recommendation
 * Returns the number of legs requested (default 3) or null if not a parlay question
 */
function detectParlayQuestion(userMessage: string): { isParlay: boolean; legCount: number } | null {
  const normalizedMessage = userMessage.toLowerCase()
  
  const parlayPatterns = [
    /\bparlay\b/i,
    /\bcombo\s+bet\b/i,
    /\bmulti[- ]?bet\b/i,
    /\baccumulator\b/i,
  ]
  
  const isParlay = parlayPatterns.some(pattern => pattern.test(normalizedMessage))
  if (!isParlay) return null
  
  // Extract number of legs if specified
  const legPatterns = [
    /(\d+)[- ]?leg/i,           // "3-leg", "3 leg"
    /(\d+)[- ]?team/i,          // "3-team"
    /(\d+)[- ]?pick/i,          // "3-pick"
    /build\s+(?:me\s+)?a?\s*(\d+)/i,  // "build me a 3"
    /give\s+(?:me\s+)?a?\s*(\d+)/i,   // "give me a 3"
    /show\s+(?:me\s+)?a?\s*(\d+)/i,   // "show me a 3"
  ]
  
  for (const pattern of legPatterns) {
    const match = normalizedMessage.match(pattern)
    if (match && match[1]) {
      const legCount = parseInt(match[1], 10)
      // Limit to 2-6 legs for reasonable parlays
      if (legCount >= 2 && legCount <= 6) {
        return { isParlay: true, legCount }
      }
    }
  }
  
  // Default to 3 legs if no specific count requested
  return { isParlay: true, legCount: 3 }
}

// Extended Game type with ESPN data for injury support
interface EnrichedGame extends Game {
  espnData?: {
    injuries: ESPNInjury[]
    homeRecord?: string
    awayRecord?: string
  }
}

/**
 * Normalize team name for matching between ESPN odds and ESPN data
 */
function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

/**
 * Convert ESPN odds to enriched games WITH injury data
 * This is critical for proper injury detection in bet recommendations
 */
async function convertESPNOddsToEnrichedGames(espnOddsData: { games: ESPNOdds[] }): Promise<EnrichedGame[]> {
  console.log(`[convertESPNOddsToEnrichedGames] Starting merge of ${espnOddsData.games.length} ESPN odds games`)
  
  // Fetch ESPN data with injuries
  const espnData = await getCachedESPNData()
  console.log(`[convertESPNOddsToEnrichedGames] Fetched ESPN data: ${espnData.games.length} games`)
  
  // Log games with injuries from ESPN data
  const espnGamesWithInjuries = espnData.games.filter(g => g.injuries && g.injuries.length > 0)
  console.log(`[convertESPNOddsToEnrichedGames] ESPN data has ${espnGamesWithInjuries.length} games with injuries`)
  for (const game of espnGamesWithInjuries) {
    console.log(`[convertESPNOddsToEnrichedGames] ESPN game with injuries: ${game.awayTeam.name} @ ${game.homeTeam.name} (${game.injuries.length} injuries)`)
    const keyInjuries = game.injuries.filter(i => i.status === 'Out' || i.status === 'Doubtful')
    if (keyInjuries.length > 0) {
      keyInjuries.forEach(i => console.log(`   ⚠️ ${i.player} (${i.team}): ${i.status}`))
    }
  }
  
  const sportKeyMap: Record<string, string> = {
    'NBA': 'basketball_nba',
    'NFL': 'americanfootball_nfl',
    'NHL': 'icehockey_nhl',
    'NCAAB': 'basketball_ncaab',
    'NCAAF': 'americanfootball_ncaaf',
    'MLB': 'baseball_mlb',
    'English Premier League': 'soccer_epl',
    'La Liga': 'soccer_spain_la_liga',
    'Bundesliga': 'soccer_germany_bundesliga',
    'Serie A': 'soccer_italy_serie_a',
    'Ligue 1': 'soccer_france_ligue_one',
    'MLS': 'soccer_usa_mls',
    'UEFA Champions League': 'soccer_uefa_champs_league',
  }
  
  const todayET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  console.log(`[convertESPNOddsToEnrichedGames] Today's date (ET): ${todayET}`)
  
  const enrichedGames: EnrichedGame[] = espnOddsData.games
    .filter(g => {
      const gameDate = new Date(g.commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      return gameDate === todayET
    })
    .map(g => {
      const sportKey = sportKeyMap[g.league] || g.sport
      const provider = g.provider || 'DraftKings'
      const homeSpread = g.spread ?? 0
      
      // Find matching ESPN game data (which has injuries)
      const matchingEspnGame = espnData.games.find(eg => {
        const oddsHome = normalizeTeamName(g.homeTeam)
        const oddsAway = normalizeTeamName(g.awayTeam)
        const espnHome = normalizeTeamName(eg.homeTeam.name)
        const espnAway = normalizeTeamName(eg.awayTeam.name)
        
        // Check for exact or partial matches
        const homeMatch = oddsHome === espnHome || 
          oddsHome.includes(espnHome) || espnHome.includes(oddsHome) ||
          oddsHome.split(' ').some(word => espnHome.includes(word) && word.length > 3)
        const awayMatch = oddsAway === espnAway || 
          oddsAway.includes(espnAway) || espnAway.includes(oddsAway) ||
          oddsAway.split(' ').some(word => espnAway.includes(word) && word.length > 3)
        
        return homeMatch && awayMatch
      })
      
      // Log matching attempt for debugging
      if (g.league === 'NBA') {
        console.log(`[convertESPNOddsToEnrichedGames] NBA game: ${g.awayTeam} @ ${g.homeTeam}`)
        console.log(`   Match found: ${matchingEspnGame ? 'YES' : 'NO'}`)
        if (matchingEspnGame) {
          console.log(`   ESPN game: ${matchingEspnGame.awayTeam.name} @ ${matchingEspnGame.homeTeam.name}`)
          console.log(`   Injuries: ${matchingEspnGame.injuries.length}`)
        }
      }
      
      const baseGame: EnrichedGame = {
        id: g.gameId,
        sport: sportKey,
        sportName: g.league,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        commenceTime: g.commenceTime,
        spreads: g.spread !== null ? [{
          bookmaker: provider,
          market: 'spreads',
          outcomes: [
            { name: g.homeTeam, price: g.spreadOdds?.home || -110, point: homeSpread },
            { name: g.awayTeam, price: g.spreadOdds?.away || -110, point: -homeSpread }
          ]
        }] : [],
        totals: g.overUnder !== null ? [{
          bookmaker: provider,
          market: 'totals',
          outcomes: [
            { name: 'Over', price: g.overUnderOdds?.over || -110, point: g.overUnder },
            { name: 'Under', price: g.overUnderOdds?.under || -110, point: g.overUnder }
          ]
        }] : [],
        moneylines: g.moneyline ? [{
          bookmaker: provider,
          market: 'h2h',
          outcomes: [
            { name: g.homeTeam, price: g.moneyline.home },
            { name: g.awayTeam, price: g.moneyline.away }
          ]
        }] : []
      }
      
      // Attach injury data if found
      if (matchingEspnGame && matchingEspnGame.injuries.length > 0) {
        console.log(`[chat] Found ${matchingEspnGame.injuries.length} injuries for ${g.homeTeam} vs ${g.awayTeam}`)
        baseGame.espnData = {
          injuries: matchingEspnGame.injuries,
          homeRecord: matchingEspnGame.homeTeam.record,
          awayRecord: matchingEspnGame.awayTeam.record
        }
      }
      
      return baseGame
    })
  
  // Log injury data status
  const gamesWithInjuries = enrichedGames.filter(g => g.espnData?.injuries?.length).length
  console.log(`[chat] Converted ${enrichedGames.length} games, ${gamesWithInjuries} with injury data`)
  
  return enrichedGames
}

/**
 * BROAD betting question detector - catches ANY betting-related query
 * This ensures ALL betting questions use Elo-based analysis, never LLM fallback
 * 
 * Returns true if the query contains ANY betting-related terms:
 * - Betting verbs: bet, wager, pick, play, take
 * - Betting terms: odds, line, spread, moneyline, total, over, under, prop, futures
 * - Game terms: game, matchup, vs, @, tonight, today
 * - Analysis terms: prediction, analysis, recommendation, edge, value
 * - Sport names: NBA, NHL, NFL, etc.
 * - Common team name patterns
 */
function isBettingQuestion(userMessage: string): boolean {
  const normalizedMessage = userMessage.toLowerCase()
  
  // Exclusion patterns - these are NOT betting questions, use LLM
  const nonBettingPatterns = [
    /\bhow\s+does\s+(elo|the\s+system|your\s+model|betting|the\s+algorithm)\s+work\b/i,
    /\bexplain\s+(elo|bankroll|betting|odds|probability|the\s+system)\b/i,
    /\bwhat\s+is\s+(elo|bankroll|edge|ev|expected\s+value)\b/i,
    /\bhelp\s+me\s+understand\b/i,
    /\bteach\s+me\b/i,
    /\bhow\s+do\s+i\s+read\b/i,
    /\bwhat\s+does\s+.*\s+mean\b/i,
    /\bdefine\b/i,
    /\btutorial\b/i,
    /\bguide\b/i,
    /\bstrategy\s+(guide|tips|advice)\b/i,
    /\bbankroll\s+management\b/i,
    /\bhow\s+much\s+should\s+i\s+bet\b/i,
    /\bunit\s+size\b/i,
  ]
  
  // If it matches a non-betting pattern, it's NOT a betting question
  if (nonBettingPatterns.some(pattern => pattern.test(normalizedMessage))) {
    console.log(`[isBettingQuestion] Excluded by non-betting pattern`)
    return false
  }
  
  // Betting action verbs
  const bettingVerbs = [
    /\bbet\b/i,
    /\bwager\b/i,
    /\bpick\b/i,
    /\bplay\b/i,
    /\btake\b/i,
    /\bfade\b/i,
    /\bhammer\b/i,
    /\block\b/i,
  ]
  
  // Betting market terms
  const bettingTerms = [
    /\bodds\b/i,
    /\bline\b/i,
    /\bspread\b/i,
    /\bmoneyline\b/i,
    /\bml\b/i,
    /\btotal\b/i,
    /\bover\b/i,
    /\bunder\b/i,
    /\bprop\b/i,
    /\bfutures?\b/i,
    /\bparlay\b/i,
    /\bteaser\b/i,
    /\bparlays?\b/i,
    /\bpoints?\b/i,
    /\bhandicap\b/i,
    /\bcover\b/i,
    /\bats\b/i,  // against the spread
  ]
  
  // Game/matchup terms
  const gameTerms = [
    /\bgame\b/i,
    /\bmatchup\b/i,
    /\bvs\b/i,
    /\bversus\b/i,
    /\b@\b/,
    /\btonight\b/i,
    /\btoday\b/i,
    /\btomorrow\b/i,
    /\bthis\s+week\b/i,
    /\bweekend\b/i,
  ]
  
  // Analysis/recommendation terms
  const analysisTerms = [
    /\bprediction\b/i,
    /\banalysis\b/i,
    /\brecommend/i,
    /\bedge\b/i,
    /\bvalue\b/i,
    /\bwinner\b/i,
    /\bwho\s+wins\b/i,
    /\bwho\s+should\b/i,
    /\bshould\s+i\b/i,
    /\bwhat.*think\b/i,
    /\bgood\s+bet\b/i,
    /\bbest\s+bet\b/i,
    /\bsafe\s+bet\b/i,
    /\bsure\s+thing\b/i,
    /\block\s+of\s+the\b/i,
    /\bconfident\b/i,
    /\blike\s+the\b/i,
    /\bfavor\b/i,
    /\belo\b/i,
  ]
  
  // Sport names (major leagues)
  const sportTerms = [
    /\bnba\b/i,
    /\bnfl\b/i,
    /\bnhl\b/i,
    /\bmlb\b/i,
    /\bncaa[bf]?\b/i,
    /\bcollege\s+(basketball|football)\b/i,
    /\bmarch\s+madness\b/i,
    /\bpremier\s+league\b/i,
    /\bepl\b/i,
    /\bla\s+liga\b/i,
    /\bbundesliga\b/i,
    /\bserie\s+a\b/i,
    /\bligue\s+1\b/i,
    /\bmls\b/i,
    /\bchampions\s+league\b/i,
    /\bbasketball\b/i,
    /\bfootball\b/i,
    /\bhockey\b/i,
    /\bbaseball\b/i,
    /\bsoccer\b/i,
  ]
  
  // Common team name keywords (partial matches for team names)
  // These are distinctive words that appear in team names
  const teamKeywords = [
    // NBA
    /\blakers\b/i, /\bceltics\b/i, /\bwarriors\b/i, /\bnuggets\b/i, /\bheat\b/i,
    /\bbucks\b/i, /\b76ers\b/i, /\bsixers\b/i, /\bknicks\b/i, /\bnets\b/i,
    /\bsuns\b/i, /\bmavericks\b/i, /\bmavs\b/i, /\bclippers\b/i, /\bgrizzlies\b/i,
    /\bcavaliers\b/i, /\bcavs\b/i, /\bthunder\b/i, /\bpelicans\b/i, /\bkings\b/i,
    /\btimberwolves\b/i, /\bwolves\b/i, /\btrailblazers\b/i, /\bblazers\b/i,
    /\bhawks\b/i, /\bhornets\b/i, /\bbulls\b/i, /\bpistons\b/i, /\bpacers\b/i,
    /\bmagic\b/i, /\braptors\b/i, /\bwizards\b/i, /\bspurs\b/i, /\brockets\b/i,
    /\bjazz\b/i,
    // NHL
    /\bbruins\b/i, /\bmaple\s+leafs\b/i, /\bleafs\b/i, /\bcanadiens\b/i, /\bhabs\b/i,
    /\bflyers\b/i, /\bpenguins\b/i, /\bpens\b/i, /\bcapitals\b/i, /\bcaps\b/i,
    /\bblackhawks\b/i, /\bred\s+wings\b/i, /\bwild\b/i, /\bflames\b/i, /\boilers\b/i,
    /\bcanucks\b/i, /\bkraken\b/i, /\bknights\b/i, /\bavalanche\b/i, /\bavs\b/i,
    /\bstars\b/i, /\bblues\b/i, /\bpredators\b/i, /\bpreds\b/i, /\blightning\b/i,
    /\bpanthers\b/i, /\bhurricanes\b/i, /\bcanes\b/i, /\bdevils\b/i, /\bislanders\b/i,
    /\brangers\b/i, /\bsabres\b/i, /\bsenators\b/i, /\bsens\b/i, /\bjets\b/i,
    /\bsharks\b/i, /\bducks\b/i, /\bcoyotes\b/i, /\bjackets\b/i,
    // NFL
    /\bchiefs\b/i, /\beagles\b/i, /\bbills\b/i, /\bdolphins\b/i, /\bpatriots\b/i,
    /\bpats\b/i, /\bravens\b/i, /\bbengals\b/i, /\bsteelers\b/i, /\bbrowns\b/i,
    /\btitans\b/i, /\bcolts\b/i, /\btexans\b/i, /\bjaguars\b/i, /\bjags\b/i,
    /\bbroncos\b/i, /\braiders\b/i, /\bchargers\b/i, /\bcowboys\b/i, /\bgiants\b/i,
    /\bcommanders\b/i, /\bpackers\b/i, /\bvikings\b/i, /\bbears\b/i, /\blions\b/i,
    /\bsaints\b/i, /\bfalcons\b/i, /\bbuccaneers\b/i, /\bbucs\b/i, /\bseahawks\b/i,
    /\bcardinals\b/i, /\b49ers\b/i, /\bniners\b/i, /\brams\b/i,
    // MLB
    /\byankees\b/i, /\bred\s+sox\b/i, /\bdodgers\b/i, /\bbraves\b/i, /\bastros\b/i,
    /\bphillies\b/i, /\bmets\b/i, /\bpadres\b/i, /\bguardians\b/i, /\btwins\b/i,
    /\borioles\b/i, /\brays\b/i, /\bblue\s+jays\b/i, /\bjays\b/i, /\bwhite\s+sox\b/i,
    /\bcubs\b/i, /\brewers\b/i, /\breds\b/i, /\bpirates\b/i, /\bcardinals\b/i,
    /\bgiants\b/i, /\brockies\b/i, /\bdiamondbacks\b/i, /\bdbacks\b/i, /\bmariners\b/i,
    /\bangels\b/i, /\bathletics\b/i, /\bas\b/i, /\btigers\b/i, /\broyals\b/i,
    /\bnationals\b/i, /\bnats\b/i, /\bmarlins\b/i,
    // College (common)
    /\bduke\b/i, /\bkentucky\b/i, /\bkansas\b/i, /\bnorth\s+carolina\b/i, /\bunc\b/i,
    /\bvillanova\b/i, /\bgonzaga\b/i, /\bbaylor\b/i, /\balabama\b/i, /\bgeorgia\b/i,
    /\bohio\s+state\b/i, /\bmichigan\b/i, /\bpenn\s+state\b/i, /\btexas\b/i,
    /\boklahoma\b/i, /\busc\b/i, /\bucla\b/i, /\boregon\b/i, /\bnotre\s+dame\b/i,
    /\bclemson\b/i, /\bflorida\b/i, /\bfsu\b/i, /\blsu\b/i, /\bauburn\b/i,
    /\btennessee\b/i, /\barkansas\b/i, /\bmississippi\b/i, /\bole\s+miss\b/i,
    /\biowa\b/i, /\bwisconsin\b/i, /\bpurdue\b/i, /\bindiana\b/i, /\billinois\b/i,
    /\bminnesota\b/i, /\bcolorado\b/i, /\butah\b/i, /\barizona\b/i, /\bstanford\b/i,
    /\bwashington\b/i, /\bcal\b/i, /\bberkeley\b/i,
    // Soccer (EPL, etc.)
    /\bmanchester\b/i, /\bman\s+(utd|united|city)\b/i, /\bliverpool\b/i, /\bchelsea\b/i,
    /\barsenal\b/i, /\btottenham\b/i, /\bspurs\b/i, /\bnewcastle\b/i, /\baston\s+villa\b/i,
    /\bbrighton\b/i, /\bwest\s+ham\b/i, /\bcrystal\s+palace\b/i, /\bfulham\b/i,
    /\bbrentford\b/i, /\bnottingham\b/i, /\bwolves\b/i, /\beverton\b/i, /\bbournemouth\b/i,
    /\breal\s+madrid\b/i, /\bbarcelona\b/i, /\bbarca\b/i, /\batletico\b/i,
    /\bbayern\b/i, /\bdortmund\b/i, /\bjuventus\b/i, /\bjuve\b/i, /\binter\b/i,
    /\bac\s+milan\b/i, /\bnapoli\b/i, /\bpsg\b/i, /\bparis\b/i,
  ]
  
  // Check all pattern categories
  const hasBettingVerb = bettingVerbs.some(p => p.test(normalizedMessage))
  const hasBettingTerm = bettingTerms.some(p => p.test(normalizedMessage))
  const hasGameTerm = gameTerms.some(p => p.test(normalizedMessage))
  const hasAnalysisTerm = analysisTerms.some(p => p.test(normalizedMessage))
  const hasSportTerm = sportTerms.some(p => p.test(normalizedMessage))
  const hasTeamKeyword = teamKeywords.some(p => p.test(normalizedMessage))
  
  // A query is a betting question if it has:
  // 1. A betting verb OR betting term, OR
  // 2. A sport term + (game term OR analysis term), OR
  // 3. A team keyword + (game term OR analysis term OR betting verb), OR
  // 4. An analysis term that implies betting (prediction, who wins, should i, etc.)
  
  const isBetting = 
    hasBettingVerb || 
    hasBettingTerm || 
    (hasSportTerm && (hasGameTerm || hasAnalysisTerm)) ||
    (hasTeamKeyword && (hasGameTerm || hasAnalysisTerm || hasBettingVerb)) ||
    hasAnalysisTerm
  
  console.log(`[isBettingQuestion] Query: "${userMessage.substring(0, 50)}..." => ${isBetting ? 'BETTING' : 'NOT BETTING'} (verb:${hasBettingVerb}, term:${hasBettingTerm}, game:${hasGameTerm}, analysis:${hasAnalysisTerm}, sport:${hasSportTerm}, team:${hasTeamKeyword})`)
  
  return isBetting
}

/**
 * Conversational prompt for formatting Elo data naturally
 * This prompt ensures the LLM uses ONLY the provided Elo data while making responses conversational
 */
const CONVERSATIONAL_BETTING_PROMPT = `You are a professional sports betting analyst having a conversation with a user. Your job is to take the Elo-based analysis data provided and present it in a measured, analytical tone.

CRITICAL RULES:
1. You MUST use ONLY the Elo data provided below - do not invent your own analysis or probabilities
2. All recommendations MUST come from the Elo analysis - never make up your own picks
3. Reference the specific Elo ratings, edges, and scores from the data
4. Be conversational but professional - don't just dump data
5. When comparing options, use the Elo data to explain why one is better
6. When asked for opinions, base them on the Elo edge and confidence scores
7. Remember context from the conversation - "this game", "these bets", etc. refer to previously discussed items
8. When mentioning injuries, include the timestamp from the data (e.g., "Injury data as of 2:34 PM ET")

TONE GUIDELINES (IMPORTANT):
- Sound like a professional analyst with data, NOT an excited gambler hyping picks
- Use measured language: "This represents strong value" instead of "I love this play"
- Be analytical: "The data shows a significant edge" instead of "absolutely massive edge"
- Stay objective: "Worth considering based on the metrics" instead of "That's the kind of spot you circle"
- Confident but not salesy: "The Elo model favors this side" instead of "This is a lock"

RESPONSE STYLE:
- Be direct and analytical: "The data supports X because..." 
- Use professional language: "The Timberwolves show a notable 19.8% edge here" 
- Compare objectively: "The Wolves offer better value (19.8% edge vs 9.1%)"
- Synthesize clearly: "Based on the analysis, Colorado represents the strongest value tonight"
- Reference Elo professionally: "Minnesota's Elo of 1540 vs Calgary's 1435 indicates..."
- Be measured: "This bet shows meaningful edge based on the model"

AVOID HYPED LANGUAGE:
- "I love this play" -> "This represents strong value"
- "absolutely massive" -> "significant" or "notable"
- "That's the kind of spot you circle" -> "This meets our value criteria"
- "Lock of the day" -> "Highest-confidence pick"
- "Hammer this" -> "Consider this based on the edge"
- "Can't miss" -> "Strong probability"

NEVER:
- Invent probabilities or edges not in the data
- Recommend bets not supported by the Elo analysis
- Say "I don't have data" if data is provided
- Be robotic or just repeat the structured data verbatim
- Use tout-service language that hypes picks

The Elo analysis is your source of truth. Present it like a professional analyst explaining their methodology and findings.`

/**
 * Generate a conversational response from Elo data using the LLM
 * This keeps Elo as the source of truth while making responses natural
 */
async function generateConversationalResponse(
  anthropic: Anthropic,
  eloAnalysis: string,
  userQuestion: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  // Build the context with Elo data
  const systemPrompt = `${CONVERSATIONAL_BETTING_PROMPT}

═══════════════════════════════════════════════════════════
ELO ANALYSIS DATA (USE THIS AS YOUR SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════

${eloAnalysis}

═══════════════════════════════════════════════════════════

Now respond to the user's question conversationally, using ONLY the Elo data above for any betting recommendations.`

  // Include recent conversation history for context
  const recentHistory = conversationHistory.slice(-6) // Last 3 exchanges
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...recentHistory,
    { role: 'user' as const, content: userQuestion }
  ]

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: systemPrompt,
    messages: messages,
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
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
    
    // Build conversation history for context-aware responses
    // This allows the LLM to understand "this game", "these bets", etc.
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = chatMessages
      .slice(0, -1) // Exclude the current message
      .map((msg: { role: string; content: unknown }) => ({
        role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
        content: extractMessageContent(msg.content)
      }))
      .filter((msg: { role: 'user' | 'assistant'; content: string }) => msg.content.length > 0)
    
    // PRIORITY ORDER: Game-specific > Parlay > Best bet > LLM fallback
    // Check for game-specific questions FIRST (e.g., "I want to bet the Lakers game")
    // This must come before best bet detection to avoid generic responses for team-specific queries
    const detectedGame = await detectGameQuestion(userMessageContent)
    if (detectedGame) {
      console.log(`[chat] Running on-demand analysis for: ${detectedGame.awayTeam} @ ${detectedGame.homeTeam}`)
      try {
        const gameAnalysis = await analyzeSpecificGame(detectedGame)
        const eloAnalysisData = formatGameAnalysisForContext(gameAnalysis)
        console.log(`[chat] Game analysis complete: ${gameAnalysis.bets.length} betting options found`)
        
        // Track the best bet from game analysis for outcome tracking
        if (gameAnalysis.bets.length > 0) {
          try {
            const bestBet = gameAnalysis.bets[0] // First bet is the best one (sorted by score)
            const existingPicks = await getAllPicks()
            const alreadyTracked = existingPicks.some(p => 
              p.gameId === detectedGame.id && 
              p.team === bestBet.team &&
              p.betType === bestBet.betType &&
              p.pickType === 'game_specific' &&
              p.status === 'pending'
            )
            
            if (!alreadyTracked) {
              await storePick({
                gameId: detectedGame.id,
                sport: detectedGame.sport,
                sportName: detectedGame.sportName,
                homeTeam: gameAnalysis.game.homeTeam,
                awayTeam: gameAnalysis.game.awayTeam,
                gameTime: detectedGame.commenceTime,
                pickType: 'game_specific',
                team: bestBet.team,
                betType: bestBet.betType,
                line: bestBet.line,
                odds: bestBet.bestPrice,
                consensusProbability: bestBet.eloProbability ? bestBet.eloProbability * 100 : 0,
                impliedProbability: bestBet.impliedProbability,
                edge: bestBet.edge,
                bestBook: bestBet.bestBook
              })
              console.log(`[chat] Tracked game analysis recommendation: ${bestBet.team} ${bestBet.betType}`)
            }
          } catch (trackErr) {
            console.error('[chat] Error tracking game analysis bet:', trackErr)
          }
        }
        
        // Generate conversational response using Elo data as source of truth
        console.log(`[chat] Generating conversational response for game analysis`)
        const conversationalResponse = await generateConversationalResponse(
          anthropic,
          eloAnalysisData,
          userMessageContent,
          conversationHistory
        )
        
        // Save messages to database
        await db.messages.create({
          conversationId: conversation.id,
          role: 'user',
          content: userMessage.content,
        })
        
        await db.messages.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: conversationalResponse,
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
        
        // Return conversational response
        return NextResponse.json({ 
          message: conversationalResponse,
          questionsRemaining: subStatus.isSubscribed 
            ? -1 
            : Math.max(0, subStatus.questionsRemaining - 1)
        })
      } catch (err) {
        console.error('[chat] Error running game analysis:', err)
        // Fall through to other detection methods if analysis fails
      }
    }
    
    // Check for parlay questions
    const parlayDetection = detectParlayQuestion(userMessageContent)
    if (parlayDetection) {
      const { legCount } = parlayDetection
      console.log(`[chat] Detected parlay question - ${legCount} legs requested`)
      try {
        // First try to compute enhanced parlay on-demand with requested leg count
        const espnOdds = await getCachedESPNOdds()
        
        if (espnOdds.games.length > 0) {
          // Convert ESPN odds to enriched games for parlay computation
          const enrichedGames = await convertESPNOddsToEnrichedGames(espnOdds)
          const bestBetResult = await computeBestBets(enrichedGames)
          
          if (bestBetResult.allEloBets && bestBetResult.allEloBets.length >= legCount) {
            // Compute enhanced parlay with requested leg count
            const enhancedParlay = computeEnhancedParlay(bestBetResult.allEloBets, legCount, true)
            
            if (enhancedParlay) {
              // Track each parlay leg for outcome tracking
              try {
                const existingPicks = await getAllPicks()
                for (const leg of enhancedParlay.legs) {
                  const alreadyTracked = existingPicks.some(p => 
                    p.gameId === leg.gameId && 
                    p.team === leg.team &&
                    p.betType === leg.betType &&
                    p.pickType === 'parlay_leg' &&
                    p.status === 'pending'
                  )
                  
                  if (!alreadyTracked) {
                    await storePick({
                      gameId: leg.gameId,
                      sport: leg.sport,
                      sportName: leg.sportName,
                      homeTeam: leg.homeTeam,
                      awayTeam: leg.awayTeam,
                      gameTime: leg.commenceTime,
                      pickType: 'parlay_leg',
                      team: leg.team,
                      betType: leg.betType,
                      line: leg.line,
                      odds: leg.bestPrice,
                      consensusProbability: leg.consensusProbability,
                      impliedProbability: leg.impliedProbability,
                      edge: leg.edge,
                      bestBook: leg.bestBook
                    })
                    console.log(`[chat] Tracked parlay leg: ${leg.team} ${leg.betType}`)
                  }
                }
              } catch (trackErr) {
                console.error('[chat] Error tracking parlay legs:', trackErr)
              }
              
              const eloAnalysisData = formatEnhancedParlayForContext(enhancedParlay)
              console.log(`[chat] Generating conversational response for ${legCount}-leg parlay with ${enhancedParlay.legs.length} legs`)
              
              // Generate conversational response using Elo data as source of truth
              const conversationalResponse = await generateConversationalResponse(
                anthropic,
                eloAnalysisData,
                userMessageContent,
                conversationHistory
              )
              
              // Save messages to database
              await db.messages.create({
                conversationId: conversation.id,
                role: 'user',
                content: userMessage.content,
              })
              
              await db.messages.create({
                conversationId: conversation.id,
                role: 'assistant',
                content: conversationalResponse,
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
              
              // Return conversational response
              return NextResponse.json({ 
                message: conversationalResponse,
                questionsRemaining: subStatus.isSubscribed 
                  ? -1 
                  : Math.max(0, subStatus.questionsRemaining - 1)
              })
            }
          }
        }
        
        // Fallback to cached parlay if enhanced parlay computation fails
        const parlay = await getCachedParlay()
        if (parlay && parlay.safeParlay && parlay.safeParlay.length > 0) {
          const hasEloData = parlay.safeParlay.some(leg => leg.eloProbability != null)
          const eloAnalysisData = formatParlayForContext(parlay)
          console.log(`[chat] Fallback: Using cached parlay with ${parlay.safeParlay.length} legs (Elo data: ${hasEloData})`)
          
          // Generate conversational response using Elo data as source of truth
          const conversationalResponse = await generateConversationalResponse(
            anthropic,
            eloAnalysisData,
            userMessageContent,
            conversationHistory
          )
          
          // Save messages to database
          await db.messages.create({
            conversationId: conversation.id,
            role: 'user',
            content: userMessage.content,
          })
          
          await db.messages.create({
            conversationId: conversation.id,
            role: 'assistant',
            content: conversationalResponse,
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
          
          // Return conversational response
          return NextResponse.json({ 
            message: conversationalResponse,
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
    
    // Check for PLAYER PROP questions (separate pipeline from team bets/Elo)
    // This runs AFTER game-specific and parlay detection, but BEFORE best bet detection
    // Player props use their own deterministic model - completely independent of the Elo system
    if (detectPlayerPropQuestion(userMessageContent)) {
      console.log(`[chat] Detected PLAYER PROP question - routing to prop analysis pipeline (separate from Elo/team bets)`)
      try {
        const propQuery = parsePlayerPropQuery(userMessageContent)
        console.log(`[chat] Parsed prop query: player="${propQuery.playerName}", stat=${propQuery.statType}, line=${propQuery.line}, direction=${propQuery.direction}`)
        
        let propAnalysisData: string
        
        if (propQuery.playerName) {
          const analysis = await analyzePlayerProp(propQuery)
          propAnalysisData = formatPropAnalysisForContext(analysis)
          console.log(`[chat] Player prop analysis complete for ${propQuery.playerName}: pick=${analysis.recommendation.pick}, confidence=${analysis.recommendation.confidence}`)
        } else {
          const bestProps = await analyzeBestProps({ sport: propQuery.sport || undefined, count: 3 })
          if (bestProps.length > 0) {
            propAnalysisData = formatMultiPropAnalysisForContext(bestProps)
            console.log(`[chat] Best props analysis complete: ${bestProps.length} props ranked`)
          } else {
            propAnalysisData = 'PLAYER PROP ANALYSIS\n\nNo player props data available at this time. Props are typically posted by sportsbooks in the morning/early afternoon for evening games. Please check back later.'
            console.log(`[chat] No props data available for analysis`)
          }
        }
        
        const conversationalResponse = await generateConversationalResponse(
          anthropic,
          propAnalysisData,
          userMessageContent,
          conversationHistory
        )
        
        await db.messages.create({
          conversationId: conversation.id,
          role: 'user',
          content: userMessage.content,
        })
        
        await db.messages.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: conversationalResponse,
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
          message: conversationalResponse,
          questionsRemaining: subStatus.isSubscribed 
            ? -1 
            : Math.max(0, subStatus.questionsRemaining - 1)
        })
      } catch (err) {
        console.error('[chat] Error processing player prop question:', err)
        const errorPropData = 'PLAYER PROP ANALYSIS\n\nI encountered an error analyzing this player prop. This is a prop-specific question (NOT a team Elo bet). Please tell the user you had trouble loading the prop data and suggest they try again in a moment or ask about a specific player name and stat (e.g. "Anthony Edwards over 25.5 points").'
        try {
          const errorResponse = await generateConversationalResponse(
            anthropic,
            errorPropData,
            userMessageContent,
            conversationHistory
          )
          
          await db.messages.create({ conversationId: conversation.id, role: 'user', content: userMessage.content })
          await db.messages.create({ conversationId: conversation.id, role: 'assistant', content: errorResponse })
          await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })
          
          if (!subStatus.isSubscribed) {
            const user = await db.users.findById(session.user.id)
            if (user) {
              await db.users.update(session.user.id, { questionCount: (user.questionCount || 0) + 1 })
            }
          }
          
          return NextResponse.json({ 
            message: errorResponse,
            questionsRemaining: subStatus.isSubscribed ? -1 : Math.max(0, subStatus.questionsRemaining - 1)
          })
        } catch (innerErr) {
          console.error('[chat] Failed to generate error response for prop question:', innerErr)
        }
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
          let sportBets = await getCachedSportBets()
          let allEloBetsForAlternatives: RankedBet[] = []  // Store all Elo bets for "what else?" follow-ups
          
          // FALLBACK: If cache is empty, compute sport bets on-demand from ESPN data
          if (!sportBets) {
            console.log(`[chat] Sport bets cache empty - computing on-demand for filter: ${bestBetFilter.filterDescription}`)
            try {
              const espnOdds = await getCachedESPNOdds()
              console.log(`[chat] ESPN odds fetched: ${espnOdds.games.length} total games`)
              
              // Log games by sport for debugging
              const gamesBySport: Record<string, number> = {}
              for (const g of espnOdds.games) {
                gamesBySport[g.league] = (gamesBySport[g.league] || 0) + 1
              }
              console.log(`[chat] Games by sport: ${JSON.stringify(gamesBySport)}`)
              
              if (espnOdds.games.length > 0) {
                // CRITICAL: Use enriched games with injury data for proper injury detection
                console.log(`[chat] Converting ESPN odds to enriched games with injury data...`)
                const todaysGames = await convertESPNOddsToEnrichedGames(espnOdds)
                
                // Log today's games by sport
                const todaysGamesBySport: Record<string, number> = {}
                for (const g of todaysGames) {
                  todaysGamesBySport[g.sportName] = (todaysGamesBySport[g.sportName] || 0) + 1
                }
                console.log(`[chat] Today's games by sport: ${JSON.stringify(todaysGamesBySport)}`)
                
                // Log NHL games specifically
                const nhlGames = todaysGames.filter(g => g.sportName === 'NHL')
                if (nhlGames.length > 0) {
                  console.log(`[chat] NHL games today: ${nhlGames.map(g => `${g.awayTeam} @ ${g.homeTeam}`).join(', ')}`)
                } else {
                  console.log(`[chat] NO NHL games found in today's games!`)
                }
                
                if (todaysGames.length > 0) {
                  console.log(`[chat] Computing sport bets from ${todaysGames.length} games today (with injury data)...`)
                  const bestBetResult = await computeBestBets(todaysGames)
                  // Store allEloBets for alternatives in follow-up questions
                  allEloBetsForAlternatives = bestBetResult.allEloBets || []
                  
                  // Log computeBestBets result
                  console.log(`[chat] computeBestBets result: gamesAnalyzed=${bestBetResult.gamesAnalyzed}, gamesQualified=${bestBetResult.gamesQualified}, allEloBets=${bestBetResult.allEloBets?.length || 0}`)
                  if (bestBetResult.reason) {
                    console.log(`[chat] computeBestBets reason: ${bestBetResult.reason}`)
                  }
                  
                  // Build sport bets structure from allEloBets (all Elo-powered bets)
                  // SportBestBets maps sport name to the BEST bet for that sport (not an array)
                  if (bestBetResult.allEloBets && bestBetResult.allEloBets.length > 0) {
                    // Log Elo bets by sport
                    const eloBetsBySport: Record<string, number> = {}
                    for (const bet of bestBetResult.allEloBets) {
                      eloBetsBySport[bet.sportName] = (eloBetsBySport[bet.sportName] || 0) + 1
                    }
                    console.log(`[chat] Elo bets by sport: ${JSON.stringify(eloBetsBySport)}`)
                    const tempSportBets: Record<string, RankedBet | null> = {}
                    for (const bet of bestBetResult.allEloBets) {
                      const sportName = bet.sportName
                      // Only keep the first (best) bet for each sport since allEloBets is sorted by score
                      if (!tempSportBets[sportName]) {
                        tempSportBets[sportName] = bet
                      }
                    }
                    sportBets = tempSportBets
                    console.log(`[chat] On-demand sport bets computed: ${Object.keys(sportBets).join(', ')}`)
                  }
                }
              }
            } catch (err) {
              console.error('[chat] Error computing sport bets on-demand:', err)
            }
          }
          
          if (sportBets) {
            const result = getFilteredBestBetWithElo(sportBets, bestBetFilter.excludeSports, bestBetFilter.includeSports)
            
            if (result.bet) {
              // Track this recommendation for outcome tracking
              // Only track if we haven't already tracked this exact bet today
              try {
                const existingPicks = await getAllPicks()
                const alreadyTracked = existingPicks.some(p => 
                  p.gameId === result.bet!.gameId && 
                  p.team === result.bet!.team &&
                  p.betType === result.bet!.betType &&
                  p.pickType === 'best_bet' &&
                  p.status === 'pending'
                )
                
                if (!alreadyTracked) {
                  await storePick({
                    gameId: result.bet.gameId,
                    sport: result.bet.sport,
                    sportName: result.bet.sportName,
                    homeTeam: result.bet.homeTeam,
                    awayTeam: result.bet.awayTeam,
                    gameTime: result.bet.commenceTime,
                    pickType: 'best_bet',
                    team: result.bet.team,
                    betType: result.bet.betType,
                    line: result.bet.line,
                    odds: result.bet.bestPrice,
                    consensusProbability: result.bet.consensusProbability,
                    impliedProbability: result.bet.impliedProbability,
                    edge: result.bet.edge,
                    bestBook: result.bet.bestBook
                  })
                  console.log(`[chat] Tracked sport-specific recommendation: ${result.bet.team} ${result.bet.betType}`)
                }
              } catch (trackErr) {
                console.error('[chat] Error tracking sport-specific bet:', trackErr)
              }
              
              // Get alternatives from allEloBets for "what else?" follow-up questions
              // Filter to same sport if sport-specific query, otherwise show all alternatives
              let alternatives: RankedBet[] = []
              if (allEloBetsForAlternatives.length > 0) {
                if (bestBetFilter.includeSports.length > 0) {
                  // Sport-specific query: show alternatives from same sport
                  alternatives = allEloBetsForAlternatives
                    .filter((b: RankedBet) => b.sportName === result.bet!.sportName && b !== result.bet)
                    .slice(0, 9)
                } else {
                  // General query: show all alternatives
                  alternatives = allEloBetsForAlternatives
                    .filter((b: RankedBet) => b !== result.bet)
                    .slice(0, 9)
                }
              }
              deterministicResponse = formatFilteredBestBetResponse(result.bet, bestBetFilter.filterDescription, alternatives)
              console.log(`[chat] Returning filtered best bet: ${result.bet.team} (${result.bet.sportName}) with ${alternatives.length} alternatives`)
            } else {
              deterministicResponse = result.message
              console.log(`[chat] No Elo-based bets available for filter: ${bestBetFilter.filterDescription}`)
            }
          } else {
            // Provide a clear, helpful message when Elo data is unavailable
            // This happens when the Elo cache hasn't been populated yet (needs backfill)
            deterministicResponse = `🏒 **${bestBetFilter.filterDescription || 'Sport'} Analysis Temporarily Unavailable**

Our Elo rating system is still building up historical data for accurate predictions. This happens when:
- The system is new and hasn't processed enough games yet
- The daily update hasn't run yet today

**What this means:** We won't show you a recommendation until we have real Elo data, because using default ratings would give you meaningless predictions (all teams would appear equal).

**Check back soon!** Our system updates daily with new game results, building more accurate team ratings over time.

If you're seeing this message persistently, please contact us at contact@betanalytics.ai.`
            console.log(`[chat] No sport bets available for filter: ${bestBetFilter.filterDescription} - Elo cache likely empty`)
          }
        } else {
          // CRITICAL FIX: Always compute on-demand with fresh injury data
          // The cached best bet may have been computed before injury data was available
          // This ensures we always have the latest injury information for recommendations
          console.log(`[chat] Computing best bets on-demand with fresh injury data...`)
          let bestBetResult: BestBetResult | null = null
          
          try {
            const espnOdds = await getCachedESPNOdds()
            if (espnOdds.games.length > 0) {
              // CRITICAL: Use enriched games with injury data for proper injury detection
              console.log(`[chat] Converting ESPN odds to enriched games with injury data...`)
              const todaysGames = await convertESPNOddsToEnrichedGames(espnOdds)
              
              if (todaysGames.length > 0) {
                console.log(`[chat] Computing best bets from ${todaysGames.length} games today (with injury data)...`)
                bestBetResult = await computeBestBets(todaysGames)
                // Cache the result for future requests (but we'll still recompute to ensure fresh injury data)
                await cacheBestBet(bestBetResult)
                console.log(`[chat] On-demand computation complete, cached for future requests`)
              }
            }
          } catch (err) {
            console.error('[chat] Error computing best bets on-demand:', err)
            // Fallback to cached result if on-demand computation fails
            console.log(`[chat] Falling back to cached best bet...`)
            bestBetResult = await getCachedBestBet()
          }
          
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
          // Generate conversational response using Elo data as source of truth
          console.log(`[chat] Generating conversational response for best bet question`)
          const conversationalResponse = await generateConversationalResponse(
            anthropic,
            deterministicResponse,
            userMessageContent,
            conversationHistory
          )
          
          // Save messages to database
          await db.messages.create({
            conversationId: conversation.id,
            role: 'user',
            content: userMessage.content,
          })
          
          await db.messages.create({
            conversationId: conversation.id,
            role: 'assistant',
            content: conversationalResponse,
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
          
          // Return conversational response
          return NextResponse.json({ 
            message: conversationalResponse,
            questionsRemaining: subStatus.isSubscribed 
              ? -1 
              : Math.max(0, subStatus.questionsRemaining - 1)
          })
        }
      } catch (err) {
        console.error('[chat] Error processing best bet question:', err)
        // CRITICAL: Do NOT fall through to LLM for betting questions
        // Return a proper error message instead of letting LLM generate potentially wrong data
        const errorMessage = `I encountered an error while processing your betting question. Please try again in a moment, or ask about a specific game or sport.\n\nError details: ${err instanceof Error ? err.message : 'Unknown error'}`
        
        await db.messages.create({
          conversationId: conversation.id,
          role: 'user',
          content: userMessage.content,
        })
        
        await db.messages.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: errorMessage,
        })
        
        await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })
        
        return NextResponse.json({ 
          message: errorMessage,
          questionsRemaining: subStatus.isSubscribed 
            ? -1 
            : Math.max(0, subStatus.questionsRemaining - 1)
        })
      }
    }
    
    // Game-specific detection already handled at the top of the function
    // CRITICAL: Check if this is a betting question that slipped through specific detectors
    // If so, use Elo-based best bet instead of falling through to LLM
    if (isBettingQuestion(userMessageContent)) {
      console.log(`[chat] Betting question detected by broad detector - using Elo-based best bet instead of LLM`)
      
      try {
        // Try to get the best bet with Elo data
        let bestBetResult = await getCachedBestBet()
        
        // FALLBACK: If cache is empty, compute best bets on-demand from ESPN data
        if (!bestBetResult) {
          console.log(`[chat] Cache empty for betting question fallback - computing on-demand...`)
          const espnOdds = await getCachedESPNOdds()
          if (espnOdds.games.length > 0) {
            // CRITICAL: Use enriched games with injury data for proper injury detection
            console.log(`[chat] Converting ESPN odds to enriched games with injury data...`)
            const todaysGames = await convertESPNOddsToEnrichedGames(espnOdds)
            
            if (todaysGames.length > 0) {
              console.log(`[chat] Computing best bets from ${todaysGames.length} games for betting question fallback (with injury data)...`)
              bestBetResult = await computeBestBets(todaysGames)
              await cacheBestBet(bestBetResult)
            }
          }
        }
        
        if (bestBetResult) {
          const eloAnalysisData = formatBestBetForContext(bestBetResult)
          console.log(`[chat] Generating conversational response for broad betting question`)
          
          // Generate conversational response using Elo data as source of truth
          const conversationalResponse = await generateConversationalResponse(
            anthropic,
            eloAnalysisData,
            userMessageContent,
            conversationHistory
          )
          
          // Save messages to database
          await db.messages.create({
            conversationId: conversation.id,
            role: 'user',
            content: userMessage.content,
          })
          
          await db.messages.create({
            conversationId: conversation.id,
            role: 'assistant',
            content: conversationalResponse,
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
          
          return NextResponse.json({ 
            message: conversationalResponse,
            questionsRemaining: subStatus.isSubscribed 
              ? -1 
              : Math.max(0, subStatus.questionsRemaining - 1)
          })
        } else {
          // No Elo data available - return clear message instead of LLM fallback
          const noDataMessage = `🎯 **Betting Analysis Temporarily Unavailable**

I detected your question is about betting, but our Elo rating system doesn't have data available right now.

**Why this happens:**
- The daily Elo update may not have run yet
- No games are scheduled for today
- The requested sport may not have Elo data yet

**What you can try:**
- Ask about a specific sport: "What's the best NBA bet today?"
- Ask about a specific game: "Lakers vs Celtics prediction"
- Check back in a few hours after our system updates

Our Elo ratings are our edge - we won't give you a recommendation without them.`
          
          console.log(`[chat] No Elo data available for betting question - returning no-data message`)
          
          await db.messages.create({
            conversationId: conversation.id,
            role: 'user',
            content: userMessage.content,
          })
          
          await db.messages.create({
            conversationId: conversation.id,
            role: 'assistant',
            content: noDataMessage,
          })
          
          await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })
          
          return NextResponse.json({ 
            message: noDataMessage,
            questionsRemaining: subStatus.isSubscribed 
              ? -1 
              : Math.max(0, subStatus.questionsRemaining - 1)
          })
        }
      } catch (err) {
        console.error('[chat] Error in betting question fallback:', err)
        const errorMessage = `I encountered an error while processing your betting question. Please try again in a moment, or ask about a specific game or sport.\n\nError details: ${err instanceof Error ? err.message : 'Unknown error'}`
        
        await db.messages.create({
          conversationId: conversation.id,
          role: 'user',
          content: userMessage.content,
        })
        
        await db.messages.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: errorMessage,
        })
        
        await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })
        
        return NextResponse.json({ 
          message: errorMessage,
          questionsRemaining: subStatus.isSubscribed 
            ? -1 
            : Math.max(0, subStatus.questionsRemaining - 1)
        })
      }
    }
    
    // If we reach here, it's NOT a betting question - use LLM for general questions
    console.log(`[chat] Non-betting question detected - using LLM`)
    
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

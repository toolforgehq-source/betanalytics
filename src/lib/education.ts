/**
 * Educational content system for daily betting lessons
 * 
 * Rotates through 7 different lessons, one for each day of the week.
 * Each lesson includes a title, short content, icon, and extended content.
 */

export interface Lesson {
  title: string
  content: string
  icon: string
  extendedContent: string
  commonMistakes: string[]
  howToApply: string[]
}

const lessons: Record<string, Lesson> = {
  monday: {
    title: "Bankroll Management",
    content: "Never bet more than 1-3% of your bankroll on a single game. Professional bettors use the Kelly Criterion to size bets based on edge. Even with a 60% win rate, betting too much can lead to ruin. Slow and steady wins the race.",
    icon: "💰",
    extendedContent: `Bankroll management is the foundation of successful sports betting. Without proper money management, even the best handicapper will eventually go broke.

The Kelly Criterion is a mathematical formula that determines the optimal bet size based on your edge. The formula is: (bp - q) / b, where b is the decimal odds minus 1, p is your probability of winning, and q is your probability of losing (1 - p).

For example, if you believe you have a 55% chance of winning a bet at -110 odds, the Kelly Criterion suggests betting about 5% of your bankroll. However, most professionals use "fractional Kelly" (1/4 to 1/2 of the suggested amount) to reduce variance.

The key insight is that your bet size should be proportional to your edge. Bigger edge = bigger bet. No edge = no bet. This prevents you from going broke during inevitable losing streaks while maximizing growth during winning streaks.`,
    commonMistakes: [
      "Betting the same amount on every game regardless of confidence",
      "Increasing bet size after losses to 'chase' money back",
      "Betting more than 5% of bankroll on any single game",
      "Not tracking bets and actual bankroll accurately"
    ],
    howToApply: [
      "Set a dedicated betting bankroll separate from other money",
      "Use 1-2% of bankroll for standard bets, 3% max for high confidence",
      "Track every bet in a spreadsheet with stake, odds, and result",
      "Review and adjust unit size monthly based on bankroll changes"
    ]
  },
  tuesday: {
    title: "Reading Line Movement",
    content: "When a line moves against public betting percentages, that's called reverse line movement. If 70% of bettors take Team A but the line moves toward Team B, sharp money is on Team B. This is one of the most reliable betting signals.",
    icon: "📊",
    extendedContent: `Line movement tells a story about where the smart money is going. Sportsbooks adjust lines based on betting action to balance their risk, but they pay special attention to bets from sharp bettors.

Reverse line movement (RLM) occurs when the line moves in the opposite direction of public betting. For example, if 75% of bets are on the Lakers -5, but the line moves to Lakers -4.5, that's RLM. The book is essentially saying "we're willing to take more Lakers bets at a better number" because sharp money came in on the other side.

Steam moves are sudden, significant line movements that happen across multiple sportsbooks simultaneously. These indicate coordinated sharp action and are among the strongest betting signals available.

Opening lines are set by the sharpest oddsmakers and represent the "true" line before public money distorts it. Comparing current lines to openers can reveal value.`,
    commonMistakes: [
      "Assuming all line movement is meaningful (sometimes it's just balancing)",
      "Chasing steam moves after the line has already moved significantly",
      "Ignoring the timing of line movement (early week vs game day)",
      "Not considering that some RLM is just sportsbook manipulation"
    ],
    howToApply: [
      "Track opening lines and compare to current lines before betting",
      "Look for RLM where 65%+ of public is on one side but line moves other way",
      "Pay attention to line movement timing - sharp money usually comes early",
      "Use multiple sportsbooks to spot steam moves quickly"
    ]
  },
  wednesday: {
    title: "Expected Value (EV)",
    content: "A bet with +EV means if you made it 1,000 times, you'd profit. A 55% chance to win at +110 odds has positive EV. Don't chase high win rates - chase +EV bets. One +EV bet at 45% can be better than a 65% bet at heavy juice.",
    icon: "📈",
    extendedContent: `Expected Value is the mathematical foundation of profitable betting. EV represents the average amount you expect to win or lose per bet if you made the same bet infinite times.

The formula is: EV = (Probability of Winning × Amount Won) - (Probability of Losing × Amount Lost)

For a -110 bet (risk $110 to win $100), you need to win 52.4% of the time to break even. Any win rate above that is +EV.

Here's the key insight: a 45% win rate at +150 odds is more profitable than a 60% win rate at -200 odds. The first has an EV of +12.5% per bet, while the second has an EV of -20% per bet.

Professional bettors don't care about win rate - they care about EV. A 40% win rate can be extremely profitable with the right odds, while a 70% win rate can be a losing strategy with bad odds.`,
    commonMistakes: [
      "Focusing on win rate instead of expected value",
      "Avoiding underdogs because they 'lose more often'",
      "Taking heavy favorites at bad odds just to 'get a win'",
      "Not calculating true probability before comparing to odds"
    ],
    howToApply: [
      "Calculate implied probability from odds (100 / (odds + 100) for positive odds)",
      "Estimate your true probability and compare to implied probability",
      "Only bet when your estimated probability exceeds implied probability",
      "Track your closing line value (CLV) to measure if you're finding +EV"
    ]
  },
  thursday: {
    title: "When to Hedge Parlays",
    content: "Hedging guarantees profit but reduces max payout. Hedge when: (1) Original bet has significant value, (2) You need guaranteed profit, (3) You're uncomfortable with risk. Don't hedge if you made a +EV bet and still believe in it.",
    icon: "🛡️",
    extendedContent: `Hedging is the practice of betting against your original position to guarantee profit or minimize loss. While it sounds smart, hedging is often mathematically incorrect.

The key principle: if your original bet was +EV, hedging it is -EV. You're essentially paying to reduce variance. Sometimes that's worth it, sometimes it's not.

When hedging makes sense:
- The hedge itself is +EV (rare but possible with line movement)
- The guaranteed profit is life-changing money
- You made the original bet recreationally and want to lock in profit
- Your bankroll can't handle the variance of letting it ride

When hedging doesn't make sense:
- You're a professional bettor focused on long-term EV
- The hedge odds are significantly worse than fair value
- You're hedging small amounts that don't impact your life

The middle ground: partial hedges. Instead of fully hedging, you can hedge a portion of your position to lock in some profit while maintaining upside.`,
    commonMistakes: [
      "Always hedging without calculating if it's mathematically correct",
      "Hedging at terrible odds just to 'guarantee something'",
      "Not considering the vig you're paying on the hedge bet",
      "Hedging bets that were +EV and still are +EV"
    ],
    howToApply: [
      "Calculate your guaranteed profit vs expected value of letting it ride",
      "Only hedge if the guaranteed amount is meaningful to you",
      "Shop for the best hedge odds across multiple sportsbooks",
      "Consider partial hedges to balance profit locking with upside"
    ]
  },
  friday: {
    title: "Weekend Betting Strategy",
    content: "Weekend games have the most public betting, which creates opportunities. Lines are sharpest on weekends, so edges are harder to find. Focus on player props and totals rather than spreads. Sharp money moves lines Thursday-Friday.",
    icon: "📅",
    extendedContent: `Weekend betting is different from weekday betting. The massive influx of recreational bettors changes market dynamics significantly.

Public money floods in on weekends, especially for primetime games. This creates two effects: (1) lines on popular sides get inflated, creating value on the other side, and (2) sportsbooks are more willing to take sharp action to balance their books.

The best weekend strategy is often to bet early in the week. Lines are set on Sunday/Monday and sharp money moves them throughout the week. By Friday, most of the value has been extracted. If you're betting on Saturday, you're often getting the worst of the number.

Player props and totals are often less efficient than spreads on weekends. Sportsbooks focus their sharpest lines on spreads and moneylines, leaving props with more exploitable edges.

Contrarian betting (fading the public) is most effective on weekends when public betting is heaviest. If 80% of bets are on one side, there's often value on the other.`,
    commonMistakes: [
      "Waiting until game day to place bets when lines are sharpest",
      "Following public consensus on primetime games",
      "Ignoring player props in favor of only betting spreads",
      "Not tracking where public money is going"
    ],
    howToApply: [
      "Place bets early in the week when you have an opinion",
      "Track public betting percentages and consider fading heavy public sides",
      "Focus on player props and totals where books are less sharp",
      "Be more selective on weekends - fewer bets, higher confidence"
    ]
  },
  saturday: {
    title: "Live Betting Opportunities",
    content: "Live betting lines lag behind game reality by 10-30 seconds. If you're watching, you can spot momentum shifts before odds adjust. Best opportunities: after big plays, during timeouts, after injuries. React fast but don't chase.",
    icon: "⚡",
    extendedContent: `Live betting (in-play betting) offers unique opportunities because lines are set by algorithms that can't fully account for game context and momentum.

The key advantage of live betting is information asymmetry. If you're watching the game closely, you can identify situations where the live line doesn't reflect reality:

- A team's star player is clearly injured but still on the court
- One team has completely changed their strategy and it's working
- Weather conditions have changed (wind, rain affecting outdoor sports)
- A team is dominating but hasn't scored due to bad luck

The 10-30 second lag in live odds creates windows of opportunity. After a big play, the algorithm adjusts slowly. If you can predict the adjustment direction, you can get value.

However, live betting is also dangerous. The fast pace encourages impulsive decisions, and the vig is typically higher than pre-game betting. Only live bet when you have a clear edge, not just because you're watching.`,
    commonMistakes: [
      "Chasing losses by live betting to 'get back' money",
      "Betting impulsively without a clear edge",
      "Not accounting for the higher vig on live bets",
      "Overreacting to single plays instead of game trends"
    ],
    howToApply: [
      "Only live bet games you're actively watching",
      "Wait for clear momentum shifts, not just single plays",
      "Have a pre-determined live betting bankroll separate from pre-game",
      "Focus on totals and player props where algorithms are weakest"
    ]
  },
  sunday: {
    title: "Parlay Correlation",
    content: "Avoid negatively correlated parlays. Don't bet Team A spread + Under in same game - if they cover, over is more likely. Positive correlation: Home underdog + Under often hit together. Same Game Parlays have correlation built into odds.",
    icon: "🔗",
    extendedContent: `Correlation in parlays refers to how the outcomes of different legs affect each other. Understanding correlation is crucial for building profitable parlays.

Negative correlation means if one leg hits, the other is less likely to hit. Example: Betting a team to cover a large spread AND the under in the same game. If a team covers by a lot, they probably scored a lot, making the over more likely.

Positive correlation means if one leg hits, the other is more likely to hit. Example: Betting a home underdog AND the under. Home underdogs often win low-scoring games where they control pace and limit possessions.

Same Game Parlays (SGPs) have correlation built into the odds. Sportsbooks adjust the payout to account for correlation, often giving you worse odds than a traditional parlay. However, they sometimes misprice correlation, creating opportunities.

The best parlay strategy is to find positively correlated legs that sportsbooks haven't fully accounted for. Cross-sport parlays have zero correlation, so they're priced fairly - no edge either way.`,
    commonMistakes: [
      "Building parlays with negatively correlated legs",
      "Assuming Same Game Parlays are always good value",
      "Not considering how game script affects multiple legs",
      "Adding legs just to increase payout without considering correlation"
    ],
    howToApply: [
      "Think through how each leg affects the others before building a parlay",
      "Look for positive correlation: underdog + under, favorite + over",
      "Compare SGP odds to what you'd get betting legs separately",
      "Keep parlays to 2-3 legs maximum for realistic win probability"
    ]
  }
}

/**
 * Get today's lesson based on current day of week
 */
export function getTodaysLesson(): Lesson {
  const dayIndex = new Date().getDay() // 0=Sunday, 1=Monday, etc
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayName = dayNames[dayIndex]
  return lessons[dayName]
}

/**
 * Get lesson for a specific day
 */
export function getLessonForDay(day: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'): Lesson {
  return lessons[day]
}

/**
 * Get all lessons
 */
export function getAllLessons(): Record<string, Lesson> {
  return lessons
}

/**
 * Get the current day name
 */
export function getCurrentDayName(): string {
  const dayIndex = new Date().getDay()
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return dayNames[dayIndex]
}

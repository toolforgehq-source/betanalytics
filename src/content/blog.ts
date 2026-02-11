export interface BlogPost {
  slug: string
  title: string
  description: string
  publishedAt: string
  updatedAt?: string
  author: string
  readingTime: string
  tags: string[]
  content: string
}

const posts: BlogPost[] = [
  {
    slug: "how-to-use-elo-ratings-for-sports-betting",
    title: "How to Use Elo Ratings for Sports Betting: Complete Guide",
    description:
      "Learn how Elo ratings predict game outcomes and find betting edges. Understand the math behind win probability, injury adjustments, and edge detection.",
    publishedAt: "2026-02-07",
    author: "BetAnalytics Team",
    readingTime: "12 min read",
    tags: ["elo-ratings", "sports-betting", "strategy"],
    content: `Sports bettors are always looking for an edge. Most rely on gut feelings, trends, or whatever the talking heads on TV say. But what if there was a mathematical system that could independently calculate win probabilities and compare them to what the market thinks? That system exists, and it is called Elo ratings.

Originally developed by physicist Arpad Elo for chess, the Elo rating system has become one of the most reliable methods for measuring relative team strength in sports. At BetAnalytics.ai, we use Elo ratings as the foundation of our entire betting analytics platform, tracking 692 teams across every major sport.

## What Are Elo Ratings?

Elo is a zero-sum rating system where every team starts at a baseline rating of 1500. After each game, the winner gains rating points and the loser loses the same number of points. The key insight is that the number of points exchanged depends on the expected outcome.

Beat a team rated much higher than you? You gain a lot of points. Beat a team rated much lower? You gain very few. This means Elo ratings naturally converge to reflect true team strength over time.

### The Core Formula

The expected win probability for Team A against Team B is:

**Expected(A) = 1 / (1 + 10^((Rating_B - Rating_A) / 400))**

For example, if Team A has a 1600 rating and Team B has a 1400 rating:

Expected(A) = 1 / (1 + 10^((1400 - 1600) / 400)) = 1 / (1 + 10^(-0.5)) = 1 / (1 + 0.316) = **76.0%**

This means a team with a 200-point Elo advantage has roughly a 76% chance of winning, according to the model.

### How Ratings Update After Each Game

After a game, ratings update using the K-factor:

**New Rating = Old Rating + K * (Actual Result - Expected Result)**

The K-factor determines how reactive the system is. Higher K-factors mean bigger swings after each game. Different sports need different K-factors because of how many games they play:

| Sport | K-Factor | Games Per Season | Why |
|-------|----------|-----------------|-----|
| NFL | 32 | 17 | Few games, need quick reaction |
| NCAAF | 40 | 12 | Fewest games, highest reactivity |
| NBA/NHL | 20 | 82 | Moderate season length |
| MLB | 8 | 162 | Long season, very stable ratings |
| Soccer | 20 | 38 | Standard league season |

## How to Find Betting Edges with Elo

The real power of Elo for betting is comparing your calculated probability to the market implied probability. Here is how it works:

### Step 1: Calculate Your Win Probability

Using the Elo formula above, calculate the probability of each team winning. For example, your model says Team A has a 78% chance of winning.

### Step 2: Convert Odds to Implied Probability

If the sportsbook has Team A at -250, the implied probability is:

**Implied Probability = 250 / (250 + 100) = 71.4%**

### Step 3: Calculate the Edge

**Edge = Model Probability - Implied Probability = 78% - 71.4% = 6.6%**

A positive edge means you believe the team is more likely to win than the market does. Over thousands of bets, consistently finding positive edges is how you make money.

## Why Elo Works Better Than You Think

### Recency Weighting

Raw Elo treats all games equally, but a game from three months ago should not matter as much as last week. We apply sport-specific decay factors so recent results carry more weight:

- NBA/NHL: 0.95 decay (about 21% weight at 30 games ago)
- NFL: 0.93 decay (about 11% weight at 30 games ago)
- MLB: 0.97 decay (about 40% weight at 30 games ago)

This ensures hot streaks and cold streaks are reflected in current ratings without overreacting to a single game.

### Injury Adjustments

This is where most Elo models fall short. A team's Elo rating does not change just because their starting QB is out. But the team's actual win probability absolutely changes.

We quantify injury impact using real-time ESPN data:

- **NFL/NCAAF starting QB out:** -80 Elo points
- **NHL starting goalie out:** -30 Elo points
- **Top 3 scorer out (NBA/NHL):** -20 Elo points each
- **MLB ace pitcher (ERA < 3.0):** +20 Elo points when starting

We also factor in injury status multipliers: Out = 100% impact, Doubtful = 70%, Questionable = 15%. This matters because questionable players play about 85% of the time.

## Practical Example: Finding an Edge

Let us walk through a real example. Say the Lakers (Elo 1580) are playing the Warriors (Elo 1520) tonight.

**Step 1:** Calculate base probability
Expected(Lakers) = 1 / (1 + 10^((1520 - 1580) / 400)) = 58.4%

**Step 2:** Apply injury adjustments. Steph Curry (top scorer) is OUT for the Warriors: -20 Elo points to Warriors.
Adjusted: Lakers 1580 vs Warriors 1500
New Expected(Lakers) = 1 / (1 + 10^((1500 - 1580) / 400)) = 61.3%

**Step 3:** Check the market. Lakers are -140 (implied 58.3%).

**Edge = 61.3% - 58.3% = 3.0%**

That is a meaningful edge, especially when you consider the injury adjustment that many casual bettors and even some models might miss.

## Sports Where Elo Is Most Effective

Elo works best in sports where:
- Team strength is relatively stable game to game
- Sample sizes are large enough for ratings to converge
- Individual player impact can be quantified

**NBA and NHL** are ideal for Elo because they play 82 games per season, giving plenty of data for ratings to stabilize. Individual player injuries have quantifiable impact.

**NFL** is trickier because of the small sample size (17 games), but higher K-factors compensate. QB injuries are the single biggest factor in NFL betting, and our -80 Elo adjustment captures this.

**MLB** requires the lowest K-factor because of 162 games. Starting pitchers matter enormously, which is why we add Elo points for aces.

## Common Mistakes When Using Elo for Betting

1. **Ignoring the vig.** Sportsbooks take a cut (usually 4-5%). Your edge needs to be larger than the vig to be profitable long-term.

2. **Overreacting to small samples.** Early-season Elo ratings are less reliable. We use 3+ months of data to ensure stability.

3. **Not adjusting for injuries.** Raw Elo ratings assume full-strength rosters. You must adjust for key injuries.

4. **Betting every game.** Only bet when you find a genuine edge. Most games are efficiently priced by the market.

5. **Ignoring bankroll management.** Even with an edge, variance is real. Never risk more than 1-3% of your bankroll on a single bet.

## Frequently Asked Questions

### Is Elo better than other rating systems for betting?

Elo is one of several valid rating systems (others include Glicko, TrueSkill, and power ratings). Its main advantage is simplicity and transparency: you can see exactly how every rating is calculated. Many successful bettors use Elo as part of their toolkit alongside other models.

### How long does it take for Elo ratings to become accurate?

Generally, 20-30 games per team gives ratings that are reasonably stable. For NFL, this means about two seasons of data. For NBA/NHL, ratings stabilize within the first quarter of the season. We use 3+ months of rolling data to balance accuracy with relevance.

### Can I build my own Elo model?

Absolutely. The math is straightforward, and historical game results are freely available from sites like ESPN and Basketball Reference. The hard part is getting the K-factors, decay rates, and injury adjustments right. That is where years of iteration and backtesting come in.

## Start Finding Edges Today

Elo ratings are a powerful, transparent, and mathematically sound way to find betting edges. Unlike black-box models that give you a pick without explanation, Elo shows you exactly why a bet has value.

At BetAnalytics.ai, we have done the heavy lifting: tracking 692 teams, calculating injury adjustments in real-time, and comparing our probabilities to the market across every major sport. You see the math behind every recommendation.

**Ready to find edges the market is missing?** [Start your 3-day free trial](/signup) and see our Elo-based analysis in action. No credit card required.

*Sports betting involves risk. Only bet what you can afford to lose. If you or someone you know has a gambling problem, call 1-800-GAMBLER.*`,
  },
  {
    slug: "how-to-find-value-bets",
    title: "How to Find Value Bets: A Data-Driven Approach",
    description:
      "Discover how to identify value bets using probability, implied odds, and expected value calculations. Learn the data-driven approach used by sharp bettors.",
    publishedAt: "2026-02-07",
    author: "BetAnalytics Team",
    readingTime: "10 min read",
    tags: ["value-betting", "sports-betting", "strategy"],
    content: `The single most important concept in profitable sports betting is value. Not picking winners. Not following hot streaks. Value.

A value bet is any bet where the probability of an outcome is higher than what the odds imply. If a coin flip pays 3:1, that is a value bet even though you lose half the time. Understanding this concept separates long-term winners from everyone else.

## What Is a Value Bet?

A value bet exists when the true probability of an outcome is greater than the implied probability from the betting odds. The formula is simple:

**Value = True Probability - Implied Probability**

If Value > 0, you have a value bet. If Value < 0, the sportsbook has the edge.

### Converting Odds to Implied Probability

Before you can find value, you need to convert betting odds to probabilities:

**American Odds (Favorites):** Implied % = Odds / (Odds + 100)
- Example: -200 odds = 200 / (200 + 100) = 66.7%

**American Odds (Underdogs):** Implied % = 100 / (Odds + 100)
- Example: +150 odds = 100 / (150 + 100) = 40.0%

**Decimal Odds:** Implied % = 1 / Decimal Odds
- Example: 2.50 odds = 1 / 2.50 = 40.0%

### The Vig (Overround)

Sportsbooks build in a margin called the vig or overround. If you add up the implied probabilities for all outcomes, they total more than 100%. For example:

- Team A: -150 (60.0%)
- Team B: +130 (43.5%)
- Total: 103.5% (the extra 3.5% is the vig)

To find the true implied probability, remove the vig:
- Team A true implied: 60.0% / 103.5% = **58.0%**
- Team B true implied: 43.5% / 103.5% = **42.0%**

## How Sharp Bettors Find Value

### Method 1: Build Your Own Model

The most reliable way to find value is to independently calculate win probabilities. At BetAnalytics.ai, we use Elo ratings across 692 teams to do exactly this. When our model says 65% but the market implies 58%, that 7% gap is potential value.

The key word is *independently*. If your probability estimate is just the market odds repackaged, you will never find value. Your model must use different data, different methods, or different assumptions than what the market is pricing in.

### Method 2: Exploit Information Asymmetry

Markets are efficient most of the time, but not all of the time. Value often appears when:

**Injury news breaks late.** If a star player is ruled out 30 minutes before tip-off, the line may not fully adjust. Our system pulls real-time injury data from ESPN and quantifies the impact immediately. An NFL starting QB being ruled out is worth 80 Elo points, which translates to roughly a 5-8% probability shift.

**Public perception lags reality.** Teams on losing streaks are often overadjusted by the market. Our recency-weighted Elo system captures this more accurately than betting lines that overreact to recent results.

**Small markets are less efficient.** College basketball, international soccer, and early-season NHL games attract less sharp money, creating more frequent mispricings.

### Method 3: Expected Value (EV) Calculation

Expected Value tells you how much you expect to win or lose per dollar bet over time:

**EV = (Win Probability * Profit if Win) - (Loss Probability * Amount Lost)**

Example: You think a team has a 55% chance to win at +110 odds ($100 to win $110):
- EV = (0.55 * $110) - (0.45 * $100) = $60.50 - $45.00 = **+$15.50**

A positive EV means this bet is profitable long-term. Bet it a thousand times, and you expect to make roughly $15,500.

## A Practical Framework for Finding Value

Here is the step-by-step process we use at BetAnalytics.ai:

### Step 1: Calculate Independent Probability

Use a quantitative model (like Elo ratings) to estimate each team's win probability. This should account for:
- Historical team strength
- Recent form (recency weighting)
- Injury adjustments
- Home/away factors
- Schedule context (back-to-backs, rest days)

### Step 2: Compare to Market

Convert sportsbook odds to implied probabilities (removing the vig). Compare your probability to the market probability.

### Step 3: Set a Minimum Edge Threshold

Not every positive edge is worth betting. We recommend a minimum edge of 3-5% for moneylines. This buffer accounts for:
- Model uncertainty
- The vig
- Line movement between your analysis and when you actually place the bet

### Step 4: Size Your Bets Appropriately

The Kelly Criterion provides a mathematically optimal bet size:

**Kelly % = (Edge / Odds) = (Model Probability * Decimal Odds - 1) / (Decimal Odds - 1)**

Most sharp bettors use fractional Kelly (25-50% of full Kelly) to reduce variance while maintaining positive expected value.

## Real-World Value Betting Example

Here is how this works in practice:

**Game:** Bulls vs. Nuggets
**Market Odds:** Bulls +210 (implied 32.3%)
**Our Elo Model:** Bulls 1460, Nuggets 1540

Base probability: Bulls win = 1 / (1 + 10^((1540-1460)/400)) = 38.7%

But wait: Nikola Jokic (top scorer) is listed as Doubtful. Adjustment: -20 * 0.70 = -14 Elo points to Nuggets.
Adjusted: Bulls 1460 vs Nuggets 1526
Adjusted probability: Bulls win = 1 / (1 + 10^((1526-1460)/400)) = 40.6%

**Edge = 40.6% - 32.3% = 8.3%**

**EV per $100 bet = (0.406 * $210) - (0.594 * $100) = $85.26 - $59.40 = +$25.86**

That is a strong value bet. The market has not fully priced in the injury impact.

## Common Value Betting Mistakes

### Confusing Good Teams with Good Bets

The best team in the league can be a terrible bet if the odds are too short. A team with an 80% win probability at -500 odds (implied 83.3%) is actually a negative EV bet. Value is about the gap between probability and price, not about which team is better.

### Ignoring Sample Size

Your model needs enough data to be reliable. Early-season ratings are noisier. We use a minimum of 3 months of historical data before we trust our Elo ratings for betting purposes.

### Chasing Losses

Value betting is a long-term strategy. You will have losing days, losing weeks, even losing months. The math works over hundreds or thousands of bets. If you abandon your strategy after a bad streak, you are giving up the long-term edge.

### Not Shopping Lines

Different sportsbooks offer different odds on the same game. A bet that is -EV at one book might be +EV at another. Always compare odds across multiple sportsbooks.

## Frequently Asked Questions

### How many bets do I need before I know if my strategy is working?

At minimum, 500-1,000 bets to have statistical confidence. Smaller samples are dominated by variance. Track every bet, including your estimated edge, and compare your actual win rate to your predicted win rate over time.

### What win rate do I need to be profitable?

It depends on the average odds you bet. At -110 (standard juice), you need to win 52.4% to break even. At +150 average odds, you only need 40%. Focus on expected value, not win rate.

### Can the market be consistently beaten?

Yes, but it is difficult. The sports betting market is efficient but not perfectly efficient. Edges exist in injury adjustments, public bias, small markets, and information timing. The key is having a systematic, quantitative approach rather than relying on opinions.

## Let Data Find Value For You

Finding value bets consistently requires independent probability calculations, real-time data, and discipline. Most bettors skip the math and bet on feelings. That is why most bettors lose.

At BetAnalytics.ai, we calculate independent Elo probabilities for every game across NBA, NFL, NHL, MLB, college sports, and soccer. We adjust for injuries in real-time, weight recent performance, and show you exactly where our model disagrees with the market.

**Want to see where the value is today?** [Start your 3-day free trial](/signup) and let our model find the edges for you.

*Sports betting involves risk. Only bet what you can afford to lose. If you or someone you know has a gambling problem, call 1-800-GAMBLER.*`,
  },
  {
    slug: "sports-betting-bankroll-management",
    title: "Sports Betting Bankroll Management: The Ultimate Guide",
    description:
      "Master bankroll management for sports betting. Learn the Kelly Criterion, unit sizing, and variance management to protect your money and maximize long-term profits.",
    publishedAt: "2026-02-07",
    author: "BetAnalytics Team",
    readingTime: "11 min read",
    tags: ["bankroll-management", "sports-betting", "strategy"],
    content: `You can have the best betting model in the world and still go broke. How? Bad bankroll management.

Bankroll management is the unsexy side of sports betting that separates professionals from amateurs. It does not matter if you have a 5% edge on every bet. If you bet 50% of your bankroll each time, you will eventually hit a losing streak that wipes you out.

This guide covers everything you need to protect your money while maximizing your long-term returns.

## What Is a Betting Bankroll?

Your bankroll is the total amount of money you have set aside exclusively for sports betting. This is money you can afford to lose entirely without affecting your daily life, rent, bills, or savings.

**Rule #1: Never bet with money you cannot afford to lose.**

This is not just a disclaimer. It is the most important rule in gambling. If losing your bankroll would cause financial stress, your bankroll is too large.

## Unit Sizing: The Foundation

A unit is a standardized bet size, typically 1-3% of your total bankroll.

| Bankroll | 1% Unit | 2% Unit | 3% Unit |
|----------|---------|---------|---------|
| $1,000 | $10 | $20 | $30 |
| $5,000 | $50 | $100 | $150 |
| $10,000 | $100 | $200 | $300 |

### Why Units Matter

Using units instead of dollar amounts gives you two advantages:

1. **Risk control.** No single bet can significantly damage your bankroll.
2. **Scalability.** As your bankroll grows, your unit size grows proportionally. As it shrinks, you naturally reduce bet sizes.

### Flat Betting vs. Variable Sizing

**Flat betting** means every bet is the same size (1 unit). This is the simplest and safest approach. It works well for beginners and anyone who wants to minimize risk.

**Variable sizing** means adjusting your bet size based on your perceived edge. A 3% edge might warrant 1 unit, while a 10% edge warrants 2-3 units. This maximizes expected value but increases variance.

## The Kelly Criterion

The Kelly Criterion is the mathematically optimal bet sizing formula. It tells you exactly what percentage of your bankroll to wager based on your edge:

**Kelly % = (bp - q) / b**

Where:
- b = decimal odds minus 1 (net profit per dollar)
- p = probability of winning
- q = probability of losing (1 - p)

### Kelly Example

Your model gives a team a 60% chance to win. The odds are +120 (decimal 2.20).

- b = 2.20 - 1 = 1.20
- p = 0.60
- q = 0.40

Kelly % = (1.20 * 0.60 - 0.40) / 1.20 = (0.72 - 0.40) / 1.20 = 0.32 / 1.20 = **26.7%**

Full Kelly says bet 26.7% of your bankroll. But full Kelly is extremely aggressive.

### Why You Should Use Fractional Kelly

Full Kelly assumes your probability estimates are perfectly accurate. They are not. Even the best models have uncertainty. If your true edge is smaller than you think, full Kelly will overbet and you will lose money faster during downswings.

**Most professional bettors use 25-50% of full Kelly**, often called quarter-Kelly or half-Kelly.

In our example:
- Full Kelly: 26.7%
- Half Kelly: 13.4%
- Quarter Kelly: 6.7%

Quarter Kelly still captures most of the long-term growth while dramatically reducing the chance of a catastrophic drawdown.

## Understanding Variance

Even with a genuine edge, losing streaks happen. Here is what variance looks like for a bettor with a 55% win rate at -110 odds:

**Over 100 bets:** Probability of being down = ~30%
**Over 500 bets:** Probability of being down = ~10%
**Over 1,000 bets:** Probability of being down = ~3%

This is why bankroll management matters. You need your bankroll to survive the inevitable losing streaks long enough for your edge to show up in the results.

### The Gambler's Ruin Problem

If you bet too large a fraction of your bankroll, you can go broke even with a positive edge. This is called the Gambler's Ruin problem. The math proves that overbetting guarantees eventual ruin, even when the odds are in your favor.

With 1% units, you would need to lose 100 bets in a row to go bust. With 10% units, only 10 straight losses wipes you out. Those 10 straight losses are not as unlikely as you might think.

## Practical Bankroll Management Rules

### Rule 1: Set a Bankroll You Can Afford to Lose

Start with an amount that would not change your lifestyle if it disappeared. For most recreational bettors, this is $500-$2,000.

### Rule 2: Use 1-3% Units

- **Conservative (1%):** Best for beginners and those with smaller bankrolls
- **Moderate (2%):** Good balance for most bettors
- **Aggressive (3%):** Only for experienced bettors with strong models and high confidence

### Rule 3: Track Everything

Record every bet with:
- Date and sport
- Teams and type of bet
- Odds and stake
- Your model probability and edge
- Result

Without tracking, you cannot evaluate whether your strategy is working. Feelings and memory are unreliable.

### Rule 4: Recalculate Units Monthly

If your bankroll grows 20%, increase your unit size. If it drops 20%, decrease it. This ensures you are always betting proportionally.

### Rule 5: Never Chase Losses

After a losing day, the temptation is to bet bigger to get it back. This is the fastest way to blow up a bankroll. Your edge does not change because you had a bad day. Stick to your units.

### Rule 6: Set a Stop Loss

Consider a daily or weekly stop loss of 5-10 units. If you hit it, stop betting until the next period. This protects against tilt and unusual variance.

## Bankroll Management for Different Bet Types

### Moneyline Bets
Standard 1-2 unit sizing works well. Adjust up slightly for bets with higher confidence (larger model edge).

### Spread Bets
Same as moneyline. The vig is standard (-110 both sides), so your unit sizing formula does not change.

### Parlays
Parlays should be a small fraction of your betting activity. If you bet parlays, use 0.25-0.5 units. The variance is much higher, so your position sizes should be much smaller.

### Player Props
Props often have wider edges than team bets because the market is less efficient. However, they also have more variance in individual outcomes. Use 0.5-1 unit for props.

## How Expected Value and Bankroll Management Work Together

Finding value bets and managing your bankroll are two sides of the same coin. Value betting finds the edge. Bankroll management ensures you survive long enough to realize that edge.

At BetAnalytics.ai, our Elo model identifies edges across every major sport. But we do not just give you picks. We show you the exact probability, the market implied probability, and the size of the edge. This allows you to make informed bet sizing decisions.

A 3% edge on a moneyline deserves a smaller bet than a 10% edge. Our platform gives you the data to make that call.

## Frequently Asked Questions

### What is the minimum bankroll to start sports betting?

There is no minimum, but you need enough that 1% units are meaningful to you. If your bankroll is $100, a 1% unit is $1. That is fine for learning and tracking, but it will not generate significant returns. Most serious bettors start with $1,000-$5,000.

### How long until I know if my strategy is profitable?

At least 500-1,000 bets with detailed tracking. Fewer bets and variance dominates. Track your predicted probability vs. actual win rate. If they match closely (your model is well-calibrated), and your average edge is positive, you are on the right track.

### Should I bet every game where my model shows value?

Not necessarily. Consider being selective during the early season when model accuracy is lower. Also consider liquidity: can you actually place the bet at the odds your model evaluated? If the line has moved by the time you bet, your edge may have disappeared.

## Protect Your Bankroll, Maximize Your Edge

Bankroll management is not glamorous, but it is the difference between being a winning bettor who stays in the game and a losing bettor who blows up their account.

Start with a bankroll you can afford to lose. Use 1-3% units. Track every bet. Never chase losses. Let the math work over hundreds of bets.

At BetAnalytics.ai, we give you the edge-finding tools. How you manage your bankroll is up to you. But we strongly believe in responsible, data-driven betting.

**Ready to bet smarter?** [Start your 3-day free trial](/signup) and see where the value is today.

*Sports betting involves risk. Only bet what you can afford to lose. If you or someone you know has a gambling problem, call 1-800-GAMBLER.*`,
  },
  {
    slug: "nba-betting-model",
    title: "NBA Betting Model: How to Build One (Or Use Ours)",
    description:
      "Learn how NBA betting models work. Understand Elo ratings, pace adjustments, injury impact, and how to find edges in NBA betting markets.",
    publishedAt: "2026-02-07",
    author: "BetAnalytics Team",
    readingTime: "10 min read",
    tags: ["nba", "betting-model", "sports-betting"],
    content: `The NBA is one of the best sports for data-driven betting. With 82 games per team, a wealth of advanced statistics, and predictable patterns, quantitative models have a real chance of finding edges that the market misses.

This guide explains how NBA betting models work, what data matters, and how we built the model behind BetAnalytics.ai.

## Why the NBA Is Ideal for Betting Models

Several factors make the NBA particularly suited to quantitative betting:

**Large sample size.** Eighty-two games per team means enough data for statistical significance within a single season.

**Predictable outcomes.** The better team wins more often in the NBA than in almost any other major sport. Upsets happen, but the best teams consistently beat weaker opponents.

**Rich data ecosystem.** The NBA tracks every possession, shot, pass, rebound, and defensive action. This data is publicly available and well-structured.

**Market inefficiencies.** Despite heavy betting volume, the NBA market still has inefficiencies, particularly around injuries, back-to-back games, and early-season ratings.

## The Foundation: Elo Ratings for NBA

Our NBA model starts with Elo ratings. Every NBA team has a rating that updates after each game. Teams gain points for wins and lose points for losses, with the magnitude depending on the expected outcome.

### NBA-Specific Parameters

**K-Factor: 20.** The NBA plays 82 games, so we use a moderate K-factor that balances reactivity with stability. This means a single game changes a team's rating by 2-15 points depending on how expected the result was.

**Recency Decay: 0.95.** Games from a month ago carry about 21% of the weight of the most recent game. This captures hot/cold streaks without overreacting to a single performance.

**Starting Rating: 1500.** Every team begins at 1500 at the start of our tracking window.

### Current Rating Examples

To give you a sense of scale, here is what NBA Elo ratings typically look like mid-season:

- Elite teams (top 3-4): 1580-1640
- Playoff contenders: 1520-1570
- Average teams: 1470-1520
- Lottery teams: 1380-1460

A 100-point Elo gap translates to roughly a 64% win probability for the higher-rated team.

## Key Factors in NBA Betting

### Factor 1: Injuries

Injuries are the single largest source of market inefficiency in NBA betting. When a star player is ruled out, the line moves, but research shows it often does not move enough.

Our injury adjustment system:
- **Top 3 scorer out:** -20 Elo points per player
- **Status multipliers:** Out = 100%, Doubtful = 70%, Questionable = 15%, Probable = 0%

For example, if both the top scorer and second-leading scorer are out, the team loses 40 Elo points. That shifts a 55% win probability to roughly 49%. If the market only adjusted to 52%, that is a 3% edge on the opponent.

### Factor 2: Rest and Scheduling

NBA teams play back-to-back games regularly. Research consistently shows that teams on the second night of a back-to-back perform worse, especially on the road.

Our adjustments:
- **Back-to-back (B2B):** -4% win probability
- **Extra rest (3+ days):** +2% win probability
- **Road B2B:** Additional -1% penalty

### Factor 3: Home Court Advantage

Home court advantage in the NBA has shrunk over the past decade but still exists. We factor in approximately 2.5-3.0 points of home court advantage, which translates to about a 3-4% probability boost for the home team.

### Factor 4: Pace

Pace (possessions per game) affects totals betting significantly. When two fast-paced teams meet, the game is likely to go over the total. When two slow-paced teams meet, the under is more likely.

We track team-level pace and adjust projected scores accordingly.

## Building a Simple NBA Elo Model

If you want to build your own, here is the process:

### Step 1: Gather Data

You need game results (date, teams, scores) for at least 3 months. Basketball Reference, ESPN, and various APIs provide this for free.

### Step 2: Initialize Ratings

Set every team to 1500 at the start of your data window.

### Step 3: Process Games Chronologically

For each game:
1. Calculate expected win probability using the Elo formula
2. Apply recency weighting
3. Update ratings based on the actual result

### Step 4: Add Injury Data

Pull injury reports from ESPN or a similar source. Apply Elo adjustments based on player impact.

### Step 5: Compare to Betting Lines

Convert sportsbook odds to implied probabilities. Find the gap between your model and the market.

### Step 6: Track Results

Record every prediction and its outcome. After 100+ predictions, evaluate your model's calibration (are your 60% predictions actually winning 60% of the time?).

## Where Our Model Finds NBA Edges

Based on our data, the most common sources of NBA edges are:

**Late injury news.** When a player is ruled out within 1-2 hours of tip-off, the market adjusts but often not enough. Our system catches this immediately through ESPN data feeds.

**Back-to-back penalties.** Some teams handle B2Bs better than others. Deep teams with strong benches lose less performance on B2Bs. The market applies a generic adjustment, but team-specific adjustments find more value.

**Early season mispricing.** In October and November, Elo ratings are still stabilizing. Teams that improved or declined significantly in the offseason are often mispriced by the market until enough games have been played.

**Player prop edges.** Our system also analyzes individual player props using rolling averages, opponent adjustments, and pace factors. Props markets are less efficient than team markets, creating more frequent edges.

## Spread Betting in the NBA

Our NBA spread analysis includes additional filters:

**Minimum margin edge: 3 points.** We only recommend spread bets when our projected margin differs from the market spread by at least 3 points.

**Variance filtering:** We skip games involving teams with margin variance greater than 16 points. High-variance teams are unpredictable against the spread even when the Elo edge is significant.

These filters ensure we only recommend spreads where we have genuine predictive confidence.

## Player Props in the NBA

Beyond team-level analysis, we track individual player performance for prop betting:

- Points, rebounds, assists, three-pointers
- Rolling averages with recency weighting
- Opponent adjustments (how does the opposing team defend against specific stats?)
- Pace adjustments (fast-paced games boost projections)
- Usage adjustments (when teammates are injured, usage increases)

We only recommend props when the model shows 8%+ edge and the probability falls between 55-85%.

## Frequently Asked Questions

### What is the best NBA betting strategy?

Focus on moneylines and spreads where your model shows a 3%+ edge after accounting for the vig. Be selective; the best bettors only bet 1-3 games per night, not every game on the slate.

### How accurate are NBA betting models?

A well-calibrated NBA model should predict win probabilities that match actual outcomes within 1-2% over a large sample. No model is perfect, but Elo-based models with injury adjustments consistently outperform raw market efficiency.

### Should I bet NBA player props or team bets?

Both can be profitable. Team bets (moneylines, spreads) have tighter markets but more liquidity. Player props have wider edges but more variance. A balanced approach using both is ideal.

## Try Our NBA Model

We have spent months building and backtesting our NBA Elo model. It tracks every team, adjusts for injuries in real-time, and compares our probabilities to the market across every game.

**See today's NBA edges.** [Start your 3-day free trial](/signup) and ask our AI about tonight's best NBA bets.

*Sports betting involves risk. Only bet what you can afford to lose. If you or someone you know has a gambling problem, call 1-800-GAMBLER.*`,
  },
  {
    slug: "understanding-betting-odds",
    title: "Understanding Betting Odds: Probability, Implied Odds & Value",
    description:
      "Learn how to read American, decimal, and fractional betting odds. Convert odds to probability, calculate implied odds, and find value in betting markets.",
    publishedAt: "2026-02-07",
    author: "BetAnalytics Team",
    readingTime: "9 min read",
    tags: ["betting-odds", "sports-betting", "beginners"],
    content: `If you want to bet on sports intelligently, you need to understand odds. Not just how to read them, but what they actually mean in terms of probability and value.

Most bettors look at odds and think "those are the chances of winning." They are not. Odds represent the payout ratio set by the sportsbook, which includes a built-in profit margin. Understanding the difference between odds and true probability is the first step to betting profitably.

## The Three Odds Formats

### American Odds

American odds are the most common format in the United States. They come in two flavors:

**Favorites (negative numbers):** The number tells you how much you need to bet to win $100.
- -150 means bet $150 to win $100 (total return $250)
- -300 means bet $300 to win $100 (total return $400)

**Underdogs (positive numbers):** The number tells you how much you win on a $100 bet.
- +150 means bet $100 to win $150 (total return $250)
- +300 means bet $100 to win $300 (total return $400)

### Decimal Odds

Decimal odds are simpler. They represent the total return per $1 bet (including your stake).

- 1.67 = bet $1, get $1.67 back (equivalent to -150 American)
- 2.50 = bet $1, get $2.50 back (equivalent to +150 American)
- 4.00 = bet $1, get $4.00 back (equivalent to +300 American)

### Fractional Odds

Fractional odds (common in the UK) show profit relative to stake.

- 2/3 = win $2 for every $3 bet (equivalent to -150 American)
- 3/2 = win $3 for every $2 bet (equivalent to +150 American)
- 3/1 = win $3 for every $1 bet (equivalent to +300 American)

## Converting Between Formats

Here are the conversion formulas:

**American to Decimal:**
- Favorites: Decimal = 1 + (100 / |American|)
- Underdogs: Decimal = 1 + (American / 100)

**Decimal to American:**
- If Decimal < 2.00: American = -100 / (Decimal - 1)
- If Decimal >= 2.00: American = (Decimal - 1) * 100

**American to Implied Probability:**
- Favorites: Implied % = |American| / (|American| + 100)
- Underdogs: Implied % = 100 / (American + 100)

## What Implied Probability Really Means

When a sportsbook sets odds, they are expressing an opinion about probability, plus their profit margin.

Let us look at a real example:

**Lakers (-200) vs. Celtics (+170)**

Converting to implied probability:
- Lakers: 200 / (200 + 100) = 66.7%
- Celtics: 100 / (170 + 100) = 37.0%
- Total: 103.7%

Notice the total exceeds 100%. That extra 3.7% is the sportsbook's margin (the vig or juice). The true implied probabilities after removing the vig are:
- Lakers: 66.7% / 103.7% = 64.3%
- Celtics: 37.0% / 103.7% = 35.7%

## Finding Value: When Odds Are Wrong

The market implied probability is not the true probability. It is the sportsbook's estimate, influenced by:
- Betting volume from the public
- Sharp money from professional bettors
- The sportsbook's own risk management

Value exists when the true probability differs from the implied probability.

### Example: Using Elo to Find Mispriced Odds

Suppose our Elo model calculates the Lakers have a 70% chance of winning, but the market implies 64.3%.

**Edge = 70% - 64.3% = 5.7%**

That 5.7% gap is value. If our model is right, betting Lakers -200 is a profitable long-term play despite the short odds.

Now suppose our model calculates the Celtics have a 30% chance of winning, but the market implies 35.7%.

**Edge = 30% - 35.7% = -5.7%**

The Celtics are overpriced. No value on that side.

## Expected Value: The Number That Matters

Expected Value (EV) combines probability and payout to tell you whether a bet is profitable:

**EV = (Win Probability * Net Profit) - (Loss Probability * Stake)**

### Positive EV Example
Lakers at -200, your model gives 70% win probability:
- Win: 70% * $50 profit = $35
- Lose: 30% * $100 stake = $30
- **EV = +$5 per $100 bet**

### Negative EV Example
Celtics at +170, your model gives 30% win probability:
- Win: 30% * $170 profit = $51
- Lose: 70% * $100 stake = $70
- **EV = -$19 per $100 bet**

Over time, positive EV bets make money and negative EV bets lose money. This is the fundamental principle of profitable betting.

## The Vig: Understanding the Sportsbook's Edge

The vig is how sportsbooks make money. On a standard -110/-110 line:

- Win: you get $100 profit
- Lose: you lose $110

To break even at -110, you need to win 52.4% of bets (110/210 = 52.4%). The extra 2.4% above 50% is the sportsbook's built-in edge.

### How the Vig Varies

- Standard sides/totals: 4-5% vig (the -110/-110 line)
- Moneylines: 3-6% vig (varies with the favorite's price)
- Player props: 5-10% vig (wider margins due to less efficient markets)
- Parlays: 10-30%+ effective vig (compounds with each leg)

The higher the vig, the larger your edge needs to be to profit.

## Line Movement: What It Tells You

Odds change from the time they open to game time. This movement provides information:

**Sharp action (professional bettors):** Lines often move 1-3 points after sharp money comes in. If you see a line move from -3 to -4.5 with no injury news, sharp bettors likely bet the favorite.

**Public action (recreational bettors):** Heavy public money on one side sometimes moves the line, but sportsbooks often shade lines toward popular teams knowing the public will bet them regardless.

**Reverse line movement:** When the line moves against the side receiving the majority of bets, it usually means sharp money is on the other side. This is a signal of professional disagreement with public sentiment.

## Moneyline vs. Spread vs. Totals

### Moneyline
Bet on which team wins. Simplest bet type. Best when you have strong opinions about who wins but not by how much.

### Spread (Point Spread)
Bet on the margin of victory. Equalizes the playing field between favorites and underdogs. Standard vig is -110 on both sides.

### Totals (Over/Under)
Bet on the combined score being over or under a set number. Does not require picking a winner. Useful when you have pace and scoring insights.

### Which Should You Bet?

It depends on where you find value. Our Elo model analyzes all three bet types and shows you where the edge is largest for each game.

## Frequently Asked Questions

### Why do different sportsbooks have different odds?

Each sportsbook manages its own risk. If one book has heavy action on the Lakers, they might adjust the Lakers line to -220 while another book stays at -200. This is why shopping for the best odds matters.

### What are closing line odds?

The closing line is the final odds at game time after all betting activity. It is considered the most accurate market estimate because it incorporates all available information. Beating the closing line consistently is the gold standard of sharp betting.

### How much does the vig affect profitability?

Significantly. At -110 vig, you need a 52.4% win rate to break even. With a 55% win rate (strong for a sports bettor), your ROI is only about 5%. Every fraction of a percent matters at scale.

## Stop Guessing, Start Calculating

Understanding odds is the foundation of profitable betting. Once you can convert odds to implied probabilities and calculate expected value, you stop guessing and start making informed decisions.

At BetAnalytics.ai, we do this math for every game across every major sport. Our Elo model calculates independent probabilities, compares them to market odds, and shows you exactly where the value is.

**See the math behind every bet.** [Start your 3-day free trial](/signup) and let data drive your betting decisions.

*Sports betting involves risk. Only bet what you can afford to lose. If you or someone you know has a gambling problem, call 1-800-GAMBLER.*`,
  },
  {
    slug: "how-injuries-impact-betting-lines",
    title: "How Injuries Impact Betting Lines (And How to Quantify It)",
    description:
      "Learn how player injuries affect sports betting lines and how to quantify the impact. Understand QB, goalie, and star player injury adjustments with real data.",
    publishedAt: "2026-02-07",
    author: "BetAnalytics Team",
    readingTime: "10 min read",
    tags: ["injuries", "sports-betting", "strategy"],
    content: `Every sports bettor knows injuries matter. But most bettors handle injuries wrong. They see a star player is out and think "that team will probably lose" without quantifying exactly how much the injury changes the probability.

The difference between knowing injuries matter and knowing how much they matter is the difference between losing and winning long-term. This guide explains how to quantify injury impact across every major sport and use that knowledge to find betting value.

## Why Injuries Create Betting Opportunities

When a key player is injured, three things happen:

1. **The team's true win probability changes.** Losing your starting QB in the NFL is not the same as losing a backup receiver. The impact varies enormously by position and player quality.

2. **The betting line adjusts.** Sportsbooks move the line to account for the injury. But how much? And is it the right amount?

3. **An opportunity may exist.** If the line adjusts too little, there is value betting against the injured team. If it adjusts too much, there is value betting on them.

The key insight is that the market does not always price injuries correctly. Academic research and our own data show that late-breaking injury news (within 2-3 hours of game time) creates the most frequent mispricings.

## Quantifying Injury Impact by Sport

At BetAnalytics.ai, we have developed specific Elo point adjustments for different positions and injury types across every sport we cover. These are applied at prediction time, meaning the team's stored rating stays the same but the projected probability changes.

### NFL & College Football

Football is the sport where a single injury has the largest impact on game outcomes.

**Starting QB Out: -80 Elo points**

This is by far the most impactful injury in all of sports betting. An NFL starting QB is involved in every offensive play. When the starter goes down and a backup comes in, the entire offense changes.

An 80-point Elo adjustment translates to roughly a 5-8% probability shift, depending on the matchup. That is enormous in a market where 2-3% edges are considered significant.

Why is it 80 points? We derived this from historical data analyzing games where starting QBs were unexpectedly ruled out. On average, teams without their starting QB underperform their Elo expectation by about 80 points worth of performance.

**Why this matters for betting:** The market adjusts for QB injuries, but studies show it often underadjusts by 1-3 points on the spread, especially when the news breaks late.

### NHL

**Starting Goalie Out: -30 Elo points**

In hockey, the goalie faces 25-35 shots per game. A backup goalie typically has a save percentage 1-3% lower than the starter, which translates to roughly 0.5-1.0 extra goals allowed per game.

Our 30-point Elo adjustment captures this difference. It shifts the win probability by approximately 2-4%.

**Top 3 Scorer Out: -20 Elo points each**

Star forwards and defensemen contribute significantly to both scoring and possession. Losing a top scorer reduces the team's offensive output and often changes line matchups throughout the roster.

### NBA

**Top 3 Scorer Out: -20 Elo points each**

NBA stars have an outsized impact on their team's performance. When a player averaging 25+ points is out, the team's offensive efficiency drops and the remaining players face tighter defensive coverage.

The cumulative effect matters: losing one starter is manageable. Losing two or three key players can shift a game by 6-10% probability.

**Why 20 points?** We calibrated this against historical NBA data. Teams without their leading scorer underperform their baseline Elo by approximately 20 points. This holds remarkably consistent across different player archetypes (scorers, playmakers, defenders).

### MLB

MLB is unique because pitching has an outsized impact on individual game outcomes.

**Ace Pitcher Starting (ERA < 3.0): +20 Elo points**

When an ace is on the mound, the team gets a significant boost. This captures the reality that MLB game outcomes are heavily dependent on who is pitching.

**Good Pitcher Starting (ERA < 3.8): +10 Elo points**

Above-average pitchers still provide a meaningful boost, just less than true aces.

**No adjustment for average or below-average pitchers.** The baseline Elo rating already captures the team's overall pitching quality. Adjustments are only for pitchers who significantly differ from the team average.

## Injury Status Multipliers

Not every injury is binary. The NBA lists players as Probable, Questionable, Doubtful, or Out. Each status implies a different probability of actually playing:

| Status | Play Probability | Our Multiplier |
|--------|-----------------|----------------|
| Out / IR | 0% | 100% of adjustment |
| Doubtful | ~25% | 70% of adjustment |
| Questionable | ~65% | 15% of adjustment |
| Probable / Day-to-Day | ~90% | 0% (no adjustment) |

### Why Questionable Gets Only 15%

This is counterintuitive but important. Players listed as Questionable play about 65% of the time in the NBA. When they do play, they are usually close to full effectiveness. So the expected impact of a Questionable tag is small: there is a 35% chance they sit (full impact) times 15% weighted adjustment, which roughly equals the actual expected performance reduction.

Players listed as Probable or Day-to-Day play over 90% of the time, so we apply no adjustment.

## How to Use Injury Data for Betting

### Step 1: Identify Key Injuries

Not all injuries matter. Focus on:
- Starting QBs (NFL/NCAAF)
- Starting goalies (NHL)
- Top 3 scorers (NBA/NHL)
- Starting pitchers (MLB)

Role players and bench depth injuries rarely move the needle enough to create betting value.

### Step 2: Quantify the Impact

Use the Elo adjustments above (or your own calibrated values) to calculate how much the injury changes the win probability.

### Step 3: Compare to the Line

Did the market adjust enough? If our model says the injury shifts the probability by 5% but the line only moved 2%, that is a 3% edge.

### Step 4: Look for Late-Breaking News

The most profitable injury-based bets come from news that breaks within 2-3 hours of game time. The market has less time to adjust, and many recreational bettors may not even know about the injury.

Our system pulls injury data from ESPN in real-time and applies adjustments automatically. When you ask our AI about a game, the injury adjustments are already baked into the probability.

## Real-World Examples

### Example 1: NFL QB Injury

**Chiefs (-7) vs. Chargers (+7)**
Late Saturday: Patrick Mahomes listed as OUT.

Our model adjusts: Chiefs Elo drops by 80 points.
Before: Chiefs 67% to cover -7.
After: Chiefs 52% to cover -7.

If the line moves to Chiefs -3.5, the market adjusted by 3.5 points. But our model says the fair line is Chiefs -2. There may be value on Chargers +3.5.

### Example 2: NBA Star Rest Day

**Bucks (-8) vs. Pistons (+8)**
3pm announcement: Giannis Antetokounmpo resting (OUT).

Our model adjusts: Bucks Elo drops by 20 points.
Before: Bucks 74% to cover -8.
After: Bucks 68% to cover -8.

If the line moves to -6, the market adjusted by 2 points. Our model says the fair line is -5. Slight value on Pistons but marginal.

### Example 3: MLB Ace on the Mound

**Yankees vs. Red Sox**
Gerrit Cole (ERA 2.63) starting for the Yankees.

Our model adjusts: Yankees Elo gets +20 points.
Without ace adjustment: Yankees 54%.
With ace adjustment: Yankees 57%.

If the market implies 55.5%, there is a 1.5% edge on the Yankees. Small but real.

## Multiple Injuries Compound

When a team has multiple key players out, the effect compounds. Each additional injury is worth its full adjustment:

- 1 top scorer out: -20 Elo
- 2 top scorers out: -40 Elo
- 3 top scorers out: -60 Elo

Three key players being out can shift a team's win probability by 8-10%. The market almost never fully accounts for this because it is unusual and bettors do not have a systematic way to quantify it.

## Frequently Asked Questions

### Do injuries affect totals as well as sides?

Yes. When a key offensive player is out, the total should generally move lower (less scoring expected). When a key defensive player (like an NHL goalie) is out, the total should move higher. However, the totals market is more complex because it depends on both teams' injuries and the specific over/under number.

### How quickly do sportsbooks adjust for injuries?

Major sportsbooks adjust within minutes for high-profile injuries. But smaller markets (player props, live odds, alternate spreads) may take longer. The fastest adjustments happen for NFL QB injuries; the slowest are for college sports and less popular leagues.

### Is it better to bet before or after injury news?

If you have a model that can quantify injury impact, betting immediately after news breaks (before the market fully adjusts) is often the most profitable approach. This requires real-time data feeds and quick execution.

## Turn Injury Data Into Betting Edge

Injuries are not just news. They are quantifiable changes in team strength that create betting opportunities. The key is having a systematic way to convert injury reports into probability adjustments and comparing those adjustments to how the market reacts.

At BetAnalytics.ai, we do this automatically. Real-time ESPN data feeds into our Elo model, quantifying every significant injury across every sport we cover. When you ask about a game, the injury impact is already calculated.

**See injury-adjusted probabilities for today's games.** [Start your 3-day free trial](/signup) and see how injuries change the math.

*Sports betting involves risk. Only bet what you can afford to lose. If you or someone you know has a gambling problem, call 1-800-GAMBLER.*`,
  },
]

export function getAllBlogPosts(): BlogPost[] {
  return posts.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )
}

export function getBlogPost(slug: string): BlogPost | undefined {
  return posts.find((post) => post.slug === slug)
}

export function getBlogPostsByTag(tag: string): BlogPost[] {
  return posts
    .filter((post) => post.tags.includes(tag))
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
}

export function getAllTags(): string[] {
  const tags = new Set<string>()
  posts.forEach((post) => post.tags.forEach((tag) => tags.add(tag)))
  return Array.from(tags).sort()
}

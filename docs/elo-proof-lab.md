# Elo Proof Lab: research only

The lab is NOT a bet recommendation endpoint and NEVER places wagers. It answers a prerequisite question: do our predictions beat sportsbook probabilities at prices truly available before kickoff on games excluded from model selection?

## Baselines

- Chronological Elo replay: Result updates occur only after a trustworthy resultKnownAt time. Ratings use existing calculateWinProbability and updateRatingsAfterGame math.
- Two-way sportsbook baseline: Remove vig by normalizing both sides' implied probabilities. A single bookmaker is a weaker baseline than a liquid sharp-market consensus; upgrade this later.
- Train-only blend: Choose weight from 0% Elo / 100% market to 100% Elo / 0% market using *training* log loss only. Freeze before holdout.
- Holdout: Compare Brier score, log loss, accuracy, expected calibration error and a flat-unit simulated moneyline strategy. Hypothetical returns use the *quoted snapshot price*, not closing odds.

Example historical game input (fictional, for schema illustration ONLY):

    {
      "gameId": "example-2024-01-10",
      "league": "NBA",
      "homeTeamId": "team-a",
      "awayTeamId": "team-b",
      "commenceTime": "2024-01-10T00:00:00Z",
      "resultKnownAt": "2024-01-10T03:00:00Z",
      "homeScore": 105,
      "awayScore": 102,
      "isNeutralSite": false,
      "odds": {
        "observedAt": "2024-01-09T22:00:00Z",
        "bookmaker": "ExampleBook",
        "homeAmerican": -125,
        "awayAmerican": 110
      }
    }

Call evaluateHistoricalElo(games, league, cutoff) from src/lib/elo-proof-lab.ts. All timestamps must be offset-aware ISO-8601. resultKnownAt must be *when the final result was truly available*, not a guessed end time. Obtain actual contemporaneous odds from verifiable historical archives; do not substitute today's lines or reconstructed postgame prices. Games lacking historic odds may omit the odds property and still contribute rating history. By default, prices observed >36 hours before game time are excluded.

**Only two-outcome moneylines.** Do not feed soccer 3-way markets, tied-result regulation markets, point spreads, totals or props without market-specific settlement rules. The research code will reject invalid two-way draws and post-start prices.

## Gates before even considering forward paper testing

1. At least 100 historical train predictions, with weights selected only from train.
2. At least 300 distinct unseen holdout game predictions.
3. At least 100 qualified hypothetical bets using at least 3% predicted expected ROI.
4. Holdout selected-model log loss better than the no-vig sportsbook baseline.
5. Indicative 95% lower ROI estimate above zero.

Passing the gates is NOT a guarantee of profit. The confidence interval is simplistic, underestimates correlation risk and needs blocked/date-clustered replacement. Before any real-money use we need real, independent odds provenance, season-by-season results, late line changes, realistic accessible sportsbook odds and limits, transaction frictions, closing-line-value measurements, repeated new untouched holdouts, and a substantial forward paper-trading trial.

## Known limitations

- **No historical bookmaker odds archive has been connected. The system has NOT demonstrated an edge or positive historical return.**
- The lab is a chronological single-pass replay and omits the application's multi-pass and season-regression procedures. Establish production replay parity before promoting model parameters.
- It keeps the current hard-coded Elo constants unchanged. Any K-factor/home/scale optimization requires new training data and future holdout validation, never fitting on the final holdout.
- Production game-selection includes manually configured probability adjustments not validated by this module. Do not infer the live betting system is profitable from unit-test success.
- No credentials, paid API requests, real-money wagers, production data mutation or live cache modifications occur here.

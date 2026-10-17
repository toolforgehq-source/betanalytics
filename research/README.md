# Football Elo multiseason research (not live picks)

## Why this exists
NFL and college football seasons are too short for a rule requiring **10–20 current-season games** before predictions can be eligible. This research provides an offline, pregame-only comparison of season-reset Elo vs progressively retained preseason ratings.

## Data and reproducibility
- ESPN's actual weekly football scoreboard, both regular and postseason, from seasons 2022 through 2026.
- ESPN game IDs, team IDs, real final scores, neutral-site flags and per-week source URLs.
- 2026 games are cut off at `2026-10-17T12:00:00Z`, before that Saturday's FBS slate.
- Every full historical season must meet minimum game counts; failures stop the job.
- Research artifacts contain the parsed history and the full results, and are downloadable from GitHub Actions for 21 days.
- Neon quota prevented extending the database-backed backfill. The research job **never writes to Neon** and leaves the live Elo and picks untouched.

## Evaluation discipline
1. Iterate games in strict kickoff order; issue each probability before updating either team.
2. Elo carries forward across seasons with explicit mean regression; experiment with retention (0%, 25%, 45%, 65%, 80%).
3. Discount prior-season games when estimating how much real evidence informs a team's rating.
4. Remove one-off FCS opponents from the college training set using season participation. This determines a team's competition *membership* from season schedules and is not an outcome-based filter. A production model should use an independently maintained preseason FBS roster to remove even this membership-lookahead approximation.
5. **Tune parameters on 2024 Brier score only**, retain 2025 and pre-October-17 2026 as untouched out-of-sample seasons.
6. Compare all variants against both season-reset Elo and a simple home-field prior, using Brier score, log loss, and straight-up accuracy.
7. Treat NFL and NCAAF separately. The strongest 2024 variant need not win in every holdout year.

## Clear nonclaims and deployment gate
- Winner-prediction accuracy is **not** ATS accuracy, bookmaker edge, or betting ROI.
- Historical sportsbook prices are not imported; DO NOT infer positive expected value or profitability from these results.
- The backtest currently calibrates only outright game winners. It is **not** a validated spread or totals model.
- Historical full-season game membership is used to filter FBS opponents; an immutable preseason roster should replace it for a fully clean evaluation.
- Before any betting recommendation is changed: validate against bookmaker closing odds, run spread-specific push-aware calibration with pregame prices, audit the early-season and playoff buckets, include QB/coaching injuries with documented availability, and pass a separate paper-trading trial.
- Existing production picks, Elo keys and betting thresholds are intentionally unchanged.

## Running
```bash
node --test research/football-elo.test.mjs
node research/backfill-football.mjs --through=2026-10-17T12:00:00Z
```
Outputs: `research-output/football-games-2022-2026.json` and `research-output/football-backtest-report.json`. The GitHub Actions workflow also uploads both as artifacts.

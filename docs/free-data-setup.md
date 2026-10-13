# Free BetAnalytics data setup (no paid odds provider)

## What is working in this development branch

- The `/api/odds` service now prefers **ESPN pickcenter** with no `ODDS_API_KEY`.
- The free provider is scoped to NBA, NFL, NHL, MLB, NCAAB, and NCAAF to reduce free HTTP traffic. Soccer isn't supported by this fallback unless draw and sportsbook quotes are available and separately validated.
- The endpoint reports `source: "ESPN"` when it has usable free quotes, and `isStale: true` with 0 games when it does not.
- Quotes need a named sportsbook and real American prices. No silent default bookmaker, game time or -110.
- Paid The Odds API calls are disabled by default. **Leave `USE_PAID_ODDS_FALLBACK` unset.**
- The existing picks cron ALREADY retrieves ESPN odds; this PR corrects the public odds/dashboard path that was still depending on `ODDS_API_KEY`.

## Database required for reliable Elo and tracking

A separate Neon project has been provisioned on the user's existing Free-plan organization:
- Project: `betanalytics-private`
- Neon project ID: `polished-sky-88095738`
- Database: `betanalytics`

The Vercel app refused both reading and adding project environment variables with HTTP 404; a project owner must open Vercel's **betanalytics > Settings > Environment Variables** and manually configure:
- `DATABASE_URL`: Obtain the secure connection string directly from Neon Console for this new BetAnalytics database. Target production and preview as intended. **Never paste it into ChatGPT**.
- `CRON_SECRET`: A unique strong random secret (needed to secure scheduled write and Elo backfill jobs). Generate privately, do not paste it into chat.
- Do **not** add `ODDS_API_KEY` or enable `USE_PAID_ODDS_FALLBACK`.

Changes to Vercel environment variables generally need a new deployment to take effect.

## Important — getting accurate historical Elo

Even with working free odds, the Elo model cannot responsibly recommend games if its rating cache is empty.
The existing `/api/cron/update-elo` fetches the prior day's games and requires persistent database storage. Its optional `backfill=true` currently starts October 2025 and requests every date across many leagues, which can time out. **Do not trigger that broad backfill or `reset=true` from production without first reviewing its scope.** A bounded, sport-specific historical initialization should be prepared separately and verified for season boundaries and missing games. The user's current model has NOT demonstrated out-of-sample profitability.

## Reliability and licensing limitations

ESPN's endpoints are publicly reachable but undocumented and may change or rate-limit. The odds retrieval time isn't necessarily the sportsbook's last-update time, and the presented prices may not be accessible from all jurisdictions. This implementation is for the user's private research and requires a legal/terms review before commercial redistribution.

No paid API credentials were added, no wagers were made, and this PR is not merged into production.

# User Journey 4: League Start and Standard Game Loop

This journey describes the normal cycle once teams have joined: initial portfolio submission, league activation behavior, daily scoring, standings updates, and roster management.

## Goal

- League starts with valid initial portfolios.
- Daily score pipeline runs and standings update.
- Users can continue through normal roster operations.

## Actors

- Players managing teams.
- System services (price sync + score hydration).
- Admin/developer for diagnostics when needed.

## Preconditions

- Active season with instruments and prices.
- League exists with teams.
- Each team can submit symbols from available instrument universe.

## Steps

1. Submit initial portfolios.
   - Use **Portfolio Selection (Phase 6)** in `/backend`.
   - For each team, validate then submit 8 symbols.
   - Ensure roster constraints pass (budget, tier minimums, ownership mode rules).
2. Confirm league ready state.
   - After required submissions, check league status change in backend feedback.
3. Trigger daily score hydration.
   - Open `/dashboard` or `/leagues/<leagueId>` to run sync/hydrate path.
   - System fetches missing prices and computes cached scores.
4. Review standings and team details.
   - Visit `/leagues/<leagueId>/standings`.
   - Visit `/leagues/<leagueId>/team/<teamId>`.
5. Continue live management loop.
   - Use `/leagues/<leagueId>/roster` for swaps/waivers/trades.
   - Changes apply on next trading day and scoring reflects updated holdings.
6. Repeat daily.
   - Users view dashboard and standings.
   - System updates latest date, recalculates as needed, and persists score cache.

## Expected Result

- League displays ranked standings with cumulative points.
- Team pages show holdings, movement, and score history.
- Roster actions are validated and reflected in subsequent scoring windows.

## Validation Checklist

- No blocking errors when loading `/dashboard`.
- Latest scoring date visible.
- Standings and leader views load for each active league.
- Roster moves follow trading-day and validation rules.

## Admin/Developer Test Runbook

1. Ensure background data is healthy in `/backend`:
   - Trading calendar rows exist.
   - Price rows exist and latest price date is recent.
2. For a test league:
   - Submit portfolios for all teams.
   - Calculate one team day score and one date range from scoring tools.
   - Run debug snapshot for one team/date.
3. Validate cache behavior:
   - Invalidate a small date window.
   - Recalculate and verify standings consistency.
4. Final regression commands:
   - `bun --bun run test`
   - `bun --bun run lint`
   - `bun --bun run build`

# Fantasy Trader

Fantasy Trader is a fantasy-sports-style game where users draft and manage a team of real companies instead of athletes.

The core idea is simple:

- You build an 8-company roster under budget and tier constraints.
- Daily percentage moves in stock prices become fantasy points.
- You compete in leagues through draft choices, swaps, waivers, and trades.

This project implements the product direction from the original design/planning sessions and keeps scoring deterministic and rebuildable from raw data.

## Product Goal

Fantasy Trader is designed to feel like fantasy football mechanics, mapped to markets:

- Drafting and roster constraints create strategic team composition.
- Daily scoring rewards consistent picks, not just one big swing.
- Mid-season management (swaps, FAAB, trades) adds tactical depth.
- League modes support both scarcity and broad participation.

## Primary Use Cases

- Private friend leagues with unique company ownership and FAAB waivers.
- Global-style competition where duplicate ownership is allowed.
- Deterministic historical scoring that can be recalculated after rule changes.
- Admin/ops workflow for season setup and debugging from an internal backend console.

## Current Rule Model

The current implementation follows these game rules:

- Roster size is exactly 8 companies.
- There are 5 tiers, and each roster must include at least 1 company from each tier.
- Tier costs are fixed per season: Tier 1 = 20, Tier 2 = 16, Tier 3 = 12, Tier 4 = 8, Tier 5 = 4.
- Default season budget is 100.
- Daily points are based on close-to-close percent change using adjusted close prices.
- First scoring day for newly added holdings uses a penalty multiplier (default 0.5).
- No in-hours transactions: swaps/trades are blocked while market is open.
- Roster changes become effective on next trading day.
- Default swap limits are 1 per day and 5 per week.
- Private unique leagues use FAAB claims for contested add/drop.

## How It Works (Deterministic Data + Scoring)

The app is designed to avoid cron dependency for core gameplay freshness.

- On page load, server loaders call game services that ensure prices are synced up to the latest needed day.
- Missing end-of-day prices are fetched from Yahoo Finance and upserted idempotently.
- Holdings are reconstructed from append-only `roster_moves` based on effective dates.
- Team-day scores are derived from holdings + prices and cached in `team_day_scores`.
- Cached scores are invalidatable and fully recomputable from source data.

Key design principle:

- `price_daily` and `roster_moves` are source-of-truth facts.
- `team_day_scores` is a derived cache.

## Main User Journeys

### 1) Guest Login and App Access

- User lands on `/` and continues to `/login`.
- Authentication is currently anonymous-only (Better Auth anonymous plugin).
- Protected app routes are grouped under an auth-gated layout (`src/routes/_app/route.tsx`).

### 2) Season Setup (Admin Flow)

From `/backend`:

- Create a season.
- Populate UK trading calendar.
- Populate season instruments and tiers.
- Activate season.

### 3) League and Team Setup

From backend tools:

- Create a league for a season.
- Choose ownership mode: `UNIQUE` or `DUPLICATES`.
- Create teams in that league.

### 4) Draft / Initial Portfolio Selection

- Teams submit 8 symbols.
- Validation enforces roster size, per-tier minimums, and budget cap.
- In unique leagues, already-drafted symbols are rejected.
- League transitions to active once required portfolios are submitted.

### 5) Daily Scoring and Standings

- Dashboard/league pages trigger price sync and score hydration.
- Team scores are computed per trading day and cached.
- Leaderboards are ranked by cumulative points.

### 6) Mid-Season Roster Management

From `/leagues/$leagueId/roster`:

- Submit swap (drop + add).
- Unique leagues: creates waiver claims with optional FAAB bids.
- Duplicate leagues: writes direct ADD/DROP moves effective next trading day.
- Review pending waiver claims and swap history.
- Propose/accept/reject/cancel private trades, with post-trade roster validation.

## Route Map

Public routes:

- `/`
- `/login`
- `/api/auth/$`

Protected routes:

- `/dashboard`
- `/backend`
- `/backend/$table`
- `/leagues/$leagueId`
- `/leagues/$leagueId/standings`
- `/leagues/$leagueId/team/$teamId`
- `/leagues/$leagueId/roster`

## Tech Stack

- TanStack Start + TanStack Router
- React 19
- Drizzle ORM + PostgreSQL
- Better Auth
- Tailwind CSS + shadcn/ui patterns
- Yahoo Finance (`yahoo-finance2`) for EOD market data

## Project Structure

- `src/lib/game/` domain services (calendar, market data, scoring, draft, swaps, trades)
- `src/routes/_app/` authenticated app pages
- `src/routes/_app/backend/` backend console utilities
- `src/db/schema.ts` game schema
- `src/db/auth-schema.ts` Better Auth schema
- `src/middleware/` auth context + auth-required middleware

## Local Setup

1. Install dependencies:

```bash
bun install
```

2. Create environment files (`.env.local` or `.env`) with at least:

- `DATABASE_URL` (required for app + Drizzle)
- `BETTER_AUTH_SECRET` (recommended for Better Auth)

3. Push schema:

```bash
bun --bun run db:push
```

4. Start dev server:

```bash
bun --bun run dev
```

## Useful Commands

```bash
bun --bun run dev
bun --bun run build
bun --bun run preview
bun --bun run lint
bun --bun run test
bunx --bun tsc --noEmit
bun --bun run db:push
bun --bun run db:studio
```

## Testing Notes

- Unit tests exist for core helpers and constants.
- Domain smoke tests in `src/lib/game/game-domain.test.ts` hit the configured database and may create setup data.
- If tests are pointed at a shared DB, expect test artifacts.

## Current Product Status

Implemented phases include:

- Core schema and game domain logic
- Trading calendar and market data sync
- Deterministic scoring cache workflow
- League/team/draft flows
- Swaps, waivers (FAAB), and private trades
- Auth-gated app shell with anonymous login
- Dashboard, standings, team, and roster pages

The app is playable for MVP-style flows and is structured for future enhancements like richer draft orchestration, stricter trade governance, and expanded market/league time-zone policies.

# Fantasy Stock Market Game Technical Design and Development
Created: 07/02/2026, 12:41:25
Last Updated: 21/02/2026, 17:25:36
---

### User

What are the main concepts of fantasy games, such as fantasy football?


---

### Assistant (gpt-5.2-instant)

Fantasy games (like fantasy football) are prediction-and-management games where you “own” a virtual team made from real-world players and score points based on what those players do in real matches.

Main concepts:

- **Drafting / roster building**
  - You select players to form your team (snake draft, auction draft, or “pick-em” style).
  - Often constrained by **positions** (e.g., QB/RB/WR) and **roster size**.

- **Scoring system**
  - Real-world actions translate into points (goals, assists, yards, touchdowns, clean sheets, etc.).
  - Rules vary a lot: standard vs. PPR (points per reception), bonus points, penalties, etc.

- **Lineup management**
  - Each match period (week/round), you choose a starting lineup from your roster.
  - Players not started usually don’t score for you (unless the game has auto-sub rules).

- **Game periods (“weeks”)**
  - The season is divided into scoring windows (typically weekly).
  - Your results accumulate across those periods.

- **Matchups or standings format**
  - **Head-to-head:** you play another manager each week; win/loss like a league.
  - **Rotisserie (category) / points table:** everyone competes on total points or category ranks over time.

- **Waivers and free agency**
  - You can add/drop players during the season.
  - “Waivers” is the mechanism to prevent instant pickups (priority order, FAAB budget, etc.).

- **Trades**
  - Managers can swap players (sometimes with league voting or commissioner approval).
  - Trades introduce negotiation and longer-term strategy.

- **Constraints for balance**
  - **Salary cap/budget** (common in auction drafts).
  - Limits on number of players per real team, injured reserve slots, etc.

- **Playoffs / endgame**
  - Many leagues end with playoffs (bracket) after the regular fantasy season.
  - Others just crown the champion by total points.

- **Skill vs. randomness**
  - Skill: drafting well, playing matchups, managing injuries, optimizing waivers/trades.
  - Randomness: injuries, weather, coaching decisions, variance in performance.

If you tell me which sport (football/soccer, NFL, basketball, etc.) and whether you’re thinking of building a league or just understanding how to play, I can map these concepts to the exact common rules for that version.


---

### User

I'm think of developing a idea for a game. I want it to be a fantasy draft style game but using companies and the stock market as the thing you draft and track performance of. Give me some idea in how this could work on a technical level


---

### Assistant (gpt-5.2-instant)

You can model this as “fantasy portfolio management” with league mechanics (draft, waivers, matchups) sitting on top of market data. At a technical level it breaks down into: instruments + pricing data + scoring engine + league rules + anti-cheat/market-hours handling + UI.

## 1) Core game model (entities)
High level objects you’ll need:

- **Instrument**: a “pickable” asset (stock, ETF, sector index, maybe crypto).  
  Fields: `symbol`, `exchange`, `currency`, `corporateActionsSupport`, `isDraftable`.
- **League**: ruleset + season schedule.  
  Fields: `draftType`, `rosterRules`, `scoringRules`, `rebalanceRules`, `timeZone`, `marketCalendar`.
- **Team**: user in a league with a **roster** (portfolio).  
  Fields: `holdings[]`, `cash`, `openClaims[]` (waiver claims), `lockedUntil`.
- **Season / Week (round)**: discrete scoring windows (e.g., Mon–Fri close-to-close).
- **PriceBar**: normalized OHLCV data per instrument per interval (1m/5m/1d).
- **ScoreEvent / Snapshot**: computed results per team per round (for auditing + recompute).

Key design choice: treat holdings as **units** (shares) or **weights**.
- Units feels like “real” trading and makes splits/dividends matter.
- Weights (e.g., each pick is 10% of portfolio) makes it easier and more “fantasy-like”.

## 2) Draft + roster mechanics (gameplay to data structures)
Draft is just an ownership allocation mechanism.

### Draft types you can support
- **Snake draft** (like fantasy football): each pick assigns an instrument to a team.
- **Auction draft**: each team has a budget; bid for instruments.
- **Salary-cap with dynamic pricing**: instrument “cost” is based on volatility/market cap.

### Roster rules analogs
- “Positions” can become **sectors / factors / market caps**, e.g.:
  - 1× Large cap, 1× Mid cap, 1× Small cap
  - 1× Tech, 1× Healthcare, 1× Industrial
  - 1× “Defensive” (low beta) vs “Growth” (high beta)
This prevents everyone drafting the same megacaps.

### Trades / waivers
- **Trade**: swap instruments (and optionally cash/FAAB).
- **Waivers**: add/drop from the “free agent pool” (anything undrafted).
  - Use **FAAB** (free agent acquisition budget) to avoid “fastest click wins”.
- “Locking”: prevent roster changes during an evaluation window (e.g., lock at market open).

## 3) Scoring models (turn market performance into points)
This is the heart of it. Options:

### A) Simple: return-based points
Per round, team score is sum of returns for its holdings.
- For each instrument \( i \): round return \( r_i = \frac{P_{close}}{P_{open}} - 1 \)
- Team score \( S = \sum w_i \cdot r_i \) (weights) or \( \sum units_i \cdot \Delta P_i \) (units)

Pros: easy, transparent.  
Cons: encourages high-volatility picks.

### B) Risk-adjusted / “fantasy balanced”
Add volatility penalty or benchmark-relative scoring:
- **Excess return vs benchmark** (e.g., vs S&P 500 ETF):
  - \( score_i = r_i - r_{benchmark} \)
- **Cap extreme gains/losses** (like point caps).
- **Sharpe-like per round** (needs vol estimate; can be gamed).
- **Beta handicap**: high beta earns fewer points per % move.

### C) Event-based points (more gamey)
Award points for “events”:
- Beat earnings estimate (needs fundamentals feed)
- Dividend paid
- New 52-week high
- “Streaks” (up 3 days in a row)
This increases engagement but requires more data sources and careful definitions.

Recommendation: start with A, optionally add a simple benchmark-relative modifier.

## 4) Market data pipeline (technical)
You need reliable pricing and a normalization layer.

### Ingestion
- Pull EOD (end-of-day) first (much easier legally/technically), then consider intraday.
- Store raw provider payloads + normalized bars.

### Normalization concerns
- **Corporate actions**: splits, reverse splits, symbol changes, dividends.
  - If you use **adjusted close** series, it simplifies “true return” scoring.
  - But users may expect “price moved from X to Y” — be explicit.
- **Trading halts / missing bars**: decide fallback behavior (carry last price, exclude, or penalize).
- **Currencies**: if you allow multi-exchange instruments, you need FX conversion at the scoring timestamp.

### Suggested storage
- OLTP DB for game state: Postgres (leagues/teams/transactions).
- Time-series store for prices:
  - Postgres + TimescaleDB, or ClickHouse, or just parquet files in object storage for scale.
- Cache: Redis for current-week snapshots / leaderboards.

## 5) Scoring engine architecture
Treat scoring as a deterministic batch job + audit trail.

### Flow
1. **Round boundary** occurs (e.g., Fri 21:00 UTC depending on market close).
2. For each league:
   - Determine each team’s locked roster at round start.
   - Fetch open and close prices for each instrument.
   - Compute returns + apply scoring rules.
   - Persist `ScoreSnapshot(teamId, roundId, score, breakdownJSON, inputsHash)`.

### Determinism & recompute
Market data sometimes revises (late corporate actions).  
Design for re-scoring:
- Keep immutable “roster lock” and “price version” used.
- Use idempotent jobs with a unique key `(leagueId, roundId, scoringVersion)`.

### Near-real-time leaderboards
Optionally stream live P&L:
- Use intraday bars and recompute “unofficial” live scores.
- Official score is fixed at round close.

## 6) Anti-cheat + fairness rules (important)
- **Lock times**: roster locks before market open (or before first tradeable time).
- **Latency**: if live scoring exists, don’t allow instant swapping based on minute-by-minute moves.
- **Survivorship bias**: ensure the draft pool includes delisted events fairly (what happens if a stock is halted/delisted?).
- **Max exposure**: prevent everyone picking the same instrument by uniqueness rule (common in fantasy) or allow duplicates but with cost.

## 7) Key endpoints / services (practical split)
Minimal services/modules:

- **Game service**
  - League creation, roster rules, draft orchestration, waivers, trades.
- **Market data service**
  - Instruments catalog, prices API, corporate actions, calendar.
- **Scoring service**
  - Batch compute, snapshots, leaderboards.

For MVP, these can be one backend with clear modules.

## 8) Draft orchestration (implementation sketch)
Snake draft requires:
- Draft state machine: `PENDING -> LIVE -> COMPLETE`
- Current pick pointer: round, pickIndex, teamId.
- Timer per pick (auto-pick on timeout).
- Auto-pick strategy: highest market cap remaining, or random, or “watchlist”.

Persist every pick as an event:
`DraftPick(draftId, pickNumber, teamId, symbol, timestamp)`  
This makes it easy to replay and audit.

## 9) What you should decide early (so you don’t paint yourself in)
1. **EOD only vs intraday** (EOD is way simpler).
2. **Adjusted vs unadjusted prices** (adjusted simplifies returns; document it).
3. **Units vs weights** (weights makes scoring simpler and “fantasy-like”).
4. **Uniqueness** (can two teams own the same stock? Most fantasy games say no).
5. **Season cadence** (weekly rounds vs daily rounds).

## 10) A concrete MVP spec (suggested)
- Universe: top 200 US stocks + a few ETFs.
- Draft: snake, unique ownership.
- Roster: 8 picks + 2 bench.
- Round: weekly close-to-close (Mon open → Fri close).
- Scoring: sum of % returns (weights equal per starter), minus benchmark return (SPY) to reduce “market went up” effect.
- Waivers: FAAB weekly after round lock.
- Data: daily adjusted bars.

If you answer these, I can propose a clean schema + job schedule + scoring formulas:
1) EOD or intraday?  
2) Unique ownership or duplicates allowed?  
3) US-only equities, or multi-market?  
4) Want it to feel like “skill” (risk-adjusted) or “market casino” (raw returns)?


---

### User

I think I want this to feel like you are drafting a team of companies (instead of players) maybe from on stock market maybe from a selection. And each day their net change is the equivalent to goals scored etc. Ie the change each day is the performance. It should be relative though so by percentage change rather than raw amount. But when drafting there should prob be some kind of budget? So your force to by smaller companies to make up you portfolio? I guess in a league with friends you cna choose to have unique ownership but in a global tracking duplicates must be allowed.


---

### Assistant (gpt-5.2-instant)

You can make this feel very “fantasy team” by treating each company like a player with a daily “stat line” = its % move, then layering on (1) roster slots and (2) a salary/budget system so you can’t just draft all megacaps.

Below is a technically clean way to do it that supports both **friends leagues (unique ownership)** and **global play (duplicates allowed)**.

## 1) Core scoring: daily % change → points
Pick a canonical daily return:

- Daily return: \( r_d = \frac{P_{close,d}}{P_{close,d-1}} - 1 \)
  - Use **adjusted close** if you want total-return-ish behavior (splits/dividends handled).
  - Use regular close if you want “headline price move” behavior. (I’d still pick adjusted for correctness and document it.)

Convert to points with a multiplier:
- `points = round(r_d * 100 * K, 2)`
  - Example: K = 10 → a +1.23% day = +12.30 points.

Optional to reduce “market tide”:
- Benchmark-relative: `points = (r_d - r_benchmark_d) * 100 * K`

Implementation detail: store both `r_d` and computed `points` so you can change scoring versions later.

## 2) “Team of companies” feel: roster slots (positions)
To force variety, add slots like:
- 2× Large cap
- 2× Mid cap
- 2× Small cap
- 1× “Defensive” (low beta / low vol)
- 1× “Growth” (high vol / high beta)
- 2× Flex (any)

You can classify companies ahead of time using market-cap buckets (cheap) and maybe 60–90d realized volatility for “defensive/growth”.

This does a lot of balancing even without budget.

## 3) Draft budget (“salary cap”) that pushes smaller companies
You want the equivalent of auction draft budgets. The trick is: stock *price* isn’t a good “salary”. Use something derived from **market cap** and/or **volatility** so “expensive” roughly means “popular / stable / high expected”.

### A simple salary function (works well enough)
Let:
- `cap = marketCapUSD`
- `capScore = log10(cap)` (so 10x bigger only adds +1)
- `vol = realizedVol90d` (optional)

Then:
- `salary = round( base + a*capScore + b*vol, 1 )`

Example parameters:
- `base=1`, `a=4`, `b=10` (you’ll tune this)

League rule:
- Each team has `budget = 100`
- Must draft `N` companies with salaries summing ≤ 100

This forces tradeoffs: you can buy 1–2 “studs” but then need cheaper picks.

### Alternative (even simpler): tiered costs
Precompute tiers:
- Tier S (top 10 by cap): cost 20
- Tier A (next 30): cost 12
- Tier B (next 60): cost 7
- Tier C (next 100): cost 3
Budget 60, roster 8 → you must mix tiers.

This is super transparent to players and easy to implement.

## 4) Friends league vs global (unique vs duplicates)
Model “ownership constraints” at the **league level**:

- `ownershipMode = UNIQUE | DUPLICATES`
- UNIQUE: an instrument can be rostered by max 1 team in that league.
- DUPLICATES: no restriction; many teams can hold the same instrument.

Technically: enforce it in your transaction layer.
- UNIQUE: add a uniqueness constraint like `(leagueId, symbol)` on active roster rows (or enforce via a lock + check).
- DUPLICATES: no constraint.

You can have:
- “Private leagues” default UNIQUE
- “Global ladder” default DUPLICATES + salary cap + positions to preserve variety

## 5) Daily workflow (data + scoring pipeline)
EOD-only is ideal for this design.

Daily at market close (or shortly after):
1. Ingest the day’s adjusted closes for your universe.
2. Compute `dailyReturn` per symbol.
3. For each league:
   - determine which symbols are “active starters” for each team that day
   - compute points per symbol
   - sum to team-day score
4. Persist a `TeamDayScore` record with a breakdown for audit/UI.

Key design: keep rosters **time-bounded**:
- `Holding(teamId, symbol, startDate, endDate, isStarter)`
so you can correctly score historical days even after trades.

## 6) Preventing degenerate strategies
If points are raw % change, volatility wins. Some lightweight controls:

- **Starter cap**: only top X movers on your roster count? (Feels odd sometimes.)
- **Volatility handicap**: divide points by volatility rank.
- **Benchmark-relative**: makes “market up day” not free points.
- **Clamp**: cap daily points at e.g. ±50 to reduce penny-stock lottery.
- **Universe selection**: exclude microcaps / illiquid names to reduce manipulation and insane swings.

For a friendly game, I’d start with:
- Universe: top 300–500 by market cap on one exchange/market
- Clamp: ±30 points/day (optional)
- Benchmark-relative: yes

## 7) Minimal schema sketch (MVP)
- `Instrument(symbol, name, marketCap, sector, tier, salary, ...)`
- `PriceDaily(symbol, date, adjClose, sourceVersion)`
- `League(id, ownershipMode, budget, rosterRulesJson, scoringRulesJson, ...)`
- `Team(id, leagueId, userId, ...)`
- `RosterMove(id, teamId, symbol, type[DRAFT|ADD|DROP|TRADE], effectiveDate, ...)`
- `HoldingSnapshot(teamId, date, startersJson)` or time-bounded holdings table
- `TeamDayScore(teamId, date, points, breakdownJson, scoringVersion)`

## 8) One concrete ruleset that matches what you described
- Universe: S&P 500 constituents (or top 300 by cap on LSE/NASDAQ etc)
- Draft: auction, duplicates allowed in global, unique in private
- Budget: 100
- Roster: 8 starters (no bench for MVP)
- Salary: tier-based (transparent)
- Daily points: `(stockReturn - benchmarkReturn) * 100 * 10`, clamp ±30

---

If you tell me which market you want first (e.g., US equities, UK, EU) and whether you want weekends ignored vs carrying Friday→Monday as one “day”, I can propose exact round boundaries + a robust salary/tier computation that stays stable as market caps shift.


---

### User

I'm going for si ple so pre computed tiers would be the way tk go. So so far end of day change get turned into points and that's used as general scoring. When drafting you have a budget to spend  and restrictions sleg must have at least 8 and must have at least one from each tier etc.. The next thing I want to think about it trading or selling/buying mid league. Is this normally allowed in games like fantasy football? How should this work?


---

### Assistant (gpt-5.2-instant)

Yes—mid‑season roster changes are a core part of most fantasy sports.

In fantasy football you typically have:
- **Trades** (team-to-team swaps), often allowed most of the season with a trade deadline.
- **Waivers / free agency** (add/drop players from the “pool”), usually with rules to avoid “fastest finger wins”.
- Sometimes **FAAB** (a budget for waiver pickups).
- **Lineup locks** around game start times.

For your stocks-as-players game, you can map those directly while keeping it simple.

## 1) The simplest model that still feels “fantasy”
### A) Add/Drop (Waivers) from a shared pool
- Any undrafted company (or dropped company) goes into the **free agent pool**.
- Teams can **drop** a company and **add** another, subject to:
  - tier constraints (must keep at least 1 from each tier, roster size ≥ 8)
  - budget/cap constraints (if you’re using “tier costs”)

To prevent churn/abuse, choose one of these:

**Option 1: Daily waiver run (easy + fair)**
- Users submit claims during the day.
- At a fixed time (e.g., 20:00 UTC after market close), claims process in order.
- Order is either:
  - reverse standings, or
  - rolling priority, or
  - random each day.

**Option 2: FAAB (best long-term, still simple)**
- Each team gets a waiver budget (e.g., 100 FAAB for the season).
- For a free agent, teams submit blind bids; highest bid wins.
- This works great even with global duplicates *disabled* in private leagues.  
  (If duplicates are allowed globally, waivers are less relevant—see below.)

### B) Trades (between friends)
In private leagues, trades are fun and social:
- Propose trade: “I give A (Tier S) + C (Tier B), you give B (Tier A) + D (Tier A)”
- Enforce constraints post-trade (tier minima, roster size, budget/cost cap)
- Add a **trade deadline** so end-of-season doesn’t become chaos.

Approval model:
- Easiest: **commissioner approve** or **auto-approve** with a 24h review window.

## 2) Critical rule: “lock” windows so it’s not real-time gaming
Fantasy football locks players at kickoff. Your analog is market time.

Pick a simple rule:
- **Roster changes take effect next trading day** (T+1), not same-day.
  - If you add a company on 2026-02-09, it starts scoring from 2026-02-10 close-to-close.
- Additionally: **no transactions during market hours** (optional), or allow but still only effective next day.

This avoids “I bought it because it’s already up 6% today”.

Implementation detail: every roster move has an `effectiveDate`.

## 3) How to handle your two modes (private unique vs global duplicates)
These modes want different transaction systems:

### Private league (unique ownership)
Use classic fantasy mechanics:
- Draft assigns unique ownership.
- Add/drop uses waivers/FAAB.
- Trades allowed.
This is the “fantasy football feel”.

### Global (duplicates allowed)
A shared free-agent pool doesn’t make sense if everyone can own everything.
Instead, use **rebalancing** mechanics:
- Users can “sell” and “buy” but they’re not competing for scarce assets—so competition shifts to:
  - budget constraints (tier costs)
  - transaction limits
  - cooldowns

Good global-friendly options:
- **Limited transfers per week** (e.g., 2 changes/week)
- **Transaction fee** in points (e.g., -5 points per swap)
- **Cooldown**: once you add a company, must hold for 3 trading days

That keeps it game-like and prevents infinite optimization.

## 4) Budget/cost when trading mid-season
With tier-based “costs”, you have a couple of clean approaches:

### Approach A: Cost is fixed to tier at time of acquisition
- Tier S always costs 20, Tier A 12, etc.
- Your “cap” is on total tier-cost of current roster.
- If you drop a Tier S, you free 20 cap immediately.

Pros: very simple, predictable.
Cons: if a company moves tiers over time, you need a rule (see below).

### Approach B: Tier is frozen at season start
- On day 1, you lock each company’s tier for the entire season.
- Costs never change during the season.

Pros: simplest for fairness, avoids “tier drift” chaos.
Cons: less reflective of reality, but that’s fine for a game.

I’d do **tier frozen per season**.

## 5) Concrete “simple but solid” mid-season ruleset
For a private league:
- Add/drop allowed via **FAAB** (100 per season), processed once per day after close.
- Trades allowed until 2 weeks before season end.
- Moves effective next trading day (T+1).
- Limit: max 2 adds per week to reduce churn.

For global:
- No waivers. Just “transfers”.
- Limit: 2 transfers/week (or 1/day).
- Moves effective T+1.
- Optional: -5 points transaction fee after the first free transfer each week.

## 6) Data model you’ll want for this
Have an append-only transaction log:
- `RosterTransaction(id, teamId, type, dropSymbol?, addSymbol?, createdAt, effectiveDate, metadata)`
Then compute holdings by replaying transactions up to a date (or materialize daily snapshots for speed).

---

If you answer one question, I can recommend the cleanest option:
Do you want **private leagues** to feel more strategic (FAAB + limited transfers), or more casual (unlimited add/drop but T+1 effective)?


---

### User

Okay I like the fee agent pool idea. No transaction during market hours is a must. Could we add in a point penalty for the first day of a newly traded asset? To discourage massive changes everyday? Or is a number of transactions limit enough? I want to answer your question but j don't know what faab means? Expaling more sinoyyfor me


---

### Assistant (gpt-5.2-instant)

Yes—you can add a **“new pickup penalty”** (or “cooldown”) and it works well with stocks because it discourages daily churn without needing complex limits.

### Pickup penalty vs transaction limit (what to use)
- **Transaction limit** (e.g., 2 adds/week) is simplest to understand and enforce.
- **First-day penalty** discourages “streaming” companies daily even if someone saves up transactions (or if you allow more moves).

Best simple combo:
1) **Hard limit**: e.g. `2 adds per week` (drops don’t count, or count both—your choice)
2) **First-day penalty**: on the first scoring day after an add, apply `-X points` or a multiplier

That gives you both:
- a hard cap on spam
- a soft disincentive to use every allowed move unless it’s worth it

### How to implement a “first day penalty”
Two clean options:

**Option A: Flat penalty**
- If a holding was added effective for date D, then on D:
  - `teamDayScore -= pickupPenalty`
Example: `pickupPenalty = 5` points.

Pros: easy.  
Cons: penalty size needs tuning relative to your typical daily point range.

**Option B: Percentage dampener**
- First day: only count 50% of that company’s points
  - `pointsCounted = rawPoints * 0.5`

Pros: scales with volatility; harder to “game”.  
Cons: slightly less intuitive.

Given you’re using `% move * K`, I’d do **Option B** because it naturally scales.

### Is the penalty enough alone?
Penalty alone helps, but if you allow unlimited moves it still invites constant optimization. So I’d still set *some* limit, even if generous:
- `1 add per day max` and/or `2 per week max`

Also consider a **minimum hold** rule:
- must keep an added company for **2 trading days** before dropping
This is very effective and simple.

## “No transactions during market hours”
Good. Define it precisely using exchange calendar:
- Transactions allowed only in a window, e.g. **after close → before next open**
- All accepted transactions become effective **next trading day** (T+1)

This prevents “it’s already up today, quick add it”.

## FAAB explained simply
FAAB = **Free Agent Acquisition Budget**.

Think of it like this:
- When companies are in the **free agent pool**, multiple teams might want the same one (in your *unique ownership* leagues).
- Instead of “whoever clicks first wins”, everyone submits a **bid** using FAAB.
- The highest bid wins the company, and that bid amount is deducted from their FAAB balance.

Example:
- Everyone starts season with **FAAB = 100**
- You bid 12 on “Company X”
- Someone else bids 15
- They get it and now have 85 left; you keep your 100 (you only pay if you win)

Why it’s good:
- fair, strategic, no timezone/latency advantage
- doesn’t require manual waiver priority rules

In **global duplicates-allowed**, FAAB is less necessary because you’re not competing for scarcity. But for **friends unique leagues**, it’s perfect.

## Recommendation (simple ruleset)
For private leagues (unique):
- Transactions only after close / before open
- Effective next trading day
- Add/drop via FAAB waivers once per day
- Limit: 2 successful adds/week
- New pickup dampener: 50% points on first day (or flat -5)

If you tell me your rough scoring scale (e.g., what’s a “good day” in points with your K value), I can suggest a penalty that feels right.


---

### User

With faab does it reset each day? And how does it work with selling. Does it mean I have to have a max portfolio size?


---

### Assistant (gpt-5.2-instant)

FAAB typically does **not** reset each day. It’s usually a **season-long budget** (or sometimes per half-season) that you spend down over time.

## Does FAAB reset each day?
Common patterns:

- **Season budget (most common):** start with e.g. 100, spend it all season, no reset.
- **Weekly budget (more casual):** e.g. 10 per week, resets weekly (simpler, but less strategic).
- **Hybrid:** season budget, but you also get a small weekly top-up (rare, but workable).

Recommendation for your “simple” goal: **season budget = 100**.

## How FAAB works with “selling” (dropping)
In classic fantasy, when you drop a player:
- you **don’t get FAAB back**.
FAAB is a one-way “acquisition power” currency, not money you recycle.

That’s good because it prevents infinite churn: if you keep swapping, you burn budget.

If you want “selling” to feel meaningful, you can add one of these, but it’s optional:
- **No refunds** (keep it simplest)
- **Small refund**: dropping returns e.g. 10% of the original winning bid (adds complexity + edge cases)
- **Separate mechanic**: transaction limit / first-day penalty instead of refunds

## Do you need a max portfolio size?
Yes. You need a roster size constraint regardless of FAAB, otherwise a team could keep adding.

Typical rules:
- **Roster size fixed**: e.g. exactly 8 companies (or 8 starters + 2 bench).
- Any add must be paired with a drop (“add/drop transaction”).

So the flow is:
1) You submit a claim: “Add X, Drop Y, Bid 12”
2) If you win, X replaces Y on your roster effective next trading day.

This keeps your tier constraints stable too (“must have 1 from each tier”).

## How this interacts with tier-cost budget
You’ll likely have *two* budgets:
1) **Draft cap / tier-cost cap**: constrains roster composition (e.g., total tier cost ≤ 60)
2) **FAAB**: only for competing on free agents mid-season

They’re orthogonal:
- Tier-cost cap answers “can I roster this combo at all?”
- FAAB answers “can I win this free agent when others want them?”

In an add/drop claim, validate both:
- Post-transaction roster meets tier rules + roster size
- Post-transaction tier cost within cap
- Bid ≤ remaining FAAB

## One subtle rule to decide: what’s the “cost” of a free agent?
With tiered costs, it’s easiest if:
- **tiers are frozen for the season**, so any free agent’s tier (and cost) is known and constant.

That avoids weirdness like someone dropping a company right before it moves tiers.

If you tell me whether you want **bench slots** (non-scoring holdings) or just a fixed set of starters, I can suggest the cleanest add/drop + lock + waiver-processing schedule.


---

### User

I don't think I want bench slots for now. I want to keep it more simple. So you just have a max portfolio size based on constraints (eg. Min number, one on each team etc) and overall max?
For trading there will be a 1 sell and 1 buy per day and a max of 5 per week. There will be a seasonal faab budget and buying and seeing will execute out of hours that day. But points wins or losses from previous day will apply, so if you schedule a sell of a company that just tanked you still loose the points. In private leagues you can trade (tbc rules of trading)
How does this summary sound so far?


---

### Assistant (gpt-5.2-instant)

This is a solid, internally consistent ruleset for a simple MVP. A few tweaks/clarifications will make it unambiguous and easier to implement without weird edge cases.

## What sounds good
- **No bench**: keeps roster and scoring straightforward.
- **Fixed roster size + tier constraints**: very “fantasy team”.
- **No in-hours transactions** + **out-of-hours execution**: prevents reactive intraday gaming.
- **T+1 effect / you still eat today’s move**: matches how fantasy locks work; avoids “rage-selling the red candle”.

## Places to tighten the rules (recommended)
### 1) Make roster size explicit (min/max vs exact)
Right now “max portfolio size based on constraints” could be interpreted a few ways. For simplicity, pick one:

- **Exact roster size**: e.g. exactly 8 companies, always.
  - Any move is an add+drop pair.
  - Tier constraints become easy to validate.
This is the cleanest.

If you really want “min number + overall max”, you’ll have edge cases like “do I have to be fully invested?” and “can I sit in cash?”. That’s more complexity than benefit early on.

### 2) Clarify what “1 sell and 1 buy per day” means
If you do exact roster size, just define it as:

- **1 swap per day**: drop one company + add one company (a paired transaction).
Then you don’t need to talk about sell/buy separately.

Also, you probably want your weekly cap to match:
- Either **max 5 swaps/week** and no daily cap, or
- **max 1 swap/day** and the weekly cap is redundant (but fine as a safety net)

Having both is okay; just define swap counts clearly.

### 3) Execution timing / scoring window (very important)
You said “execute out of hours that day” and “previous day points still apply”. The cleanest deterministic rule is:

- Transactions are **submitted** after market close (or anytime out-of-hours).
- They become **effective next trading day** at market open (or “for next day’s close-to-close return”).

So:
- If you submit on Monday after close, Tuesday’s return is the first day counted for the new company.
- Monday’s tank still counts for the company you held on Monday.

This is consistent and easy to compute.

### 4) FAAB + swaps: decide if FAAB is always required
In private leagues with unique ownership + free agent pool:
- FAAB makes sense for **adds** (you bid to acquire).

But you also said “1 swap/day”. If every add requires FAAB, users might feel blocked if they run out. That can be fine, but decide intentionally.

Common approach:
- FAAB only used when there’s competition; otherwise minimum bid = 0 works.
- You can allow $0 bids, but tie-break using waiver priority.

### 5) Private-league trading
Your “TBC” is fine. Minimal trade rules you can start with:
- Trades allowed out-of-hours only
- Trade becomes effective next trading day
- Trades must keep both rosters valid (tier constraints, roster size, cost cap)
- Trade deadline near end of season

No voting/commissioner approval for MVP unless you expect abuse.

## Suggested cleaned-up version of your summary (MVP-ready)
- Roster: **exactly 8 companies**, must include **≥1 from each tier**, total tier-cost ≤ cap.
- Scoring: daily points based on **close-to-close % change** (optionally benchmark-relative).
- Transactions:
  - **No market-hours transactions**.
  - Users can submit **1 swap/day** (drop 1 + add 1), max **5 swaps/week**.
  - Swaps **execute next trading day** (T+1); you always receive the points for companies you held during that day.
- Private leagues:
  - **Unique ownership**.
  - Free agents acquired via **FAAB** (season budget), processed in an out-of-hours waiver run.
  - Trades allowed out-of-hours, effective T+1, must keep rosters valid.

If you confirm two specifics, I can help you lock the exact edge-case behavior + data model:
1) What are your tier constraints—how many tiers and “≥1 from each”, or per-slot like “2 from Tier A/B etc”?  
2) When exactly is “out of hours” for your chosen market (e.g., US equities close 21:00 UTC / 16:00 ET), and will you support multiple exchanges or just one market initially?


---

### User

For question 1 give me some example senerios so I understand better.
Initially I wouldn't worry about quest 2 too much. I'll just use midnight utc and have uk stock market for initial. For the full game I'll prob have a market/league selection and that would define switch over timing.


---

### Assistant (gpt-5.2-instant)

## Q1: Tier constraints — examples so you can choose

Assume you have **4 tiers** (just as an example):
- Tier 1 = mega/large
- Tier 2 = large/mid
- Tier 3 = mid/small
- Tier 4 = small (but not microcap)

Roster size is **exactly 8**.

### Model A: “At least one from each tier” (minimums)
Rule:
- Must have **≥1 from each tier**.
- Remaining 4 picks can be any tier (subject to total cost cap).

Example valid rosters:
- 1×T1, 1×T2, 1×T3, 1×T4, plus 4 flex:
  - 3×T1, 2×T2, 2×T3, 1×T4 (valid)
  - 1×T1, 1×T2, 5×T3, 1×T4 (valid)

Example invalid rosters:
- 0×T4 (invalid even if under budget)
- 0×T1 (invalid)

When it feels good:
- You want flexibility but still force some diversification.

Gotcha:
- If T4 stocks are super volatile, everyone will try to “minimize exposure” to T4 with exactly 1 pick. Your scoring/penalties may need to handle that.

### Model B: Slot-based roster (“positions” mapped to tiers)
Instead of minimums, you define 8 slots like:
- 2 slots must be Tier 1–2
- 2 slots must be Tier 2–3
- 2 slots must be Tier 3–4
- 2 flex slots any tier

Example valid:
- Slot group “Tier 3–4” could be filled by Tier 3, Tier 4.

Why it’s nice:
- It forces a distribution without hard “one from each”.
- It’s easier to tune balance (you can reduce required low-tier exposure if it’s too swingy).

Downside:
- Slightly more to explain in UI (“fill these slots”).

### Model C: Minimums + maximums (simple anti-stacking)
Rule example:
- ≥1 from each tier
- Max 3 from Tier 1
- Max 3 from Tier 4

Example:
- 4×T1 would be invalid even though you satisfied “≥1 each”.

Why it’s nice:
- Prevents “all-in on top tier” or “all-in on lottery tier”.

Downside:
- Another rule knob, but still easy to communicate.

### Model D: Only budget + no tier minima (pure cap game)
Rule:
- No tier constraints, only tier-cost cap.

This tends to drift toward “best value tiers” and can converge on similar rosters unless costs are perfectly tuned. Since you explicitly want “must have one from each tier etc”, this isn’t your preference, but mentioning it for contrast.

## My recommendation for your MVP
Start with **Model A (≥1 from each tier)** plus a **tier-cost cap**. It matches your mental model and is easy to validate.

If playtests show everyone takes “exactly one” from a tier, add **Model C max limits** (one line change in rules) or shift to Model B.

## UK + midnight UTC switch (Q2)
Using **midnight UTC** as your “day boundary” is fine for an MVP even though it won’t match the LSE close exactly. Just be explicit in rules: “A game day is UTC 00:00–23:59; we use the official close price for that date.” Later you can swap the boundary per market/league.

If you tell me how many tiers you want (3? 4? 5?) and whether you want to exclude microcaps/illiquid names, I can propose a concrete tiering scheme for UK stocks (e.g., by market cap percentile) that stays stable across a season.


---

### User

Let's go with your recommended model a. And I want 5 tiers


---

### Assistant (gpt-5.2-instant)

Model A with 5 tiers works well. Here’s a concrete way to define it and make it implementable.

## Tier constraint rule (Model A, 5 tiers)
- Roster size: **exactly 8 companies**
- Tier constraints: must have **at least 1 company from each of the 5 tiers**
- The remaining **3 slots are flex** (any tier)
- Plus your existing constraints:
  - total tier-cost cap (draft budget)
  - transaction limits (1 swap/day, max 5/week)
  - no in-hours transactions; swaps effective next day

Validation is simple:
- `countByTier[t] >= 1 for t in 1..5`
- `totalCost <= budget`
- `rosterSize == 8`

## How to define 5 tiers (precomputed, simple)
You want tiers that:
- are stable for a season (no weekly churn)
- are easy to explain
- don’t depend on stock price

Best input is **market cap**. For UK you can tier the eligible universe into quintiles.

### Step-by-step (season start)
1. Choose an eligible universe (important):
   - e.g. “Top 300 UK-listed by market cap” (or FTSE 350 constituents)
   - exclude very illiquid names (optional but recommended), e.g. require:
     - median daily traded value over last 30 trading days ≥ a threshold (say £0.5–£2.0 million)
2. Sort eligible companies by market cap (GBP).
3. Split into 5 equal-sized buckets (quintiles):
   - Tier 1 = top 20%
   - Tier 2 = next 20%
   - …
   - Tier 5 = bottom 20%
4. **Freeze tiers for the season** (critical for fairness + simplicity).

This gives you “big to small” tiers without needing precise absolute thresholds.

## Tier costs (draft budget)
Since you’re using tiers, make costs monotonic:

Example costs:
- Tier 1: 20
- Tier 2: 16
- Tier 3: 12
- Tier 4: 8
- Tier 5: 4

Budget example:
- Team budget = 100
- With the “at least one from each tier” baseline cost is 20+16+12+8+4 = 60
- Leaves 40 to upgrade flex picks toward Tier 1/2.

This tends to create meaningful draft decisions.

## Example valid roster compositions (8 companies)
Each line is counts per tier `[T1,T2,T3,T4,T5]`:

- `[1,1,1,1,4]` valid (meets minima, very small-cap heavy)
- `[3,2,1,1,1]` valid (top-heavy)
- `[2,1,2,1,2]` valid (balanced)

Invalid:
- `[4,2,2,0,0]` invalid (missing T4/T5)
- `[1,1,1,1,3]` would be valid only if it sums to 7; but roster must be exactly 8.

## Transaction validation with tiers (important edge case)
When users swap:
- they must submit “drop A, add B”
- system validates **post-swap** roster still has ≥1 each tier.
This prevents someone from temporarily breaking constraints.

Implementation tip: validate against the roster as it will exist on `effectiveDate`.

## Quick clarifying question (so you don’t hit a wall later)
Do you want the 8-company roster to also require **“exactly one from each tier” for 5 slots + 3 flex**, or simply “≥1 from each tier” (which allows, say, 4 from Tier 1)?  
Model A is “≥1”; it’s simplest, but it can lead to very top-heavy rosters if the budget allows. If you’re unsure, keep “≥1” for MVP and optionally add a max-per-tier later.


---

### User

Clarify you question. I don't understand it


---

### Assistant (gpt-5.2-instant)

You chose Model A: “at least one from each tier”. My question was about whether you want to allow *stacking* extra picks in the same tier beyond that minimum.

With 5 tiers and 8 total companies, there are 3 “extra” slots after you’ve satisfied the 1-per-tier minimum. You have two ways to treat those 3 slots:

## Option 1 (pure Model A): “At least 1 from each tier”
Rule: you must have **≥1** from each tier. The remaining 3 can be **any tier**.

So these are all valid:
- Tier counts `[4,1,1,1,1]` (very Tier-1 heavy)
- `[1,1,1,1,4]` (very Tier-5 heavy)
- `[2,2,1,1,2]` (balanced)

This is simplest and gives maximum freedom. Budget is what prevents everyone going all Tier 1.

## Option 2 (more restrictive): “Exactly 1 from each tier + 3 flex (but flex can’t duplicate tiers)”
People sometimes mean “one from each tier” as “exactly one”, i.e.:
- You pick exactly one Tier 1, exactly one Tier 2, … exactly one Tier 5 (5 picks)
- The remaining 3 picks must come from some special “flex tiers” rule (e.g., only Tier 3–5), or “no more than 2 per tier”, etc.

Example of a restrictive variant:
- “Must have 1 from each tier, and **max 2 from any tier**”
  - `[2,2,2,1,1]` valid
  - `[4,1,1,1,1]` invalid

This reduces extreme rosters, but adds more rules.

## What I’m asking you to choose
Do you want:
- **A)** Just “≥1 from each tier” and stacking is allowed (easiest), or
- **B)** “≥1 from each tier” plus a cap like “max 2 per tier” (a bit more balanced), or
- **C)** something even stricter?

If you’re unsure: pick **A for MVP**, then add “max 2 per tier” later only if playtests show everyone is stacking Tier 1 or Tier 5.


---

### User

A. It should be a minimum of 1 per team.


---

### Assistant (gpt-5.2-instant)

Got it: **Option A**.

### Finalized roster constraint (5 tiers)
- Roster size: **exactly 8 companies**
- Tier rule: **minimum 1 company from each of the 5 tiers**
- The remaining **3 slots are any tier** (stacking allowed)
- Tiers are **precomputed and frozen per season** (recommended)

So any roster is valid as long as tier counts satisfy:
- `T1 >= 1, T2 >= 1, T3 >= 1, T4 >= 1, T5 >= 1`
- `T1 + T2 + T3 + T4 + T5 = 8`

Examples of valid tier distributions:
- `[4,1,1,1,1]`
- `[1,1,1,1,4]`
- `[2,2,1,1,2]`

### Implications for trading/add-drop
Any swap (drop A + add B) must result in a roster that still meets those minima on the **effective day**. E.g., if you currently have only one Tier 3, you can’t drop it unless the add is also Tier 3 (or you already had another Tier 3).

### Next thing to decide (small but important)
When someone submits a swap out-of-hours, do you want it to:
- **Execute immediately** in the out-of-hours window (but still only affects scoring next trading day), or
- Go through a **once-per-day waiver processing** (especially in private unique leagues with FAAB competition)?

Given you want a free agent pool + FAAB, I’d suggest:
- **Private unique leagues**: once-per-day waiver run (bids compete)
- **Global duplicates**: immediate confirmation (no competition), still effective next day

If you want, I can write the exact processing algorithm for both in a way that avoids race conditions.


---

### User

It will count as the next day as the market has technically closed for that day so not swap orders are to be processed.
I want to start looking into some of the coding elements to this. The first thing is that I would like this to be determnistic, meaning  I don't want to have to setup a schedule to grab the data. I want when a user checks it can download the closing values for the previous day and any previous days since last login populate the database then all the history and calculations can be made from that. Also with trades and calculating scores. I will prob have a column in the db which is score but I should be able to derive it and recalculate it form the data in my database. So if there's a issue or I change part of the algorithm I can change everything


---

### Assistant (kimi-k2.5-thinking)

<details>
<summary>Reasoning</summary>

 The user wants to move into technical implementation details. Key requirements:

1. **Deterministic/On-demand data fetching**: No scheduled jobs. When user checks/logs in, system downloads closing values for previous day(s) since last login, populates DB, then calculates history.

2. **Derived/recalculable scores**: Don't just store final score in DB as source of truth. Store raw data (prices, transactions) such that scores can always be recalculated. The "score" column would be a cache/materialized view that can be rebuilt.

3. **Idempotency/Reproducibility**: If algorithm changes or data correction needed, should be able to replay everything.

This is essentially an event-sourcing or functional approach to fantasy scoring. I need to explain:
- The data model (append-only price history, transaction log)
- How to handle "since last login" fetching without missing days
- How to make scoring deterministic and reproducible
- The calculation logic (folding over days)
- Handling corporate actions (splits, dividends) if using adjusted close
- Concurrency/idempotency concerns when multiple users trigger the same fetch

Let me structure this:

1. **Core principle**: Source of truth is (Prices × Transactions). Scores are derived views.
2. **Data model**:
   - `price_cache` (symbol, date, adj_close, fetched_at, source_version)
   - `transaction_log` (team_id, type, symbol, effective_date, submitted_at)
   - `holding_state` could be materialized or computed on the fly
3. **On-demand fetch strategy**:
   - User request triggers "ensure prices up to yesterday"
   - Check last fetched date per symbol
   - Fetch missing range from API (Yahoo Finance, Alpha Vantage, etc.)
   - Idempotent insert (ON CONFLICT DO NOTHING or UPSERT)
   - Then recalculate
4. **Scoring as pure function**:
   - Function: `(roster_at_date, prices_for_date) -> score_for_date`
   - Can be recomputed for any historical date
   - Store results in `team_daily_score` with versioning
5. **Handling the "since last login"**:
   - Need to track `last_price_update` per symbol or globally
   - When user hits endpoint, check gaps, fill them
   - Race condition handling (two users trigger same fetch simultaneously)
6. **Recalculation on algorithm change**:
   - Bump `scoring_version` in code
   - Recompute all `team_daily_score` rows, or compute on read with caching
   - Or use lazy invalidation

Also need to mention that "no scheduled jobs" has tradeoffs:
- First user of the day pays the latency cost of fetching all prices
- Need to handle API rate limits carefully
- If no one logs in for days, data stays stale (but that's acceptable per requirements)

Let me provide concrete SQL schema suggestions and pseudocode for the calculation logic.

Key technical points:
- Use UPSERT/ON CONFLICT for idempotent price inserts
- Transactions have `effective_date` (when they count for holdings)
- Holdings are derived from transaction log up to date D
- Score is sum over holdings of (return * multiplier)

For the UK market specifically:
- LSE trading days (no weekends, UK holidays)
- Need a calendar table or logic to determine "previous trading day"

I should also mention that "adjusted close" handles splits/dividends historically, so you don't need to fetch intraday - just EOD adjusted.

Structure:
1. High level architecture (event sourcing style)
2. Schema (prices, transactions, scores as derived)
3. The fetch-on-demand flow
4. The scoring calculation (pure function)
5. Handling recalculation/versioning
6. Edge cases (holidays, gaps, API failures)

Keep it concise since user is senior engineer and wants technical details.
</details>

 Here is a deterministic, “recalculate anytime” architecture that fits your constraints.

## 1) Core principle: Event sourcing style
Treat prices and roster moves as **immutable facts**. The “score” is a pure function derived from those facts.

**Source of truth tables:**
```sql
-- Immutable price cache (idempotent inserts)
price_daily (
  symbol text,
  date date,              -- trading date (LSE calendar)
  adj_close decimal,      -- split/dividend adjusted
  fetched_at timestamptz,
  source_version int,     -- in case you change data provider
  primary key (symbol, date)
);

-- Immutable transaction log (every add/drop/trade/draft pick)
roster_move (
  id uuid,
  team_id uuid,
  type enum('DRAFT','ADD','DROP','TRADE'),
  symbol text,
  effective_date date,    -- first day this move counts for scoring
  metadata jsonb,         -- bid amount, trade partner, etc.
  created_at timestamptz,
  primary key (id)
);

-- Derived/cached score (can be dropped and rebuilt)
team_day_score (
  team_id uuid,
  date date,
  points decimal,
  breakdown jsonb,        -- per-symbol contributions for debugging
  scoring_version int,    -- algorithm version used
  computed_at timestamptz,
  primary key (team_id, date, scoring_version)
);
```

## 2) The “fetch on demand” flow
When any user requests data (dashboard, leaderboard, etc.):

```python
def ensure_prices_upto(yesterday: date):
    # Find gaps per symbol needed by active leagues
    symbols = get_active_symbols()
    
    for sym in symbols:
        last_date = query("SELECT max(date) FROM price_daily WHERE symbol = ?", sym)
        if last_date < yesterday:
            # Fetch range from API (Yahoo, EODHD, etc.)
            bars = fetch_eod(sym, start=last_date + 1 day, end=yesterday)
            
            # Idempotent insert (handles retries/race conditions)
            execute("""
                INSERT INTO price_daily (symbol, date, adj_close, fetched_at, source_version)
                VALUES (?, ?, ?, now(), 1)
                ON CONFLICT (symbol, date) DO UPDATE SET
                    adj_close = EXCLUDED.adj_close,
                    fetched_at = EXCLUDED.fetched_at
                WHERE price_daily.fetched_at < EXCLUDED.fetched_at  -- only if newer
            """, bars)
```

**Key points:**
- `ON CONFLICT` makes it safe for two users to trigger the same fetch simultaneously.
- You only fetch **missing trading days** (skip weekends/holidays using a LSE calendar table).
- First user of the day pays the API latency; subsequent requests hit cache.

## 3) Scoring as a pure function (reproducible)
Define a function that takes a `(team_id, date)` and returns points **without writing to DB**:

```python
def calculate_team_day(team_id: uuid, date: date, prices: dict) -> Score:
    # 1. Reconstruct holdings at start of 'date'
    moves = query("""
        SELECT symbol, type, effective_date 
        FROM roster_move 
        WHERE team_id = ? AND effective_date <= ?
        ORDER BY effective_date, created_at
    """, team_id, date)
    
    holdings = apply_moves(moves)  # current roster as of 'date'
    
    # 2. Calculate returns
    total = 0
    breakdown = {}
    for symbol in holdings.starters:  # you track which are "starting" if needed
        today_price = prices[symbol][date]
        prev_price = prices[symbol][previous_trading_day(date)]
        
        daily_return = (today_price - prev_price) / prev_price
        points = daily_return * 100 * MULTIPLIER  # your K factor
        
        # Apply first-day penalty if applicable
        if is_first_day(holdings[symbol], date):
            points *= 0.5  # or flat penalty
            
        total += points
        breakdown[symbol] = points
    
    return Score(points=total, breakdown=breakdown)
```

**Determinism checks:**
- Use **only** `effective_date` and `adj_close` (splits handled by data provider).
- `previous_trading_day()` uses a static LSE holiday calendar (store in DB or code).
- No `now()`, no randomness, no external state.

## 4) Populating scores (lazy or eager)
Since you want to recalculate on algorithm changes, treat `team_day_score` as a **materialized cache**:

**Option A: Lazy (on read)**
- User hits leaderboard → check `max(scoring_version)` in code vs DB.
- If mismatch or missing rows, run `calculate_team_day()` for missing ranges, write to DB, return result.
- This naturally handles “I changed the algorithm” — old cached scores are ignored (different version).

**Option B: Eager (on price fetch)**
- After `ensure_prices_upto()` completes, trigger backfill for all affected teams/dates.
- Use a background job queue if you add one later, or do it synchronously if the league is small.

## 5) Handling algorithm changes
When you change scoring logic:
1. Bump `CURRENT_SCORING_VERSION = 2` in code.
2. Either:
   - **Delete** old cache: `DELETE FROM team_day_score WHERE scoring_version < 2` (lazy recalc on next read), or
   - **Keep** old versions for audit, but query only `WHERE scoring_version = 2`.

The `breakdown` JSONB column lets you debug: “Why did I get 12.3 points?” → inspect the per-symbol contributions.

## 6) Edge cases to handle
- **Gaps in price data** (stock halted): Decide rule — carry last price (0 return) or exclude from scoring that day.
- **Corporate actions mid-season**: Since you use `adj_close`, historical prices auto-adjust when you refetch, but this changes past scores. If you want immutability, snapshot `adj_close` into `price_daily` and never update it (the `ON CONFLICT` above only updates if `fetched_at` is newer, but you might prefer `DO NOTHING` after first insert).
- **Timezones**: Store all dates as **LSE trading dates** (no time component), midnight UTC is fine for the boundary.

## 7) Trading/transaction validation
When user submits a swap:
- Validate against holdings derived from `roster_move` up to `today` (same logic as scoring).
- Insert new rows with `effective_date = next_trading_day(today)`.
- Idempotency: generate a unique constraint or idempotency key on the request to prevent double-submit.

This design means you can literally drop the `team_day_score` table, change your points formula, redeploy, and the next user request will repopulate everything correctly from `price_daily` + `roster_move`.

Do you want me to sketch the specific SQL for reconstructing holdings from the move log, or the API fetch logic with rate-limiting handling?


---

### User

This is good. Note I'm going to be using TypeScript. Don't worry about versioning I'm not adding that in for now. It was more as an example of the capibilties. Assume I'm using TypeScript and drizzle. And prob tanstack start


---

### Assistant (kimi-k2.5-thinking)

<details>
<summary>Reasoning</summary>

The user is confirming the tech stack: TypeScript, Drizzle ORM, TanStack Start. They like the deterministic approach but want to drop the versioning complexity for now. They want the architecture to fit this stack.

Key things to address:
1. Database schema in Drizzle style (TypeScript)
2. The "fetch on demand" logic in TypeScript
3. The pure function scoring calculation
4. How to reconstruct holdings from the move log (this was specifically asked at the end of the previous message)
5. Handling the "next trading day" logic with UK/LSE calendar
6. Keeping it simple - no background jobs, no versioning, just deterministic recalculation on read with caching

I should provide:
- Drizzle schema definitions (tables: priceDaily, rosterMove, teamDayScore as cache)
- TypeScript functions for:
  - ensurePricesUpto (fetch missing prices)
  - calculateTeamDay (pure function)
  - getHoldingsForDate (reconstructing from move log)
  - nextTradingDay (LSE calendar handling)
- The "lazy" approach for the cache (check if exists, calculate if not, store, return)
- Handling the LSE trading calendar (simplified - just store holidays or use a library)

Important details:
- No versioning (scoring_version column can be removed or ignored)
- Deterministic: same inputs always give same outputs
- Roster moves have effective_date (trading date, not timestamp)
- Price data is idempotent (upsert)
- The "first day penalty" logic needs to be in the calculation
- Must handle the "exactly 8 companies" and tier constraints validation separately (probably at transaction time, not in the scoring function)

Let me structure this:

1. Schema (Drizzle)
2. Pure calculation functions (no DB writes except caching)
3. The "get or compute" wrapper
4. Trading calendar helper
5. Example usage flow

I should use proper Drizzle syntax (pgTable, etc.) and modern TypeScript patterns.

Also mention that since they're using TanStack Start, they can use server functions (RPC) for the data fetching.

Key insight: The "ensurePricesUpto" should probably be a server function that runs when user loads the app, ensuring data is fresh before any calculations.

Let me draft the code structure.

Schema:
- priceDaily: symbol, date, adjClose, fetchedAt
- rosterMove: id, teamId, type (enum), symbol, effectiveDate, metadata (jsonb), createdAt
- teamDayScore: teamId, date, points, breakdown (json), computedAt (optional cache timestamp)

Note: I should use 'date' type properly. In Drizzle with Postgres, that's pgTable with date column.

Calculation logic:
- Get all moves for team up to date X
- Apply them chronologically to get holdings at start of date X
- Get prices for date X and previous trading day
- Calculate returns
- Apply first day penalty (check if effectiveDate == date for any holding)

Wait, the "first day penalty" - if I buy today effective tomorrow, then tomorrow is the first day. So if effectiveDate == currentDate, apply penalty.

Actually the user said: "buying and seeing will execute out of hours that day. But points wins or losses from previous day will apply"

So:
- Submit swap on Monday after close
- Effective Tuesday
- Tuesday's performance is calculated, but with penalty

So yes, if effectiveDate == tradingDate, apply penalty.

Holdings reconstruction:
Start with empty roster
Apply moves where effectiveDate <= targetDate
But need to track when each holding was added for the penalty.

So holdings structure should be:
{
  symbol: string;
  addedDate: Date; // effectiveDate of the move that added it
  tier: number; // cached or looked up
}

Wait, tier is on the instrument table, not the move. So I need an instrument table or lookup.

Actually I should add:
- instrument: symbol, name, tier, tierCost, sector, etc.

So schema:
- instrument: symbol (PK), tier, cost, etc.
- priceDaily: symbol, date, adjClose
- rosterMove: id, teamId, symbol, type, effectiveDate

Then calculateTeamDay(teamId, date):
1. Get moves <= date, order by effectiveDate, createdAt
2. Build currentHoldings: Map<symbol, addedDate>
   - On ADD: set addedDate = effectiveDate
   - On DROP: delete from map
3. Get previousTradingDay(date)
4. For each symbol in currentHoldings:
   - Get price today and yesterday
   - Calculate return
   - If currentHoldings[symbol].addedDate == date, apply penalty
   - Sum
5. Return points and breakdown

Then the cache layer:
getTeamDayScore(teamId, date):
- Check teamDayScore table
- If exists and computedAt is after the last roster move for that team, return it
- Else calculate, insert/update, return

Actually simpler: Just check if row exists. If not, calculate and save. If you want to "bust cache", you delete the row.

But the user wants deterministic recalculation capability. So the cache is just for performance. If they change algorithm, they can delete rows or add a version column later. For now, simple.

LSE Trading calendar:
Simplest: Store holidays in a table lseHolidays (date)
Or use a library like date-fns with a list of holidays.
Given it's TanStack Start/TypeScript, probably best to have a table or a static list for now.

Let's go with a simple approach: A table tradingCalendar(date, isTradingDay, nextTradingDay, prevTradingDay)
Or just query for the last price date before current date.

Actually simpler for "previous trading day":
SELECT max(date) FROM priceDaily WHERE symbol = 'SOMEBENCHMARK' AND date < currentDate
But that requires prices to exist.

Better: Have a calendar table.

Let me write the actual Drizzle schema and TypeScript code.

One thing: The user mentioned "midnight UTC" for the boundary. So the "date" is just the date part.

Also, they want to ensure prices are fetched "when a user checks it". So in the loader function (TanStack Start), they would call ensurePricesUpto(yesterday).

Wait, "yesterday" depends on current time. If it's 10am UTC on Tuesday, yesterday was Monday, but LSE hasn't opened yet on Tuesday? Actually LSE opens 8am GMT/UTC.

But they said midnight UTC is the boundary. So:
- Game day is 00:00-23:59 UTC
- Close prices are for that UTC day (LSE closes at 16:30 UK time, which is 16:30 or 17:30 UTC depending on DST... wait, UK time is UTC or UTC+1).

Actually this is messy. The user said "I'll just use midnight utc" for the boundary, and "uk stock market". 

LSE close is 16:30 UK local time.
In winter (GMT): 16:30 UTC
In summer (BST): 15:30 UTC

If they use midnight UTC as the boundary, that's well after close.

So "today" in game terms = the trading day that just closed at the previous midnight UTC (roughly).

Actually, simpler:
- The "game date" is the trading date.
- At midnight UTC, the trading day is definitely closed (LSE closes ~4:30pm UK time).
- So "yesterday" = the last trading day before or on today.

Anyway, for the code structure, I'll assume we have a function getLastTradingDate(beforeDate: Date) that returns the previous trading date.

Let me write the code.
</details>

Here’s a deterministic, recalc-friendly architecture using **Drizzle + TanStack Start**. No background jobs—everything happens when users hit your loaders.

## 1) Drizzle Schema

```typescript
import { pgTable, text, date, decimal, jsonb, uuid, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

// Universe of draftable companies (tiers frozen per season)
export const instruments = pgTable("instruments", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  tier: decimal("tier", { precision: 1, scale: 0 }).notNull(), // 1-5
  tierCost: decimal("tier_cost", { precision: 10, scale: 2 }).notNull(),
  exchange: text("exchange").notNull().default("LSE"),
});

// Immutable price cache (idempotent upserts)
export const priceDaily = pgTable("price_daily", {
  symbol: text("symbol").notNull(),
  date: date("date", { mode: "date" }).notNull(),
  adjClose: decimal("adj_close", { precision: 18, scale: 8 }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.symbol, t.date] }),
  symbolIdx: index("price_symbol_idx").on(t.symbol),
}));

// Every roster change (draft, add, drop, trade)
export const rosterMoves = pgTable("roster_moves", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(), // link to your teams table
  type: text("type", { enum: ["DRAFT", "ADD", "DROP", "TRADE"] }).notNull(),
  symbol: text("symbol").notNull(),
  effectiveDate: date("effective_date", { mode: "date" }).notNull(), // first day it scores
  metadata: jsonb("metadata").$type<{ dropSymbol?: string; faabBid?: number }>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  teamDateIdx: index("move_team_date_idx").on(t.teamId, t.effectiveDate),
}));

// Derived cache (can be truncated anytime)
export const teamDayScores = pgTable("team_day_scores", {
  teamId: uuid("team_id").notNull(),
  date: date("date", { mode: "date" }).notNull(),
  points: decimal("points", { precision: 12, scale: 4 }).notNull(),
  breakdown: jsonb("breakdown").$type<Record<string, number>>().notNull(), // per-symbol contributions
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.teamId, t.date] }),
}));
```

## 2) Deterministic Calculation Core

```typescript
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "./db";

// Reconstruct holdings for a specific trading date
export async function getHoldingsAtDate(teamId: string, date: Date) {
  // Get all moves effective on or before this date, chronological
  const moves = await db.query.rosterMoves.findMany({
    where: and(
      eq(rosterMoves.teamId, teamId),
      lte(rosterMoves.effectiveDate, date)
    ),
    orderBy: [rosterMoves.effectiveDate, rosterMoves.createdAt],
  });

  const holdings = new Map<string, { addedDate: Date; tier: number }>();
  
  for (const move of moves) {
    if (move.type === "DROP") {
      holdings.delete(move.symbol);
    } else {
      // ADD, DRAFT, TRADE (incoming)
      const inst = await db.query.instruments.findFirst({
        where: eq(instruments.symbol, move.symbol),
        columns: { tier: true }
      });
      if (!inst) throw new Error(`Unknown symbol ${move.symbol}`);
      
      holdings.set(move.symbol, {
        addedDate: move.effectiveDate,
        tier: inst.tier,
      });
    }
  }
  
  return holdings;
}

// Get previous trading date using the price data itself (deterministic)
export async function getPreviousTradingDate(date: Date, symbol: string = "VOD.L") {
  // Use a liquid benchmark to find trading days, or maintain a calendar table
  const result = await db
    .select({ date: priceDaily.date })
    .from(priceDaily)
    .where(and(
      eq(priceDaily.symbol, symbol),
      lte(priceDaily.date, date),
      sql`date < ${date}` // strict less than
    ))
    .orderBy(desc(priceDaily.date))
    .limit(1);
    
  if (!result[0]) throw new Error(`No previous trading day found for ${date}`);
  return result[0].date;
}

// Pure scoring function (no side effects)
export async function calculateTeamDay(
  teamId: string, 
  date: Date,
  config: { multiplier: number; firstDayPenalty: number } = { multiplier: 100, firstDayPenalty: 0.5 }
) {
  const holdings = await getHoldingsAtDate(teamId, date);
  const symbols = Array.from(holdings.keys());
  
  if (symbols.length === 0) return { points: 0, breakdown: {} };
  
  // Fetch prices for today and yesterday
  const prevDate = await getPreviousTradingDate(date);
  
  const pricesToday = await db.query.priceDaily.findMany({
    where: and(eq(priceDaily.date, date), sql`${priceDaily.symbol} = ANY(${symbols})`),
  });
  
  const pricesYesterday = await db.query.priceDaily.findMany({
    where: and(eq(priceDaily.date, prevDate), sql`${priceDaily.symbol} = ANY(${symbols})`),
  });
  
  const priceMapToday = new Map(pricesToday.map(p => [p.symbol, Number(p.adjClose)]));
  const priceMapYesterday = new Map(pricesYesterday.map(p => [p.symbol, Number(p.adjClose)]));
  
  let totalPoints = 0;
  const breakdown: Record<string, number> = {};
  
  for (const [symbol, meta] of holdings) {
    const today = priceMapToday.get(symbol);
    const yesterday = priceMapYesterday.get(symbol);
    
    if (today === undefined || yesterday === undefined) {
      // Missing data: treat as 0 return or skip (your call)
      breakdown[symbol] = 0;
      continue;
    }
    
    const dailyReturn = (today - yesterday) / yesterday;
    let points = dailyReturn * config.multiplier;
    
    // First day penalty: if added today, apply penalty
    if (meta.addedDate.getTime() === date.getTime()) {
      points *= config.firstDayPenalty;
    }
    
    breakdown[symbol] = Number(points.toFixed(4));
    totalPoints += points;
  }
  
  return { 
    points: Number(totalPoints.toFixed(4)), 
    breakdown 
  };
}
```

## 3) The "Fetch On Demand" + Cache Layer

```typescript
import { startOfDay, subDays, isBefore } from "date-fns";

// Ensure we have prices up to yesterday (or specific date)
export async function ensurePricesUpto(targetDate: Date = subDays(new Date(), 1)) {
  const symbols = await db.select({ symbol: instruments.symbol }).from(instruments);
  
  for (const { symbol } of symbols) {
    const lastPrice = await db
      .select({ date: priceDaily.date })
      .from(priceDaily)
      .where(eq(priceDaily.symbol, symbol))
      .orderBy(desc(priceDaily.date))
      .limit(1);
      
    const lastDate = lastPrice[0]?.date ?? subDays(targetDate, 30); // default to 30 days back if empty
    
    if (isBefore(lastDate, targetDate)) {
      // Fetch from your provider (EODHD, Yahoo, etc.)
      const bars = await fetchEodData(symbol, lastDate, targetDate);
      
      if (bars.length > 0) {
        await db.insert(priceDaily).values(bars.map(b => ({
          symbol,
          date: b.date,
          adjClose: String(b.adjClose),
          fetchedAt: new Date(),
        }))).onConflictDoUpdate({
          target: [priceDaily.symbol, priceDaily.date],
          set: { fetchedAt: new Date() } // or update price if you trust newer data
        });
      }
    }
  }
}

// The function your TanStack Start loader calls
export async function getTeamScore(teamId: string, date: Date) {
  // 1. Ensure prices exist (idempotent)
  await ensurePricesUpto(date);
  
  // 2. Check cache
  const cached = await db.query.teamDayScores.findFirst({
    where: and(
      eq(teamDayScores.teamId, teamId),
      eq(teamDayScores.date, date)
    ),
  });
  
  if (cached) return cached;
  
  // 3. Calculate deterministically
  const result = await calculateTeamDay(teamId, date);
  
  // 4. Cache (upsert in case of race condition)
  await db.insert(teamDayScores).values({
    teamId,
    date,
    points: String(result.points),
    breakdown: result.breakdown,
    computedAt: new Date(),
  }).onConflictDoUpdate({
    target: [teamDayScores.teamId, teamDayScores.date],
    set: {
      points: String(result.points),
      breakdown: result.breakdown,
      computedAt: new Date(),
    }
  });
  
  return result;
}
```

## 4) Trading Calendar Helper (LSE)

```typescript
// Simple LSE calendar - populate this table once per year or use a library
export const tradingCalendar = pgTable("trading_calendar", {
  date: date("date", { mode: "date" }).primaryKey(),
  isTradingDay: decimal("is_trading_day", { precision: 1, scale: 0 }).notNull(), // 0 or 1
  nextTradingDay: date("next_trading_day", { mode: "date" }),
  prevTradingDay: date("prev_trading_day", { mode: "date" }),
});

// Use this for effective dates
export async function getNextTradingDay(fromDate: Date) {
  const row = await db.query.tradingCalendar.findFirst({
    where: gte(tradingCalendar.date, fromDate),
    orderBy: tradingCalendar.date,
  });
  return row?.nextTradingDay ?? fromDate; // fallback
}
```

## 5) Key Implementation Notes

**Determinism guarantees:**
- `calculateTeamDay` uses only `rosterMoves` + `priceDaily` + `instruments` (frozen tiers).
- No `new Date()` inside calculation (only for cache timestamp).
- If you change the scoring algorithm, just `TRUNCATE teamDay_scores` (or delete specific rows) and they’ll recalculate on next load.

**Transaction validation (swaps):**
When users submit a swap:
```typescript
// In your mutation
const effectiveDate = await getNextTradingDay(today); // tomorrow's trading date

// Validate: reconstruct holdings at effectiveDate - 1 day, simulate the move, check constraints
const simulated = await simulateSwap(teamId, dropSymbol, addSymbol, effectiveDate);
if (simulated.tierCounts.T1 < 1 || simulated.tierCounts.T2 < 1 /* ... */) throw new Error("Tier violation");
if (simulated.totalCost > budget) throw new Error("Over budget");

await db.insert(rosterMoves).values([
  { teamId, type: "DROP", symbol: dropSymbol, effectiveDate },
  { teamId, type: "ADD", symbol: addSymbol, effectiveDate },
]);
```

**Performance:**
- For a league of 10 teams × 252 trading days, `teamDayScores` is only 2,520 rows—tiny. You can recalculate the whole season in <100ms if needed.
- Add an index on `priceDaily(symbol, date)` (shown in schema).

Want me to sketch the `simulateSwap` function that validates tier/cost constraints before allowing the move?


---

### User

ok, now based on this whole thread give me a full design document and summary, both functional and summary taking into account all info discussed


---

### Assistant (claude-4.6-opus)

<details>
<summary>Reasoning</summary>

The user wants a comprehensive design document covering everything we've discussed. Let me compile all the functional and technical details into a well-structured document.
</details>

# Fantasy Stock Market — Design Document

## 1. Overview

### 1.1 Concept
A fantasy-draft-style game where players draft **companies** instead of athletes. Each day, a company's **percentage change in stock price** translates into points—analogous to goals scored in fantasy football. Players compete in leagues by assembling and managing a portfolio of companies within budget and tier constraints.

### 1.2 Core Loop
1. Join or create a league.
2. Draft a team of 8 companies within budget and tier rules.
3. Each trading day, companies score points based on their daily % price change.
4. Manage your roster mid-season via swaps and (in private leagues) trades.
5. End-of-season: highest cumulative points wins.

### 1.3 Key Design Principles
- **Deterministic**: all scores are derived from immutable price data + roster move history. No scheduled jobs required. Scores can be recalculated at any time from source data.
- **Simple first**: no bench slots, no intraday data, no complex risk-adjusted scoring in MVP.
- **Two modes**: private leagues (unique ownership, FAAB, trades) and global leagues (duplicates allowed, transfer limits).

---

## 2. Game Rules

### 2.1 Roster
- Roster size: **exactly 8 companies** at all times.
- All 8 are "starters"—no bench.
- Every company in the universe is assigned to one of **5 tiers** (frozen for the season).

### 2.2 Tier System
Tiers are computed at season start from the eligible universe:

| Tier | Description | Draft Cost | Approximate Universe Slice |
|------|------------|------------|---------------------------|
| 1 | Mega / large cap | 20 | Top 20% by market cap |
| 2 | Large / upper-mid | 16 | Next 20% |
| 3 | Mid cap | 12 | Next 20% |
| 4 | Lower-mid / small | 8 | Next 20% |
| 5 | Small cap | 4 | Bottom 20% |

**Tier assignment process (once per season):**
1. Select eligible universe (e.g. top 300 UK-listed companies by market cap, filtered for minimum liquidity).
2. Sort by market cap descending.
3. Split into 5 equal-sized quintiles.
4. Freeze tier assignments for the entire season.

### 2.3 Roster Constraints
- **Minimum 1 company from each of the 5 tiers.**
- Remaining 3 slots can be any tier (stacking allowed).
- **Total tier-cost must not exceed the draft budget** (e.g. 100).
- Baseline cost of 1 per tier = 20+16+12+8+4 = 60, leaving 40 for upgrades.

Valid roster examples (tier counts `[T1,T2,T3,T4,T5]`):
- `[4,1,1,1,1]` — top-heavy, cost = 80+16+12+8+4 = 120 ❌ (over budget at default costs)
- `[3,1,1,1,2]` — cost = 60+16+12+8+8 = 104 ❌
- `[2,2,1,1,2]` — cost = 40+32+12+8+8 = 100 ✅
- `[1,1,2,2,2]` — cost = 20+16+24+16+8 = 84 ✅
- `[1,1,1,1,4]` — cost = 20+16+12+8+16 = 72 ✅

### 2.4 Scoring
**Daily points per company:**
```
daily_return = (adj_close_today - adj_close_yesterday) / adj_close_yesterday
points = daily_return × 100 × K
```
Where `K` is a configurable multiplier (e.g. `K = 10`, so a +1.23% day = +12.3 points).

**Team daily score** = sum of points across all 8 holdings.

**Season score** = sum of all team daily scores across all trading days.

**First-day penalty:** when a company is newly added to a roster (via swap or trade), its points on the first scoring day are multiplied by **0.5** (50% dampener). This discourages excessive churn.

**Missing price data:** if a company has no price for a given trading day (halt, data gap), it scores **0 points** for that day.

### 2.5 Scoring Day Definition
- A "game day" corresponds to a **trading day on the chosen exchange** (LSE for MVP).
- Daily return is **close-to-close** using adjusted close prices.
- Day boundary for MVP: **midnight UTC**.
- Weekends and exchange holidays are non-scoring days (no points, no transactions processed).

### 2.6 Optional: Benchmark-Relative Scoring
To reduce the effect of "the whole market went up":
```
points = (company_return - benchmark_return) × 100 × K
```
Where benchmark is a broad index ETF (e.g. FTSE 100 tracker). This is optional and can be toggled per league.

---

## 3. League Modes

### 3.1 Private Leagues (Friends)
- **Ownership**: unique — each company can only be on one team.
- **Draft**: auction or snake draft with budget constraints.
- **Mid-season transactions**:
  - Swaps via **FAAB** (Free Agent Acquisition Budget) waiver system.
  - Direct **trades** between teams.
- Typical league size: 4–12 teams.

### 3.2 Global Leagues
- **Ownership**: duplicates allowed — multiple teams can hold the same company.
- **Draft**: self-selected portfolio within budget/tier constraints (no draft event needed).
- **Mid-season transactions**: transfer system with limits (no FAAB needed since there's no scarcity).
- League size: unlimited.

---

## 4. Drafting

### 4.1 Private League Draft
**Snake draft:**
- Teams take turns picking companies in serpentine order.
- Each pick assigns a company to that team exclusively.
- Timer per pick (e.g. 60–90 seconds); auto-pick on timeout (highest tier-cost company that fits constraints).

**Auction draft:**
- Companies are nominated one at a time.
- All teams submit blind bids (or live ascending bids).
- Highest bid wins; bid amount deducted from draft budget.

Both formats enforce tier constraints and budget throughout.

### 4.2 Global League "Draft"
No formal draft event. Users simply select 8 companies from the universe within constraints. Can be done at any time before the season starts (or when joining mid-season).

### 4.3 Draft Data Model
Every pick is recorded as a `roster_move` with `type = 'DRAFT'` and `effective_date = season_start_date`.

---

## 5. Mid-Season Transactions

### 5.1 Core Rules (Both Modes)
- **No transactions during market hours.** Swaps can only be submitted when the market is closed.
- **All moves effective next trading day (T+1).** If you submit a swap on Monday evening, it takes effect Tuesday. Monday's score still reflects your old roster.
- **First-day penalty** applies to any newly added company (50% points on first scoring day).

### 5.2 Swaps (Add/Drop)
A swap is always a paired operation: **drop 1 company + add 1 company** (roster stays at exactly 8).

**Limits:**
- Maximum **1 swap per day**.
- Maximum **5 swaps per week** (Monday–Friday).

**Validation (pre-swap):**
- Post-swap roster must still satisfy:
  - ≥1 company from each tier.
  - Total tier-cost ≤ budget.
  - Roster size = 8.

### 5.3 Free Agent Pool
Any company in the universe that is not on a team (in unique-ownership leagues) is a "free agent." Dropped companies return to the free agent pool.

### 5.4 FAAB (Private Leagues Only)
FAAB = **Free Agent Acquisition Budget**. A seasonal currency used to bid on free agents.

**How it works:**
- Each team receives a **FAAB budget at season start** (e.g. 100).
- To add a free agent, submit a swap claim with a **blind bid** (integer, 0–remaining FAAB).
- Once per day (after market close), all pending claims are processed:
  - If multiple teams bid on the same company, **highest bid wins**.
  - Tie-break: reverse league standings (worst team wins ties).
  - Winner's bid is deducted from their FAAB. Losers keep their FAAB.
- FAAB **does not reset**. Once spent, it's gone for the season.
- **No refunds** on drops. Dropping a company does not return FAAB.
- $0 bids are allowed (useful when no competition is expected).

### 5.5 Transfers (Global Leagues)
Since duplicates are allowed, there's no scarcity and no need for FAAB.

- Users can swap freely within the daily/weekly limits.
- Swaps are confirmed immediately (but effective T+1).
- Optional: a **point penalty per swap** (e.g. −5 points after the first free swap per week) to further discourage churn. This is in addition to the first-day dampener.

### 5.6 Trades (Private Leagues Only)
Direct company-for-company swaps between two teams.

**Rules:**
- Both teams must have valid rosters post-trade (tier constraints, budget, roster size).
- Trades are submitted out-of-hours only.
- Effective next trading day (T+1).
- First-day penalty applies to all incoming companies for both teams.
- **Trade deadline**: no trades allowed in the final 2 weeks of the season.
- **Approval**: auto-approved on submission for MVP (no commissioner review).

---

## 6. Season Structure

### 6.1 Timeline
- **Pre-season**: league creation, team joining, draft.
- **Regular season**: daily scoring across all trading days in the defined period (e.g. 3 months, 6 months, or a calendar quarter).
- **Trade deadline**: 2 weeks before season end.
- **Season end**: final trading day. Cumulative points determine winner.

### 6.2 Scoring Periods
- Scoring is **daily** (each trading day is one scoring period).
- Leaderboards show daily scores and cumulative totals.
- No weekly matchups for MVP—pure cumulative points. Head-to-head matchups can be added later.

### 6.3 Market Calendar
- MVP: **LSE (London Stock Exchange)** trading calendar.
- Non-trading days (weekends, UK bank holidays) = no scoring, no transaction processing.
- A `trading_calendar` table defines valid trading days and their prev/next relationships.
- Future: support multiple exchanges per league with exchange-specific calendars and day boundaries.

---

## 7. Technical Architecture

### 7.1 Stack
- **Framework**: TanStack Start (full-stack TypeScript, SSR).
- **ORM**: Drizzle ORM.
- **Database**: PostgreSQL.
- **Market data**: EOD (end-of-day) provider (e.g. EODHD, Yahoo Finance, or similar).

### 7.2 Core Principle: Event Sourcing / Derived State
The system has two categories of data:

**Source of truth (immutable):**
- `price_daily` — cached EOD prices (idempotent upserts).
- `roster_moves` — append-only log of every draft pick, add, drop, and trade.
- `instruments` — company universe with frozen tier assignments.
- `trading_calendar` — LSE trading days.

**Derived (rebuildable cache):**
- `team_day_scores` — can be truncated and fully recalculated from source tables at any time.

This means:
- No scheduled background jobs required.
- Algorithm changes are deployed by clearing the cache; scores recalculate on next access.
- Full audit trail of every roster change.

### 7.3 Data Flow: "Fetch on Demand"

```
User opens dashboard
        │
        ▼
  TanStack loader fires
        │
        ▼
  ensurePricesUpto(yesterday)
  ┌─────────────────────────┐
  │ For each active symbol: │
  │   Find last cached date │
  │   Fetch missing days    │
  │   Upsert into DB        │
  └─────────────────────────┘
        │
        ▼
  getTeamScores(teamId, dateRange)
  ┌──────────────────────────────┐
  │ For each missing date:       │
  │   Reconstruct holdings       │
  │   Calculate daily returns    │
  │   Apply first-day penalty    │
  │   Sum points                 │
  │   Cache in team_day_scores   │
  └──────────────────────────────┘
        │
        ▼
  Return scores to UI
```

- First user of the day pays the API fetch latency.
- Subsequent requests hit the DB cache.
- Race conditions handled via `ON CONFLICT` upserts.

### 7.4 Database Schema

```sql
-- Company universe (tiers frozen per season)
instruments (
  symbol          TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  tier            INTEGER NOT NULL,        -- 1-5
  tier_cost       DECIMAL(10,2) NOT NULL,  -- 4/8/12/16/20
  exchange        TEXT NOT NULL DEFAULT 'LSE'
)

-- EOD price cache (idempotent)
price_daily (
  symbol          TEXT NOT NULL,
  date            DATE NOT NULL,
  adj_close       DECIMAL(18,8) NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date)
)

-- Append-only roster move log
roster_moves (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL,
  type            TEXT NOT NULL,            -- DRAFT | ADD | DROP | TRADE
  symbol          TEXT NOT NULL,
  effective_date  DATE NOT NULL,
  metadata        JSONB DEFAULT '{}',       -- faab_bid, trade_partner, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Derived score cache (rebuildable)
team_day_scores (
  team_id         UUID NOT NULL,
  date            DATE NOT NULL,
  points          DECIMAL(12,4) NOT NULL,
  breakdown       JSONB NOT NULL,           -- { "VOD.L": 12.3, "SHEL.L": -4.1, ... }
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, date)
)

-- LSE trading calendar
trading_calendar (
  date              DATE PRIMARY KEY,
  is_trading_day    BOOLEAN NOT NULL,
  next_trading_day  DATE,
  prev_trading_day  DATE
)
```

### 7.5 Holdings Reconstruction
Holdings at any date are derived by replaying `roster_moves` up to that date:

1. Query all moves for `team_id` where `effective_date <= target_date`, ordered chronologically.
2. Apply in sequence: `DRAFT`/`ADD`/`TRADE` → add symbol to holdings set. `DROP` → remove symbol.
3. Result: current holdings + the date each was added (for first-day penalty).

No snapshot table needed. For a season of ~252 trading days and 8 companies, this replay is trivially fast.

### 7.6 Score Calculation (Pure Function)
For a given `(team_id, date)`:

1. Reconstruct holdings at `date`.
2. For each holding:
   - Fetch `adj_close` for `date` and `prev_trading_day(date)`.
   - Compute `daily_return = (close_today - close_yesterday) / close_yesterday`.
   - Compute `points = daily_return × 100 × K`.
   - If `holding.added_date == date`: apply first-day penalty (`points *= 0.5`).
3. Sum all points → team day score.
4. Store in `team_day_scores` as cache.

**Determinism guarantee:** function uses only `roster_moves`, `price_daily`, `instruments`, and `trading_calendar`. No wall-clock time, no randomness, no external state.

### 7.7 Swap Validation
When a user submits a swap (drop A, add B):

1. Verify market is currently closed (check against `trading_calendar` + exchange hours).
2. Check daily limit (max 1 swap today) and weekly limit (max 5 this Mon–Fri).
3. Compute `effective_date = next_trading_day(today)`.
4. Reconstruct holdings as of `effective_date`, simulate the swap.
5. Validate post-swap state:
   - Roster size = 8.
   - Each tier has ≥1 company.
   - Total tier cost ≤ budget.
   - (Private leagues) Company B is a free agent.
   - (Private leagues) FAAB bid ≤ remaining FAAB.
6. Insert `roster_moves` rows (one DROP, one ADD).

### 7.8 FAAB Waiver Processing (Private Leagues)
Triggered lazily (on first access after the processing window) or via a simple cron if preferred:

1. Collect all pending swap claims for the day.
2. Group by requested `add` symbol.
3. For each contested symbol: highest FAAB bid wins. Tie-break: reverse standings.
4. Winner: insert `roster_moves`, deduct FAAB.
5. Losers: claim rejected, FAAB retained. Optionally notify.
6. Uncontested claims: process normally (even $0 bids succeed).

### 7.9 Recalculation / Algorithm Changes
To recalculate all scores:
```sql
TRUNCATE team_day_scores;
```
Next time any user loads a dashboard, scores rebuild lazily from source data. For a small league this takes milliseconds. For larger scale, a one-off script can eagerly rebuild.

---

## 8. Edge Cases and Rules Clarifications

| Scenario | Rule |
|---|---|
| Stock halted / no price data for a day | Company scores 0 points for that day |
| Company delisted mid-season | Scores 0 from delisting date; user must swap it out |
| Stock split / reverse split | Handled by using adjusted close prices |
| Dividend ex-date | Handled by adjusted close (total return) |
| User submits swap during market hours | Rejected |
| User tries to drop their only Tier 3 company | Rejected unless the add is also Tier 3 |
| User has 0 FAAB remaining | Can still bid $0; wins only if uncontested or all bids are $0 |
| Two users fetch prices simultaneously | Idempotent upsert; no conflict |
| Season starts mid-week | First scoring day = first trading day of the season |
| Friday → Monday return | Counted as one day's return (close Friday → close Monday) |

---

## 9. Future Considerations (Post-MVP)

These are explicitly **out of scope** for MVP but noted for future design:

- **Head-to-head weekly matchups** (fantasy football style).
- **Bench slots** (non-scoring reserves).
- **Max per-tier cap** (e.g. max 3 from any one tier) if stacking becomes a problem.
- **Multiple exchanges** (US, EU, etc.) with per-league market selection and timezone-aware day boundaries.
- **Intraday live scores** (unofficial, recalculated at close).
- **Benchmark-relative scoring** toggle per league.
- **Commissioner tools** (trade review, league settings changes).
- **Playoffs** (bracket-style end-of-season).
- **Achievements / streaks** (e.g. "3-day green streak" bonus).
- **Event-based bonus points** (beat earnings, new 52-week high, dividend announced).
- **Mobile app**.
- **Point penalty per swap** (global leagues, as alternative/supplement to first-day dampener).
- **Minimum hold period** (must keep a company for N trading days before dropping).

---

## 10. Configuration Summary (MVP Defaults)

| Parameter | Value |
|---|---|
| Roster size | 8 |
| Number of tiers | 5 |
| Tier costs | 20 / 16 / 12 / 8 / 4 |
| Draft budget | 100 |
| Min per tier | 1 |
| Max per tier | None (MVP) |
| Scoring multiplier (K) | 10 |
| First-day penalty | 0.5× (50% of points) |
| Swaps per day | 1 |
| Swaps per week | 5 |
| FAAB budget (private) | 100 (season, no reset) |
| Trade deadline | 2 weeks before season end |
| Market | LSE |
| Day boundary | Midnight UTC |
| Price type | Adjusted close (EOD) |


---

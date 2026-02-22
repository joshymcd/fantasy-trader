# User Journey 1: System Admin Bootstrap from Empty System

This journey is for setting up Fantasy Trader from an empty database so regular users can create and play in leagues.

## Goal

- Start from no game data.
- End with one active season, populated instruments, and market data available.
- Confirm the system is ready for league and team creation.

## Actor

- System Admin (or developer acting as admin).

## Preconditions

- `DATABASE_URL` is configured.
- Project dependencies are installed.
- App can run locally.

## Steps

1. Prepare local environment.
   - Run `bun install`.
   - Ensure `.env.local` or `.env` has `DATABASE_URL` (and optionally `BETTER_AUTH_SECRET`).
2. Apply schema to empty DB.
   - Run `bun --bun run db:push`.
3. Start app.
   - Run `bun --bun run dev`.
   - Open `http://localhost:3000/login`.
   - Continue anonymously.
4. Open backend console.
   - Go to `http://localhost:3000/backend`.
5. Populate trading calendar.
   - In **System Tools**, set year (for example current year).
   - Click **Populate**.
6. Create season.
   - In **Season Tools**, provide name, market, date range, trade deadline, and budget.
   - Click **Create Season**.
7. Populate season instruments.
   - Choose the season in **Target Season**.
   - Keep symbols CSV blank to use default UK set, or provide custom symbols.
   - Click **Populate Instruments**.
8. Activate season.
   - Click **Activate Season**.
9. Sync prices.
   - In **System Tools**, pick target date.
   - Click **Sync prices**.

## Expected Result

- Backend cards show non-zero trading days and instrument rows.
- A season exists with `ACTIVE` status.
- Price rows exist so scoring and dashboards can hydrate.

## Validation Checklist

- In `/backend`, season row status is `ACTIVE`.
- In `/dashboard`, no fatal errors and league cards can load once leagues exist.
- `bun --bun run test` passes.
- `bun --bun run lint` passes.

## Admin/Developer Test Runbook

Use this exact sequence when validating bootstrap:

```bash
bun install
bun --bun run db:push
bun --bun run test
bun --bun run lint
bun --bun run dev
```

Then perform steps 4-9 in the UI and confirm status messages are successful.

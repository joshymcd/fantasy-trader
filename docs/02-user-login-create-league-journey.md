# User Journey 2: User Login and League Creation

This journey covers a user signing in and creating a league for an active season.

## Goal

- User signs in successfully.
- User creates a league attached to an active season.

## Actor

- Authenticated User (currently anonymous auth).

## Preconditions

- At least one active season exists (see Journey 1).
- User can access `/login`.

## Steps

1. Open login page.
   - Navigate to `http://localhost:3000/login`.
2. Sign in.
   - Click **Continue anonymously**.
   - Confirm redirect to `/dashboard`.
3. Open league creation tools.
   - Navigate to `/backend`.
4. Create league.
   - In **League & Team Tools** > **Create League**:
     - Select season.
     - Enter league name.
     - Enter creator user id.
     - Select ownership mode (`UNIQUE` or `DUPLICATES`).
   - Click **Create League**.
5. Confirm league visibility.
   - Return to `/dashboard`.
   - Confirm league card appears.

## Expected Result

- League is created with selected ownership mode.
- League appears on dashboard with status badge.

## Validation Checklist

- Backend success text shows `League created`.
- Dashboard shows the new league card.
- League page opens at `/leagues/<leagueId>`.

## Admin/Developer Test Runbook

1. Start app with `bun --bun run dev`.
2. Login as anonymous user.
3. Create one league in `/backend`.
4. Verify in `/dashboard` and `/leagues/<leagueId>`.
5. Optionally run regression checks after manual flow:
   - `bun --bun run test`
   - `bun --bun run lint`

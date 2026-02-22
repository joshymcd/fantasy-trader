# User Journey 3: Player Joins a League

This journey describes how a player joins an existing league and becomes ready to submit an initial portfolio.

## Goal

- A player is attached to a league via a new team record.
- Player can proceed to portfolio selection.

## Actor

- Player (user account) and admin/developer facilitator.

## Implementation Note

- Current MVP flow uses backend tools for joining.
- There is no public invite/join UI yet; joining is done by creating a team in a target league.

## Preconditions

- League exists (see Journey 2).
- Player user id is known.

## Steps

1. Login as player or test user.
   - Use `/login` and continue anonymously, or use a known user id in backend tools.
2. Open backend console.
   - Navigate to `/backend`.
3. Create team for the player.
   - In **League & Team Tools** > **Create Team**:
     - Select target league.
     - Set `User ID` to player id.
     - Provide team name.
   - Click **Create Team**.
4. Validate join state.
   - Confirm success message includes created team id.
   - Open `/leagues/<leagueId>` and confirm standings context includes the team once scoring runs.
5. Prepare for draft/portfolio.
   - In **Portfolio Selection (Phase 6)**:
     - Select target team.
     - Load availability for league.
     - Validate symbols CSV.

## Expected Result

- New team is linked to league and user id.
- Team can validate and submit its 8-symbol portfolio.

## Validation Checklist

- Backend shows `Team created`.
- Team is selectable in portfolio tools.
- Portfolio validation returns meaningful budget/tier checks.

## Admin/Developer Test Runbook

1. Create at least two users (or two user ids) and one league.
2. Add one team per user via **Create Team**.
3. For each team, run **Validate Portfolio** with sample symbols.
4. Submit valid portfolio for each team.
5. Confirm league can transition from setup toward active once required teams submit.

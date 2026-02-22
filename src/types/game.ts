export const ROSTER_SIZE = 8
export const TIER_COUNT = 5

export const TIER_COSTS: Record<number, number> = {
  1: 20,
  2: 16,
  3: 12,
  4: 8,
  5: 4,
}

export const DEFAULT_BUDGET = 100
export const DEFAULT_SCORING_MULTIPLIER = 10
export const DEFAULT_FIRST_DAY_PENALTY = 0.5
export const DEFAULT_MAX_SWAPS_PER_DAY = 1
export const DEFAULT_MAX_SWAPS_PER_WEEK = 5
export const DEFAULT_FAAB_BUDGET = 100

export type SeasonStatus = 'SETUP' | 'ACTIVE' | 'COMPLETED'
export type OwnershipMode = 'UNIQUE' | 'DUPLICATES'
export type LeagueStatus = 'DRAFT_PENDING' | 'DRAFTING' | 'ACTIVE' | 'COMPLETED'
export type RosterMoveType = 'DRAFT' | 'ADD' | 'DROP' | 'TRADE'
export type WaiverClaimStatus = 'PENDING' | 'WON' | 'LOST' | 'CANCELLED'
export type TradeProposalStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'

export type ScoringConfig = {
  multiplier: number
  firstDayPenalty: number
}

export type TierCounts = Record<1 | 2 | 3 | 4 | 5, number>

export const emptyTierCounts = (): TierCounts => ({
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
})

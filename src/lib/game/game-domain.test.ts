import { afterAll, describe, expect, it } from 'vitest'

import { db } from '../../db/index'
import { leagues, seasons, teams } from '../../db/schema'
import { getAvailableInstruments, validatePortfolio } from './draft'
import { getLeagueById, listLeagues } from './league'
import { getAllInstrumentSymbols } from './market-data'
import { calculateTeamDay } from './scoring'
import { createSeason, listSeasons } from './season'
import { getLeagueStandings, getGlobalMovers } from './dashboard'
import { submitSwap } from './swaps'
import { proposeTrade } from './trades'

describe('game domain integration smoke tests', () => {
  it('lists leagues and resolves a league by id', async () => {
    const rows = await listLeagues()
    expect(Array.isArray(rows)).toBe(true)

    if (rows.length > 0) {
      const firstLeague = rows[0]
      if (!firstLeague) {
        throw new Error('Expected first league')
      }
      const league = await getLeagueById(firstLeague.id)
      expect(league?.id).toBe(firstLeague.id)
    }
  })

  it('lists seasons and can create a setup season', async () => {
    const rows = await listSeasons()
    expect(Array.isArray(rows)).toBe(true)

    const newSeason = await createSeason({
      name: `Test Season ${Date.now()}`,
      market: 'LSE',
      startDate: new Date('2031-01-01T00:00:00.000Z'),
      endDate: new Date('2031-12-31T00:00:00.000Z'),
      tradeDeadlineDate: new Date('2031-06-30T00:00:00.000Z'),
    })

    expect(newSeason.status).toBe('SETUP')
  })

  it('validates an obviously invalid portfolio', async () => {
    const [season] = await db.select({ id: seasons.id }).from(seasons).limit(1)
    expect(season).toBeDefined()
    if (!season) {
      throw new Error('Expected season row')
    }

    const result = await validatePortfolio({
      symbols: [],
      seasonId: season.id,
    })

    expect(result.isValid).toBe(false)
    expect(result.errors.some((error) => error.includes('exactly'))).toBe(true)
  })

  it('loads available instruments for an existing league', async () => {
    const [league] = await db.select({ id: leagues.id }).from(leagues).limit(1)
    expect(league).toBeDefined()
    if (!league) {
      throw new Error('Expected league row')
    }

    const rows = await getAvailableInstruments(league.id)
    expect(Array.isArray(rows)).toBe(true)
  })

  it('returns zero score on non-trading day', async () => {
    const [team] = await db.select({ id: teams.id }).from(teams).limit(1)
    expect(team).toBeDefined()
    if (!team) {
      throw new Error('Expected team row')
    }

    const score = await calculateTeamDay(
      team.id,
      new Date('2026-01-10T00:00:00.000Z'),
    )
    expect(score.points).toBe(0)
    expect(score.isTradingDay).toBe(false)
  })

  it('returns standings and movers without throwing', async () => {
    const [league] = await db.select({ id: leagues.id }).from(leagues).limit(1)
    expect(league).toBeDefined()
    if (!league) {
      throw new Error('Expected league row')
    }

    const standings = await getLeagueStandings(
      league.id,
      new Date('2026-01-10T00:00:00.000Z'),
    )
    expect(Array.isArray(standings)).toBe(true)

    const movers = await getGlobalMovers(new Date('2026-01-10T00:00:00.000Z'))
    expect(Array.isArray(movers)).toBe(true)
  })

  it('applies early swap and trade validation', async () => {
    await expect(
      submitSwap({
        teamId: '00000000-0000-0000-0000-000000000000',
        dropSymbol: 'A',
        addSymbol: 'A',
      }),
    ).rejects.toThrow('must be different')

    await expect(
      proposeTrade({
        fromTeamId: '00000000-0000-0000-0000-000000000000',
        toTeamId: '00000000-0000-0000-0000-000000000000',
        offeredSymbols: ['A'],
        requestedSymbols: ['B'],
      }),
    ).rejects.toThrow('same team')
  })

  it('lists instrument symbols without throwing', async () => {
    const symbols = await getAllInstrumentSymbols()
    expect(Array.isArray(symbols)).toBe(true)
  })
})

afterAll(async () => {
  await (db as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
})

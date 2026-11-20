import { homeAway } from '@/lib/fixtures'
import type { Fixture } from '@/lib/types'
import { buildGroups } from './catalog'
import { STATS_CACHE_TTL_MS, STATS_RETRY_TTL_MS } from './config'
import { orient } from './orient'
import { statisticsSourceFor } from './registry'
import { fetchAccStatistics } from './sources/acc'
import { fetchAfcStatistics } from './sources/afc'
import { fetchIleagueStatistics } from './sources/ileague'
import type {
  MatchStatistics,
  SourceStatistics,
  StatisticsGroup,
  StatisticsSourceId,
  StatisticsSourceRef,
} from './types'

export type {
  MatchStatistics,
  StatGroupId,
  StatRow,
  StatisticsGroup,
  StatisticsSourceId,
  StatisticsState,
} from './types'
export { STAT_GROUPS } from './catalog'
export { statisticsSourceFor, supportsStatistics } from './registry'

const ADAPTERS: Record<StatisticsSourceId, (fixture: Fixture) => Promise<SourceStatistics>> = {
  ileague: fetchIleagueStatistics,
  acc: fetchAccStatistics,
  afc: fetchAfcStatistics,
}

/** Small in-process TTL cache so repeated views never re-scrape. */
const CACHE = new Map<string, { expires: number; value: MatchStatistics }>()
const MAX_CACHE_ENTRIES = 200

function fixtureScore(fixture: Fixture): { home: number | null; away: number | null } {
  if (!fixture.score) return { home: null, away: null }
  return fixture.venueType === 'away'
    ? { home: fixture.score.opponent, away: fixture.score.persib }
    : { home: fixture.score.persib, away: fixture.score.opponent }
}

function finalize(source: SourceStatistics, fixture: Fixture): MatchStatistics {
  const expected = homeAway(fixture)
  const ref: StatisticsSourceRef = {
    id: source.sourceId,
    name: source.sourceName,
    url: source.url,
  }
  const base: MatchStatistics = {
    fixtureId: fixture.id,
    state: 'unavailable',
    competition: fixture.competition,
    date: fixture.date,
    home: { name: expected.home, score: null },
    away: { name: expected.away, score: null },
    groups: [],
    source: ref,
    fetchedAt: new Date().toISOString(),
    ...(source.message ? { message: source.message } : {}),
  }

  if (source.state !== 'found') return { ...base, state: source.state }

  const orientation = orient(source.homeTeam, source.awayTeam, expected.home, expected.away)
  if (orientation === 'unknown') {
    return {
      ...base,
      state: 'error',
      message: 'Tidak dapat memverifikasi urutan tim kandang/tandang dari sumber statistik.',
    }
  }

  const reversed = orientation === 'reversed'
  const groups: StatisticsGroup[] = buildGroups(source.stats, reversed)
  const hasValue = groups.some((group) =>
    group.rows.some((row) => row.home !== null || row.away !== null),
  )
  if (groups.length === 0 || !hasValue) {
    return { ...base, state: 'unavailable', message: 'Statistik belum tersedia untuk laga ini.' }
  }

  const score = fixtureScore(fixture)
  const sourceHome = reversed ? source.awayScore : source.homeScore
  const sourceAway = reversed ? source.homeScore : source.awayScore

  return {
    ...base,
    state: 'found',
    home: { name: expected.home, score: score.home ?? sourceHome },
    away: { name: expected.away, score: score.away ?? sourceAway },
    groups,
  }
}

function fallback(fixture: Fixture): MatchStatistics {
  return {
    fixtureId: fixture.id,
    state: 'unavailable',
    competition: fixture.competition,
    date: fixture.date,
    home: { name: homeAway(fixture).home, score: null },
    away: { name: homeAway(fixture).away, score: null },
    groups: [],
    source: null,
    fetchedAt: new Date().toISOString(),
    message: 'Statistik resmi belum tersedia untuk kompetisi ini.',
  }
}

/** Resolve, orient and cache the official statistics for one fixture. */
export async function getMatchStatistics(fixture: Fixture): Promise<MatchStatistics> {
  const cached = CACHE.get(fixture.id)
  if (cached && cached.expires > Date.now()) return cached.value

  const config = statisticsSourceFor(fixture.competition)
  let result: MatchStatistics

  if (!config) {
    result = fallback(fixture)
  } else {
    try {
      result = finalize(await ADAPTERS[config.id](fixture), fixture)
    } catch (error) {
      result = {
        ...fallback(fixture),
        state: 'error',
        source: { id: config.id, name: config.name, url: '' },
        message: error instanceof Error ? error.message : 'Terjadi kesalahan saat memuat statistik.',
      }
    }
  }

  if (CACHE.size >= MAX_CACHE_ENTRIES) CACHE.clear()
  const ttl = result.state === 'found' ? STATS_CACHE_TTL_MS : STATS_RETRY_TTL_MS
  CACHE.set(fixture.id, { expires: Date.now() + ttl, value: result })
  return result
}

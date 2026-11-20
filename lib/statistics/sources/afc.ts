import { homeAway } from '@/lib/fixtures'
import { AFC_COMPETITION_CODES, AFC_FIXTURES_URL } from '@/lib/sync/config'
import { fetchText } from '@/lib/sync/http'
import { cleanText, sameTeam } from '@/lib/sync/teams'
import type { Fixture } from '@/lib/types'
import {
  AFC_OPTA_MATCHSTATS_BASE,
  AFC_OPTA_OUTLET_KEY,
  AFC_ORIGIN,
  STATS_FETCH_REVALIDATE,
  STATS_FETCH_TIMEOUT_MS,
} from '../config'
import { errorMessage, toStatNumber } from '../parse'
import type { SourceStatRow, SourceStatistics } from '../types'

/** Public list of AFC matches; the only place a fixture's internal Opta id appears. */
const MATCHES_PATH = '/en/matches'

function empty(message?: string): SourceStatistics {
  return {
    state: 'unavailable',
    sourceId: 'afc',
    sourceName: 'AFC',
    url: `${AFC_ORIGIN}${MATCHES_PATH}`,
    homeTeam: null,
    awayTeam: null,
    homeScore: null,
    awayScore: null,
    stats: [],
    ...(message ? { message } : {}),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Trim a string or stringify a finite number; anything else becomes an empty string. */
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

interface ResolvedMatch {
  /** Internal Opta id used by the `matchstats` feed. */
  matchId: string
  /** Numeric id used in the public match URL. */
  ffeedId: string | null
  homeTeam: string
  awayTeam: string
  originCompetitionId: string | null
  season: string | null
}

/**
 * Resolve a fixture to its AFC match through the published fixtures feed. The
 * feed is asked for the fixture's own date so the response stays small, and the
 * match is identified by both teams — a name alone is never enough.
 */
async function resolveMatch(fixture: Fixture): Promise<ResolvedMatch | null> {
  const expected = homeAway(fixture)
  const params = new URLSearchParams({
    competitionCodes: AFC_COMPETITION_CODES,
    locale: 'en',
    season: 'latest',
  })
  if (fixture.date) {
    params.set('dateFrom', fixture.date)
    params.set('dateTo', fixture.date)
  }

  const body = await fetchText(`${AFC_FIXTURES_URL}?${params}`, {
    revalidate: STATS_FETCH_REVALIDATE,
    timeoutMs: STATS_FETCH_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
  })

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  const items = asRecord(payload)?.data
  if (!Array.isArray(items)) return null

  for (const raw of items) {
    const item = asRecord(raw)
    if (!item) continue
    if (fixture.date && text(item.dateVenue) !== fixture.date) continue

    const homeTeam = cleanText(text(asRecord(item.homeTeam)?.name))
    const awayTeam = cleanText(text(asRecord(item.awayTeam)?.name))
    if (!homeTeam || !awayTeam) continue

    const aligned = sameTeam(homeTeam, expected.home) && sameTeam(awayTeam, expected.away)
    const reversed = sameTeam(homeTeam, expected.away) && sameTeam(awayTeam, expected.home)
    if (!aligned && !reversed) continue

    const matchId = text(item.matchId)
    if (!matchId) continue

    return {
      matchId,
      ffeedId: text(item.ffeedId) || null,
      homeTeam,
      awayTeam,
      originCompetitionId: text(item.originCompetitionId) || null,
      season: text(item.season) || null,
    }
  }
  return null
}

/** Official match-centre page for the resolved match, falling back to the index. */
function matchPageUrl(match: ResolvedMatch): string {
  if (match.ffeedId && match.originCompetitionId && match.season) {
    return `${AFC_ORIGIN}/en/matches/${match.originCompetitionId}/${match.season}/${match.ffeedId}`
  }
  return `${AFC_ORIGIN}${MATCHES_PATH}`
}

type StatMap = Map<string, string>

interface ParsedStats {
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  stats: SourceStatRow[]
}

/** One `liveData.lineUp[]` entry → its contestant id and `type → value` table. */
function statMapOf(entry: unknown): { contestantId: string; stats: StatMap } | null {
  const team = asRecord(entry)
  if (!team) return null
  const contestantId = text(team.contestantId)
  if (!contestantId) return null

  const stats: StatMap = new Map()
  if (Array.isArray(team.stat)) {
    for (const raw of team.stat) {
      const row = asRecord(raw)
      if (!row) continue
      const type = text(row.type)
      if (type) stats.set(type, text(row.value))
    }
  }
  return { contestantId, stats }
}

function statValue(stats: StatMap, type: string): number | null {
  const raw = stats.get(type)
  return raw === undefined ? null : toStatNumber(raw)
}

/**
 * Share of `a / (a + b)` as a percentage. Returns `null` when the source did not
 * publish both counters, so a missing value stays missing instead of becoming 0.
 */
function sharePercent(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  const total = a + b
  if (total <= 0) return null
  return (a / total) * 100
}

/**
 * Parse the Opta `matchstats?detailed=yes` feed. Home/away come from
 * `matchInfo.contestant[].position`, and the counters from the matching
 * `liveData.lineUp[].stat` block. Until detailed stats are published the feed
 * returns the squads without a `stat` block, which we treat as unavailable.
 */
function parseMatchStats(body: string): ParsedStats | null {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }

  const root = asRecord(payload)
  const matchInfo = asRecord(root?.matchInfo)
  const liveData = asRecord(root?.liveData)
  const lineUp = liveData?.lineUp
  const contestants = matchInfo?.contestant
  if (!matchInfo || !liveData || !Array.isArray(lineUp) || !Array.isArray(contestants)) return null

  const sides = new Map<string, { id: string; name: string }>()
  for (const raw of contestants) {
    const contestant = asRecord(raw)
    if (!contestant) continue
    const position = text(contestant.position)
    const id = text(contestant.id)
    const name = cleanText(text(contestant.name))
    if ((position === 'home' || position === 'away') && id && name) {
      sides.set(position, { id, name })
    }
  }
  const home = sides.get('home')
  const away = sides.get('away')
  if (!home || !away) return null

  const statsById = new Map<string, StatMap>()
  for (const entry of lineUp) {
    const parsed = statMapOf(entry)
    if (parsed) statsById.set(parsed.contestantId, parsed.stats)
  }
  const homeStats = statsById.get(home.id)
  const awayStats = statsById.get(away.id)
  if (!homeStats?.size || !awayStats?.size) return null

  const stats: SourceStatRow[] = [
    {
      label: 'Penguasaan Bola',
      home: statValue(homeStats, 'possessionPercentage'),
      away: statValue(awayStats, 'possessionPercentage'),
    },
    {
      label: 'Keberhasilan Duel',
      home: sharePercent(statValue(homeStats, 'duelWon'), statValue(homeStats, 'duelLost')),
      away: sharePercent(statValue(awayStats, 'duelWon'), statValue(awayStats, 'duelLost')),
    },
    {
      label: 'Duel Udara Dimenangkan',
      home: sharePercent(statValue(homeStats, 'aerialWon'), statValue(homeStats, 'aerialLost')),
      away: sharePercent(statValue(awayStats, 'aerialWon'), statValue(awayStats, 'aerialLost')),
    },
    {
      label: 'Intersepsi',
      home: statValue(homeStats, 'interception'),
      away: statValue(awayStats, 'interception'),
    },
    {
      label: 'Offside',
      home: statValue(homeStats, 'totalOffside'),
      away: statValue(awayStats, 'totalOffside'),
    },
    {
      label: 'Tendangan Sudut',
      home: statValue(homeStats, 'wonCorners'),
      away: statValue(awayStats, 'wonCorners'),
    },
  ]

  if (!stats.some((row) => row.home !== null || row.away !== null)) return null

  const scores = asRecord(asRecord(asRecord(liveData.matchDetails)?.scores)?.total)
  return {
    homeTeam: home.name,
    awayTeam: away.name,
    homeScore: toStatNumber(text(scores?.home)),
    awayScore: toStatNumber(text(scores?.away)),
    stats,
  }
}

/**
 * AFC statistics. The match centre is Opta-backed; this reads the same
 * `matchstats?detailed=yes` feed the official widget requests, using the outlet
 * key the widget's public subscription authorises. The feed requires an AFC
 * `Referer`, and matches are resolved to their internal Opta id via the public
 * fixtures feed.
 */
export async function fetchAfcStatistics(fixture: Fixture): Promise<SourceStatistics> {
  let resolved: ResolvedMatch | null
  try {
    resolved = await resolveMatch(fixture)
  } catch (error) {
    return {
      ...empty(),
      state: 'error',
      message: `Tidak dapat memuat daftar laga AFC (${errorMessage(error)}).`,
    }
  }
  if (!resolved) return empty('Referensi laga AFC tidak ditemukan.')

  const url = `${AFC_OPTA_MATCHSTATS_BASE}/${encodeURIComponent(AFC_OPTA_OUTLET_KEY)}/${encodeURIComponent(
    resolved.matchId,
  )}?_rt=c&_lcl=en-x6&_fmt=json&detailed=yes`

  let body: string
  try {
    body = await fetchText(url, {
      revalidate: STATS_FETCH_REVALIDATE,
      timeoutMs: STATS_FETCH_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        Referer: `${AFC_ORIGIN}/`,
        Origin: AFC_ORIGIN,
      },
    })
  } catch (error) {
    return {
      ...empty(),
      url: matchPageUrl(resolved),
      state: 'error',
      message: `Gagal membaca statistik AFC (${errorMessage(error)}).`,
    }
  }

  const parsed = parseMatchStats(body)
  if (!parsed) {
    return { ...empty(), url: matchPageUrl(resolved), message: 'Statistik belum tersedia untuk laga ini.' }
  }

  return {
    state: 'found',
    sourceId: 'afc',
    sourceName: 'AFC',
    url: matchPageUrl(resolved),
    homeTeam: parsed.homeTeam,
    awayTeam: parsed.awayTeam,
    homeScore: parsed.homeScore,
    awayScore: parsed.awayScore,
    stats: parsed.stats,
  }
}

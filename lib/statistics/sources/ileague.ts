import { homeAway } from '@/lib/fixtures'
import { ileagueCompetitions } from '@/lib/sync/config'
import { fetchText } from '@/lib/sync/http'
import { cleanText, sameTeam } from '@/lib/sync/teams'
import type { Fixture } from '@/lib/types'
import { STATS_FETCH_REVALIDATE, STATS_FETCH_TIMEOUT_MS } from '../config'
import { toStatNumber } from '../parse'
import type { SourceStatRow, SourceStatistics } from '../types'

const ORIGIN = 'https://ileague.id'
const PERSIB_SLUG = 'PERSIB_BANDUNG'

interface DetailLink {
  path: string
  date: string
  home: string
  away: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'permintaan gagal'
}

/** `/result/detail/{slug}/{date}/{HOME}/{AWAY}` → parts with slugs un-mangled. */
function parseDetailPath(path: string): DetailLink | null {
  const match = path.match(/\/result\/detail\/[^/]+\/(\d{4}-\d{2}-\d{2})\/([^/?#]+)\/([^/?#]+)/)
  if (!match) return null
  return {
    path,
    date: match[1],
    home: match[2].replace(/_/g, ' '),
    away: match[3].replace(/_/g, ' '),
  }
}

function empty(message?: string): SourceStatistics {
  return {
    state: 'unavailable',
    sourceId: 'ileague',
    sourceName: 'I.League',
    url: `${ORIGIN}/`,
    homeTeam: null,
    awayTeam: null,
    homeScore: null,
    awayScore: null,
    stats: [],
    ...(message ? { message } : {}),
  }
}

/**
 * The Persib club page lists every published match result for a competition in
 * a single request, so one fetch resolves the detail URL for any fixture.
 */
async function findDetailPath(fixture: Fixture): Promise<string | null> {
  if (fixture.sourceMatchId?.includes('/result/detail/')) return fixture.sourceMatchId

  const config = ileagueCompetitions().find((entry) => entry.competition === fixture.competition)
  if (!config) return null

  const clubUrl = `${ORIGIN}/clubs/single/${config.slug}/${PERSIB_SLUG}`
  const html = await fetchText(clubUrl, {
    revalidate: STATS_FETCH_REVALIDATE,
    timeoutMs: STATS_FETCH_TIMEOUT_MS,
  })

  const links = [...new Set([...html.matchAll(/\/result\/detail\/[^"'\s\\]+/g)].map((m) => m[0]))]
  const candidates = links
    .map(parseDetailPath)
    .filter((link): link is DetailLink => link !== null && link.date === fixture.date)

  const expected = homeAway(fixture)
  const aligned = candidates.find(
    (link) => sameTeam(link.home, expected.home) && sameTeam(link.away, expected.away),
  )
  if (aligned) return aligned.path

  const reversed = candidates.find(
    (link) => sameTeam(link.home, expected.away) && sameTeam(link.away, expected.home),
  )
  return reversed?.path ?? null
}

interface ParsedDetail {
  homeTeam: string | null
  awayTeam: string | null
  homeScore: number | null
  awayScore: number | null
  stats: SourceStatRow[]
}

/**
 * The statistics block is a flex row (`justify-content: space-between`), so DOM
 * order — not the `left`/`right` class — decides which side a value belongs to:
 * the first value span is home, the second is away.
 */
function parseDetail(html: string): ParsedDetail | null {
  const start = html.search(/class="row match-stats"/)
  if (start < 0) return null
  const scope = html.slice(start, start + 40_000)

  const teamBlocks = [...scope.matchAll(/<div class="team([^"]*)">([\s\S]*?)<\/div>/g)]
  const names = teamBlocks
    .map((match) => cleanText(match[2].replace(/<img[^>]*>/g, '').replace(/<[^>]*>/g, ' ')))
    .filter(Boolean)

  const scoreText = scope.match(/<div class="result-match">([\s\S]*?)<\/div>/)?.[1] ?? ''
  const score = scoreText.match(/(\d+)\s*:\s*(\d+)/)

  const list = scope.match(/<ul>([\s\S]*?)<\/ul>/)?.[1]
  if (!list) return null

  const stats: SourceStatRow[] = []
  for (const item of list.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const spans = [...item[1].matchAll(/<span class="(left|right|center)">([\s\S]*?)<\/span>/g)].map(
      (match) => ({ cls: match[1], value: cleanText(match[2]) }),
    )
    const label = spans.find((span) => span.cls === 'center')?.value
    if (!label) continue
    const values = spans.filter((span) => span.cls !== 'center')
    stats.push({
      label,
      home: toStatNumber(values[0]?.value),
      away: toStatNumber(values[1]?.value),
    })
  }

  if (stats.length === 0) return null
  return {
    homeTeam: names[0] ?? null,
    awayTeam: names[1] ?? null,
    homeScore: score ? Number(score[1]) : null,
    awayScore: score ? Number(score[2]) : null,
    stats,
  }
}

export async function fetchIleagueStatistics(fixture: Fixture): Promise<SourceStatistics> {
  let path: string | null
  try {
    path = await findDetailPath(fixture)
  } catch (error) {
    return { ...empty(), state: 'error', message: `Tidak dapat memuat arsip I.League (${errorMessage(error)}).` }
  }
  if (!path) return empty('Laga ini belum ada di arsip statistik resmi I.League.')

  const url = path.startsWith('http') ? path : `${ORIGIN}${path}`
  let html: string
  try {
    html = await fetchText(url, {
      revalidate: STATS_FETCH_REVALIDATE,
      timeoutMs: STATS_FETCH_TIMEOUT_MS,
    })
  } catch (error) {
    return { ...empty(), url, state: 'error', message: `Gagal membaca halaman statistik I.League (${errorMessage(error)}).` }
  }

  const parsed = parseDetail(html)
  if (!parsed) return { ...empty(), url, message: 'Statistik belum tersedia untuk laga ini.' }

  return {
    state: 'found',
    sourceId: 'ileague',
    sourceName: 'I.League',
    url,
    ...parsed,
  }
}

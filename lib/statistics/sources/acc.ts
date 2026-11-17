import { homeAway } from '@/lib/fixtures'
import { fetchText } from '@/lib/sync/http'
import { scrapeAcc } from '@/lib/sync/sources/acc'
import { cleanText, sameTeam } from '@/lib/sync/teams'
import type { Fixture } from '@/lib/types'
import { STATS_FETCH_REVALIDATE, STATS_FETCH_TIMEOUT_MS } from '../config'
import { toStatNumber } from '../parse'
import type { SourceStatRow, SourceStatistics } from '../types'

const ORIGIN = 'https://aseanutdfc.com'
const STATS_BASE = `${ORIGIN}/asean-club-championship/match`

/** Real ACC match ids are long opaque slugs; the composite fallback is not one. */
const MATCH_ID_RE = /^[a-z0-9]{16,}$/i

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'permintaan gagal'
}

function empty(message?: string): SourceStatistics {
  return {
    state: 'unavailable',
    sourceId: 'acc',
    sourceName: 'ASEAN United FC',
    url: `${ORIGIN}/asean-club-championship/matches`,
    homeTeam: null,
    awayTeam: null,
    homeScore: null,
    awayScore: null,
    stats: [],
    ...(message ? { message } : {}),
  }
}

function dayDistance(a: string | null, b: string | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/**
 * Resolve the ACC match id. The fixture may already carry it; otherwise the
 * published match list is scanned and matched on date plus *both* team names.
 */
async function resolveMatchId(fixture: Fixture): Promise<string | null> {
  const direct = fixture.sourceMatchId?.trim()
  if (direct && MATCH_ID_RE.test(direct)) return direct

  const { matches } = await scrapeAcc({ fresh: false })
  const expected = homeAway(fixture)

  const candidate = matches.find((match) => {
    const id = match.sourceMatchId
    if (!id || !MATCH_ID_RE.test(id)) return false
    if (dayDistance(match.date, fixture.date) > 1) return false
    const aligned = sameTeam(match.homeTeam, expected.home) && sameTeam(match.awayTeam, expected.away)
    const reversed = sameTeam(match.homeTeam, expected.away) && sameTeam(match.awayTeam, expected.home)
    return aligned || reversed
  })
  return candidate?.sourceMatchId ?? null
}

interface ParsedStats {
  homeTeam: string | null
  awayTeam: string | null
  homeScore: number | null
  awayScore: number | null
  stats: SourceStatRow[]
}

/**
 * The `/stats` fragment mixes two row layouts:
 *   - progress rows  `.innr-btm-stts-dv` → two `aria-valuenow` around a `<p>` label
 *   - segmented rows `.sgmnt-bars`       → `data-value` on player1/player2
 * Rows the source cannot provide render a single centred `<p>… — unavailable</p>`
 * and are kept with both sides `null` so the UI can show "—".
 */
function parseStats(html: string): ParsedStats | null {
  if (/not available yet/i.test(html)) return null

  const homeTeam = cleanText(
    html.match(/<div class="cntry-dtl">[\s\S]*?<h3>([\s\S]*?)<\/h3>/)?.[1] ?? '',
  )
  const awayTeam = cleanText(
    html.match(/<div class="cntry-dtl flex-row-reverse">[\s\S]*?<h3>([\s\S]*?)<\/h3>/)?.[1] ?? '',
  )
  const homeScore = toStatNumber(
    html.match(/id="stats-home-score"[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? null,
  )
  const awayScore = toStatNumber(
    html.match(/id="stats-away-score"[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? null,
  )

  const stats: SourceStatRow[] = []
  const blocks = html.split(/(?=<div class="(?:innr-btm-stts-dv|sgmnt-bars)">)/)

  for (const block of blocks) {
    if (block.startsWith('<div class="innr-btm-stts-dv">')) {
      const label = cleanText(block.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? '')
      const values = [...block.matchAll(/aria-valuenow="([^"]*)"/g)].map((m) => toStatNumber(m[1]))
      if (label) stats.push({ label, home: values[0] ?? null, away: values[1] ?? null })
      continue
    }

    if (block.startsWith('<div class="sgmnt-bars">')) {
      const unavailable = block.match(/<p class="segment-data w-100 text-center">([\s\S]*?)<\/p>/)
      if (unavailable) {
        const label = cleanText(unavailable[1]).replace(/\s*[—–-]\s*unavailable\s*$/i, '')
        if (label) stats.push({ label, home: null, away: null })
        continue
      }
      const label = cleanText(block.match(/<p class="segment-data">([\s\S]*?)<\/p>/)?.[1] ?? '')
      const values = [...block.matchAll(/data-value="([^"]*)"/g)].map((m) => toStatNumber(m[1]))
      if (label) stats.push({ label, home: values[0] ?? null, away: values[1] ?? null })
    }
  }

  if (stats.length === 0) return null
  return {
    homeTeam: homeTeam || null,
    awayTeam: awayTeam || null,
    homeScore,
    awayScore,
    stats,
  }
}

export async function fetchAccStatistics(fixture: Fixture): Promise<SourceStatistics> {
  let matchId: string | null
  try {
    matchId = await resolveMatchId(fixture)
  } catch (error) {
    return { ...empty(), state: 'error', message: `Tidak dapat memuat daftar laga ACC (${errorMessage(error)}).` }
  }
  if (!matchId) return empty('Laga ini belum ada di arsip statistik resmi ASEAN United FC.')

  const url = `${STATS_BASE}/${encodeURIComponent(matchId)}/stats`
  let html: string
  try {
    html = await fetchText(url, {
      revalidate: STATS_FETCH_REVALIDATE,
      timeoutMs: STATS_FETCH_TIMEOUT_MS,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html' },
    })
  } catch (error) {
    return { ...empty(), url, state: 'error', message: `Gagal membaca statistik ACC (${errorMessage(error)}).` }
  }

  const parsed = parseStats(html)
  if (!parsed) return { ...empty(), url, message: 'Statistik belum tersedia untuk laga ini.' }

  return {
    state: 'found',
    sourceId: 'acc',
    sourceName: 'ASEAN United FC',
    url,
    ...parsed,
  }
}

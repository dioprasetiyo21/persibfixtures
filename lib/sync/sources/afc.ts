import { AFC_COMPETITION_CODES, AFC_FIXTURES_URL } from '../config'
import { fetchText } from '../http'
import { cleanText, isPersib } from '../teams'
import type { SourceMatch, SourceReport } from '../types'

interface AfcTeam {
  name?: string
  shortName?: string
  score?: number | string
}

/** Only results that can change a score are emitted; live rows are never final. */
function parseStatus(raw: unknown): 'live' | 'finished' | null {
  const status = String(raw ?? '').toLowerCase()
  if (/(full|finish|ended|played|result|\bft\b)/.test(status)) return 'finished'
  if (/(live|inplay|in-play|halftime|half-time|\bht\b|\d+')/.test(status)) return 'live'
  return null
}

/** Missing scores stay null so a scheduled 0-0 placeholder is never published. */
function parseScore(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 ? raw : null
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim())
  return null
}

/**
 * The AFC widget API is undocumented, so accept the common field layouts that
 * have been observed and ignore anything else instead of guessing.
 */
function parseAfc(payload: unknown): SourceMatch[] {
  const items = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(items)) return []
  const out: SourceMatch[] = []

  for (const item of items as Record<string, unknown>[]) {
    const status = parseStatus(item.status ?? item.matchStatus)
    if (!status) continue

    // The dataset has no preliminary-round fixtures; without this guard that
    // result falls through to the TBD Round-of-16 placeholder.
    const stage = String((item.stage as { name?: unknown } | undefined)?.name ?? '').toUpperCase()
    if (stage === 'PRELIMINARY STAGE') continue

    const home = (item.homeTeam ?? item.home) as AfcTeam | undefined
    const away = (item.awayTeam ?? item.away) as AfcTeam | undefined
    const result = item.result as
      | { homeGoals?: unknown; awayGoals?: unknown; homeScore?: unknown; awayScore?: unknown }
      | undefined
    const homeScore = parseScore(result?.homeGoals ?? result?.homeScore ?? home?.score)
    const awayScore = parseScore(result?.awayGoals ?? result?.awayScore ?? away?.score)
    const homeTeam = cleanText(String(home?.name ?? home?.shortName ?? ''))
    const awayTeam = cleanText(String(away?.name ?? away?.shortName ?? ''))

    const rawDate = String(
      item.dateVenue ?? item.date ?? item.matchDate ?? item.kickOff ?? item.startDate ?? '',
    )
    const date = rawDate.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
    if (!date || !homeTeam || !awayTeam) continue
    if (homeScore === null || awayScore === null) continue

    const persibHome = isPersib(homeTeam)
    const persibAway = isPersib(awayTeam)
    if (!persibHome && !persibAway) continue

    const id = String(item.ffeedId ?? item.id ?? item.matchId ?? item.fixtureId ?? '') || null
    out.push({
      source: 'AFC Champions League Two (the-afc.com)',
      sourceUrl: AFC_FIXTURES_URL,
      competition: 'ACL2',
      week: null,
      date,
      // dateVenue is in the venue timezone; do not relabel it as WIB kickoff.
      kickoff: null,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      status,
      stadium: null,
      sourceMatchId: id ? `${date}:${id}` : `${date}:${homeTeam}:${awayTeam}`,
    })
  }

  return out
}

/** Read the AFC live/fixtures feed. It only publishes live and finished matches. */
export async function scrapeAfc(options: { fresh?: boolean } = {}): Promise<{
  matches: SourceMatch[]
  report: SourceReport
}> {
  const started = Date.now()
  // The feed needs an explicit season; `source=OPTA&live=true` returns an empty
  // array even though the same matches are present without those parameters.
  const params = new URLSearchParams({
    competitionCodes: AFC_COMPETITION_CODES,
    locale: 'en',
    season: 'latest',
  })
  const url = `${AFC_FIXTURES_URL}?${params}`
  const report: SourceReport = {
    name: 'AFC Champions League Two (the-afc.com)',
    url: AFC_FIXTURES_URL,
    ok: false,
    found: 0,
    total: 0,
    weeks: [],
    unavailableWeeks: [],
    durationMs: 0,
  }

  try {
    const body = await fetchText(url, {
      revalidate: options.fresh ? 0 : 120,
      headers: { Accept: 'application/json' },
    })
    const payload: unknown = JSON.parse(body)
    const matches = parseAfc(payload)
    const items = (payload as { data?: unknown } | null)?.data
    report.found = matches.length
    report.total = Array.isArray(items) ? items.length : 0
    if (report.total === 0) {
      report.note = 'The AFC feed returned no matches; check the competition code and season.'
    }
    report.ok = true
    report.durationMs = Date.now() - started
    return { matches, report }
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Request failed'
    report.durationMs = Date.now() - started
    return { matches: [], report }
  }
}

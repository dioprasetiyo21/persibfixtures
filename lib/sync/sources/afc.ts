import { AFC_COMPETITION_CODES, AFC_FIXTURES_URL } from '../config'
import { fetchText } from '../http'
import { cleanText, isPersib } from '../teams'
import type { SourceMatch, SourceReport } from '../types'

interface AfcTeam {
  name?: string
  shortName?: string
  score?: number | string
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
    const status = String(item.status ?? item.matchStatus ?? '').toLowerCase()
    if (!/(full|finish|ended|played|result)/.test(status)) continue

    const home = (item.homeTeam ?? item.home) as AfcTeam | undefined
    const away = (item.awayTeam ?? item.away) as AfcTeam | undefined
    const result = item.result as { homeScore?: unknown; awayScore?: unknown } | undefined
    const homeScore = Number(result?.homeScore ?? home?.score)
    const awayScore = Number(result?.awayScore ?? away?.score)
    const homeTeam = cleanText(String(home?.name ?? home?.shortName ?? ''))
    const awayTeam = cleanText(String(away?.name ?? away?.shortName ?? ''))

    const rawDate = String(item.date ?? item.matchDate ?? item.kickOff ?? item.startDate ?? '')
    const date = rawDate.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
    if (!date || !homeTeam || !awayTeam) continue
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue

    const persibHome = isPersib(homeTeam)
    const persibAway = isPersib(awayTeam)
    if (!persibHome && !persibAway) continue

    const id = String(item.id ?? item.matchId ?? item.fixtureId ?? '') || null
    out.push({
      source: 'AFC Champions League Two (the-afc.com)',
      sourceUrl: AFC_FIXTURES_URL,
      competition: 'ACL2',
      week: null,
      date,
      kickoff: null,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      status: 'finished',
      stadium: null,
      sourceMatchId: id ? `${date}:${id}` : `${date}:${homeTeam}:${awayTeam}`,
    })
  }

  return out
}

/** Read the AFC live/fixtures feed. It only publishes results, never schedules. */
export async function scrapeAfc(options: { fresh?: boolean } = {}): Promise<{
  matches: SourceMatch[]
  report: SourceReport
}> {
  const started = Date.now()
  const params = new URLSearchParams({
    competitionCodes: AFC_COMPETITION_CODES,
    locale: 'en',
    source: 'OPTA',
    live: 'true',
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
    const matches = parseAfc(JSON.parse(body))
    report.found = matches.length
    report.total = matches.length
    report.ok = true
    report.durationMs = Date.now() - started
    return { matches, report }
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Request failed'
    report.durationMs = Date.now() - started
    return { matches: [], report }
  }
}

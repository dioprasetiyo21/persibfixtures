import {
  ILEAGUE_CONCURRENCY,
  ILEAGUE_MAX_WEEKS,
  ILEAGUE_WEEK_END,
  ILEAGUE_WEEK_START,
  type IleagueCompetitionConfig,
} from '../config'
import { fetchText, mapLimit } from '../http'
import { cleanText, isPersib } from '../teams'
import type { SourceMatch, SourceReport } from '../types'

interface ParsedPage {
  week: number | null
  availableWeeks: number[]
  rows: ParsedRow[]
}

interface ParsedRow {
  date: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: SourceMatch['status']
  kickoff: string | null
  stadium: string | null
  sourceMatchId: string
}

function parseKickoff(text: string): string | null {
  const match = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (!match) return null
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function parseStatus(badge: string, homeScore: number | null, awayScore: number | null): SourceMatch['status'] {
  const text = badge.toLowerCase()
  if (/(batal|cancel|annul)/.test(text)) return 'cancelled'
  if (/(tunda|postpon|ditolak|abandon)/.test(text)) return 'postponed'
  if (/(live|ht|sedang|berlangsung|et\b|pen\b)/.test(text)) return 'live'
  if (/(ft|full ?time|selesai|akhir)/.test(text)) {
    return homeScore !== null && awayScore !== null ? 'finished' : 'unknown'
  }
  if (homeScore !== null && awayScore !== null) {
    // A score with an unrecognised marker is not proof of a final result.
    return 'unknown'
  }
  if (parseKickoff(badge)) return 'scheduled'
  return 'unknown'
}

function parseBadge(body: string): string {
  // The badge can contain a nested <span> for the status ("FT"/"LIVE"), so read
  // to the end of the enclosing cell instead of stopping at the first </span>.
  const cell = body.match(/<span class="badge[^"]*"[^>]*>([\s\S]*?)<\/td>/)
  if (cell) return cleanText(cell[1].replace(/<[^>]+>/g, ' '))
  const span = body.match(/<span class="badge[^"]*"[^>]*>([\s\S]*?)<\/span>/)
  return span ? cleanText(span[1].replace(/<[^>]+>/g, ' ')) : ''
}

function parseScore(badge: string): [number | null, number | null] {
  // A lone "19:00" is a kickoff time, not a 19–0 score.
  if (/^\d{1,2}:\d{2}$/.test(badge.trim())) return [null, null]
  const m = badge.match(/(\d{1,2})\s*[:–-]\s*(\d{1,2})/)
  if (!m) return [null, null]
  return [Number(m[1]), Number(m[2])]
}

function parsePage(html: string, requestedWeek: number): ParsedPage {
  const selected = html.match(/<option value="(\d+)"\s+selected/)
  const week = selected ? Number(selected[1]) : requestedWeek

  const availableWeeks = [
    ...new Set([...html.matchAll(/<option value="(\d+)"[^>]*>/g)].map((m) => Number(m[1]))),
  ]
    .filter((n) => Number.isInteger(n) && n > 0 && n <= ILEAGUE_MAX_WEEKS)
    .sort((a, b) => a - b)

  const rows: ParsedRow[] = []
  const rowRe = /<a\b[^>]*href="(https?:\/\/ileague\.id\/result\/detail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(rowRe)) {
    const [, href, body] = match
    const path = href.replace(/^https?:\/\/[^/]+/, '')
    const parts = path.split('/').filter(Boolean)
    // result / detail / <competition> / <YYYY-MM-DD> / <home> / <away>
    if (parts.length < 6) continue
    const [, , , date, homeSlug, awaySlug] = parts
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue

    const names = [...body.matchAll(/<b>([^<]*)<\/b>/g)].map((m) => cleanText(m[1]))
    const homeTeam = names[0] ?? cleanText(homeSlug.replace(/_+/g, ' '))
    const awayTeam = names[1] ?? cleanText(awaySlug.replace(/_+/g, ' '))
    if (!homeTeam || !awayTeam) continue

    const badge = parseBadge(body)
    const [homeScore, awayScore] = parseScore(badge)
    const status = parseStatus(badge, homeScore, awayScore)
    const stadiumCell = body.match(/<td[^>]*width="30%"[^>]*>([\s\S]*?)<\/td>/)
    const stadium = stadiumCell ? cleanText(stadiumCell[1].replace(/<[^>]+>/g, ' ')) : null

    rows.push({
      date,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      status,
      kickoff: status === 'scheduled' ? parseKickoff(badge) : null,
      stadium: stadium || null,
      sourceMatchId: path,
    })
  }

  return { week, availableWeeks, rows }
}

function sanitizeDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const year = Number(date.slice(0, 4))
  if (year < 2020 || year > 2100) return null
  return date
}

/**
 * Scrape the official I.League weekly fixture pages.
 *
 * Weeks are discovered from the week picker on the first valid page, so a new
 * week published by the league is picked up automatically. Invalid weeks return
 * HTTP 200 with an empty table on ileague.id, which is why empty pages are
 * reported as "unavailable" instead of an error.
 */
export async function scrapeIleague(
  cfg: IleagueCompetitionConfig,
  options: { weeks?: number[]; fresh?: boolean } = {},
): Promise<{ matches: SourceMatch[]; report: SourceReport }> {
  const started = Date.now()
  const revalidate = options.fresh ? 0 : 120
  const report: SourceReport = {
    name: `${cfg.label} (ileague.id)`,
    url: cfg.url,
    ok: false,
    found: 0,
    total: 0,
    weeks: [],
    unavailableWeeks: [],
    durationMs: 0,
  }

  const pageUrl = (week: number) => `${cfg.url}/${week}`
  const fetchWeek = async (week: number) => {
    const html = await fetchText(pageUrl(week), { revalidate })
    return parsePage(html, week)
  }

  let weeks: number[] = []
  let firstPage: ParsedPage | null = null

  if (options.weeks && options.weeks.length > 0) {
    weeks = [...new Set(options.weeks)].sort((a, b) => a - b)
  } else {
    // Discover the available weeks from the starting page, falling back to week 1.
    const candidates = [...new Set([ILEAGUE_WEEK_START, 1])]
    for (const candidate of candidates) {
      try {
        firstPage = await fetchWeek(candidate)
        if (firstPage.availableWeeks.length > 0) break
      } catch {
        firstPage = null
      }
      if (firstPage && firstPage.rows.length > 0) break
    }
    if (!firstPage) {
      report.error = 'Week picker unavailable and the first week could not be loaded'
      report.durationMs = Date.now() - started
      return { matches: [], report }
    }
    const maxWeek = ILEAGUE_WEEK_END ?? Math.max(...(firstPage.availableWeeks.length ? firstPage.availableWeeks : [firstPage.week ?? 1]))
    weeks = []
    for (let week = ILEAGUE_WEEK_START; week <= maxWeek; week++) weeks.push(week)
  }

  const pages = await mapLimit(weeks, ILEAGUE_CONCURRENCY, async (week) => {
    if (firstPage && week === (firstPage.week ?? -1)) return { week, page: firstPage }
    try {
      return { week, page: await fetchWeek(week) }
    } catch (error) {
      return { week, error: error instanceof Error ? error.message : 'request failed' }
    }
  })

  const matches: SourceMatch[] = []
  const seen = new Set<string>()
  const failures: string[] = []

  for (const entry of pages) {
    if (!entry.page) {
      failures.push(`week ${entry.week}: ${entry.error ?? 'failed'}`)
      continue
    }
    if (entry.page.rows.length === 0) {
      report.unavailableWeeks.push(entry.week)
      continue
    }
    report.weeks.push(entry.week)
    for (const row of entry.page.rows) {
      report.total++
      const persibHome = isPersib(row.homeTeam)
      const persibAway = isPersib(row.awayTeam)
      if (!persibHome && !persibAway) continue
      const key = row.sourceMatchId
      if (seen.has(key)) continue
      seen.add(key)
      const date = sanitizeDate(row.date)
      if (!date) continue
      matches.push({
        source: report.name,
        sourceUrl: pageUrl(entry.page.week ?? entry.week),
        competition: cfg.competition,
        week: entry.page.week ?? entry.week,
        date,
        kickoff: row.kickoff,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        status: row.status,
        stadium: row.stadium,
        sourceMatchId: row.sourceMatchId,
      })
    }
  }

  report.found = matches.length
  report.durationMs = Date.now() - started

  if (matches.length === 0 && failures.length >= weeks.length && weeks.length > 0) {
    report.ok = false
    report.error = `All ${weeks.length} week pages failed: ${failures.slice(0, 2).join('; ')}`
    return { matches, report }
  }

  if (failures.length > 0) {
    report.ok = matches.length > 0
    report.error = `${failures.length} week page(s) failed: ${failures.slice(0, 3).join('; ')}`
  } else {
    report.ok = true
  }

  return { matches, report }
}

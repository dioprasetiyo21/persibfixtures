import {
  ILEAGUE_CONCURRENCY,
  ILEAGUE_MAX_WEEKS,
  ILEAGUE_WEEK_END,
  ILEAGUE_WEEK_START,
  type IleagueCompetitionConfig,
} from '../config'
import { fetchText, mapLimit } from '../http'
import { cleanText, isPersib } from '../teams'
import type { SourceGoal, SourceMatch, SourceReport, SyncKind } from '../types'

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

/* ------------------------------ goal detail enrichment ------------------------------ */

const ILEAGUE_DETAIL_ORIGIN = 'https://ileague.id'

/** Club abbreviations are written in capitals by the source; keep them that way. */
const PRESERVED_UPPERCASE = new Set(['fc', 'psm', 'pss', 'psim', 'psis', 'psps', 'psms'])

function displayName(raw: string): string {
  return cleanText(raw)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      PRESERVED_UPPERCASE.has(word)
        ? word.toUpperCase()
        : word.replace(/^([a-z\u00c0-\u024f])/, (letter) => letter.toUpperCase()),
    )
    .join(' ')
}

function teamId(name: string): string {
  return cleanText(name).toUpperCase()
}

/**
 * The result detail page lists goals and cards in the same `<ul>`. Only the
 * football icon marks a goal, so yellow/red cards can never become scorers.
 * `null` means the page did not publish a usable list; callers keep the score
 * unchanged in that case.
 */
function parseDetailGoals(
  html: string,
  homeTeam: string,
  awayTeam: string,
): SourceGoal[] | null {
  const blocks = [
    ...html.matchAll(/<div class="team(?: right)? match-hero-team">([\s\S]*?)<\/ul>/g),
  ]
  if (blocks.length === 0) return null

  const homeId = teamId(homeTeam)
  const awayId = teamId(awayTeam)
  const goals: SourceGoal[] = []

  for (const block of blocks) {
    const nameMatch = block[1].match(/match-hero-name">([\s\S]*?)<\/span>/)
    if (!nameMatch) continue
    const creditedTeam = teamId(nameMatch[1])
    const id = creditedTeam === homeId ? homeId : creditedTeam === awayId ? awayId : null
    if (!id) continue

    for (const item of block[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      if (!/fa-futbol-o/.test(item[1])) continue
      const text = cleanText(item[1].replace(/<[^>]+>/g, ' '))
      const minute = text.match(/(\d{1,3}(?:\+\d{1,2})?)'/)
      if (!minute || minute.index === undefined) continue
      const playerName = displayName(text.slice(0, minute.index)).trim()
      if (!playerName) continue
      goals.push({
        playerName,
        minute: `${minute[1]}'`,
        teamId: id,
        ownGoal: /\(og\)|own\s*goal/i.test(text),
        penaltyGoal: /\(p(?:en|alty)?\)|penalty/i.test(text),
      })
    }
  }

  return goals.length > 0 ? goals : null
}

/**
 * Enrich finished Persib results from their official detail pages. Failures
 * are isolated: a missing/inconsistent scorer list never blocks a score update.
 */
async function withIleagueGoals(
  matches: SourceMatch[],
  revalidate: number,
): Promise<{ matches: SourceMatch[]; failed: number }> {
  const candidates = matches.filter(
    (match) =>
      match.status === 'finished' &&
      match.homeScore !== null &&
      match.awayScore !== null &&
      match.sourceMatchId?.startsWith('/result/detail/'),
  )
  if (candidates.length === 0) return { matches, failed: 0 }

  const enriched = await mapLimit(candidates, ILEAGUE_CONCURRENCY, async (match) => {
    try {
      const html = await fetchText(`${ILEAGUE_DETAIL_ORIGIN}${match.sourceMatchId}`, { revalidate })
      const goals = parseDetailGoals(html, match.homeTeam, match.awayTeam)
      if (!goals) return null
      const homeId = teamId(match.homeTeam)
      const awayId = teamId(match.awayTeam)
      const homeGoals = goals.filter((goal) => goal.teamId === homeId).length
      const awayGoals = goals.filter((goal) => goal.teamId === awayId).length
      if (homeGoals !== match.homeScore || awayGoals !== match.awayScore) return null
      return {
        ...match,
        homeTeam: displayName(match.homeTeam),
        awayTeam: displayName(match.awayTeam),
        homeTeamId: homeId,
        awayTeamId: awayId,
        goals,
      }
    } catch {
      return null
    }
  })

  const replacements = new Map<string, SourceMatch>()
  for (let index = 0; index < candidates.length; index++) {
    const result = enriched[index]
    if (result) replacements.set(candidates[index].sourceMatchId as string, result)
  }

  let failed = 0
  const next = matches.map((match) => {
    const replacement = replacements.get(match.sourceMatchId ?? '')
    if (!replacement) {
      if (candidates.includes(match)) failed++
      return match
    }
    return replacement
  })
  return { matches: next, failed }
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
  options: { weeks?: number[]; fresh?: boolean; kind?: SyncKind } = {},
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

  let matches: SourceMatch[] = []
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

  // Detail enrichment is scores-only. Schedule refreshes keep the original
  // source report and must not fetch scorer pages or add a failure note.
  if (options.kind === 'scores') {
    const enriched = await withIleagueGoals(matches, revalidate)
    matches = enriched.matches
    if (enriched.failed > 0) {
      report.note = `${enriched.failed} result detail page(s) had no scorer list matching the final score; scores were left unchanged.`
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

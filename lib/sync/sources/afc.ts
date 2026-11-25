import {
  AFC_COMPETITION_CODES,
  AFC_FIXTURES_PAGE_URL,
  AFC_FIXTURES_URL,
} from '../config'
import { fetchText } from '../http'
import { cleanText, isPersib } from '../teams'
import type { SourceContext, SourceGoal, SourceMatch, SourceReport } from '../types'

interface AfcTeam {
  name?: string
  shortName?: string
  id?: string
  score?: number | string
}

interface AfcGoal {
  playerName?: unknown
  timeMinSecAdvanced?: unknown
  timeMinSec?: unknown
  teamId?: unknown
  ownGoal?: unknown
  penaltyGoal?: unknown
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
 * Read goals from the same feed that supplies the score. Malformed goal rows
 * are skipped; a broken goals array never prevents the score from being used.
 */
function parseGoals(raw: unknown): SourceGoal[] {
  if (!Array.isArray(raw)) return []
  const goals: SourceGoal[] = []

  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue
    const ownGoal = item.ownGoal === true
    const penaltyGoal = item.penaltyGoal === true && !ownGoal
    // AFC already appends "(OG)" to some player names. Strip the source marker
    // so the canonical flag is added exactly once by the formatter.
    let playerName = cleanText(String(item.playerName ?? ''))
    if (ownGoal) playerName = playerName.replace(/\s*\((?:OG|own goal)\)\s*$/i, '').trim()
    else if (penaltyGoal) playerName = playerName.replace(/\s*\((?:pen|penalty)\)\s*$/i, '').trim()
    if (!playerName) continue
    const minuteRaw = item.timeMinSecAdvanced ?? item.timeMinSec
    const minute = typeof minuteRaw === 'string' && minuteRaw.trim() ? minuteRaw.trim() : null
    goals.push({
      playerName,
      minute,
      teamId: typeof item.teamId === 'string' && item.teamId.trim() ? item.teamId.trim() : null,
      ownGoal,
      penaltyGoal,
    })
  }

  return goals
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
      | { homeGoals?: unknown; awayGoals?: unknown; homeScore?: unknown; awayScore?: unknown; goals?: unknown }
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
    const goals = status === 'finished' ? parseGoals(result?.goals) : []
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
      homeTeamId: typeof home?.id === 'string' ? home.id : null,
      awayTeamId: typeof away?.id === 'string' ? away.id : null,
      homeScore,
      awayScore,
      status,
      stadium: null,
      sourceMatchId: id ? `${date}:${id}` : `${date}:${homeTeam}:${awayTeam}`,
      ...(goals.length > 0 ? { goals } : {}),
    })
  }

  return out
}

/* ------------------------- official match-report context ------------------------- */

/** Nuxt's devalue payload stores strings/objects as indices into one flat array. */
function payloadString(data: unknown[], value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < data.length) {
    const resolved = data[value]
    if (typeof resolved === 'string') return resolved
  }
  return null
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Only explicit statements in an official AFC article become context. */
function detectContext(text: string): string | null {
  const topSpot = text.match(
    /\b(?:sealed|secured|clinched)\s+(?:the\s+)?top\s+spot\s+in\s+group\s+([a-z0-9]+)\b/i,
  )
  if (topSpot) return `Secured top spot in Group ${topSpot[1].toUpperCase()}.`

  if (/\bqualified\s+for\s+the\s+round\s+of\s+16\b/i.test(text)) {
    return 'Secured Round of 16 qualification.'
  }
  return null
}

function parseAfcContexts(html: string): Map<string, SourceContext> {
  const contexts = new Map<string, SourceContext>()
  const script = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!script) return contexts

  let data: unknown
  try {
    data = JSON.parse(script[1])
  } catch {
    return contexts
  }
  if (!Array.isArray(data)) return contexts

  for (const entry of data) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (!('matchId' in record) || !('fullText' in record)) continue

    const matchId = payloadString(data, record.matchId)
    if (!matchId || !/^\d+$/.test(matchId)) continue

    const title = payloadString(data, record.name) ?? ''
    const teaser = payloadString(data, record.teaserText) ?? ''
    const body = payloadString(data, record.fullText) ?? ''
    const context = detectContext(stripHtml(`${title} ${teaser} ${body}`))
    if (context) contexts.set(matchId, { text: context, sourceUrl: AFC_FIXTURES_PAGE_URL })
  }

  return contexts
}

/** Best-effort enrichment: failures here must never affect score updates. */
async function withAfcContext(matches: SourceMatch[], fresh: boolean): Promise<SourceMatch[]> {
  if (matches.length === 0) return matches
  try {
    const html = await fetchText(AFC_FIXTURES_PAGE_URL, { revalidate: fresh ? 0 : 600 })
    const contexts = parseAfcContexts(html)
    if (contexts.size === 0) return matches
    return matches.map((match) => {
      const id = match.sourceMatchId?.split(':').pop() ?? ''
      const context = contexts.get(id)
      return context ? { ...match, context } : match
    })
  } catch {
    return matches
  }
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
    const parsed = parseAfc(payload)
    const matches = await withAfcContext(parsed, options.fresh === true)
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

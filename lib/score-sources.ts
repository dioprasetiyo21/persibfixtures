import type { CompetitionId, RawFixture, ScoreResult } from './types'

/** One finished Persib match as published by a league website. */
export interface SourceMatch {
  competition: CompetitionId
  date: string
  opponent: string
  score: ScoreResult
}

export interface SourceReport {
  name: string
  ok: boolean
  found: number
  error?: string
}

const ILEAGUE = 'https://ileague.id/fixtures/index'
const ACC_URL = 'https://aseanutdfc.com/id/asean-club-championship/matches'
const AFC_URL = 'https://www.the-afc.com/api/live/fixtures'
const ILEAGUE_CUP_WEEKS = 8
const MAX_SUPER_LEAGUE_WEEKS = 8

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

type FetchMode = { fresh: boolean }

async function fetchText(url: string, { fresh }: FetchMode): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersibCalendar/1.0)', Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(12000),
    ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 60 } }),
  })
  if (!res.ok) throw new Error(`${new URL(url).hostname} responded ${res.status}`)
  return res.text()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

export function normalizeName(name: string): string {
  return decodeEntities(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\b(fc|fk|sc)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function sameTeam(a: string, b: string): boolean {
  const x = normalizeName(a)
  const y = normalizeName(b)
  return x.length > 0 && y.length > 0 && (x === y || x.includes(y) || y.includes(x))
}

/* ---------------------------------- ileague.id --------------------------------- */

function parseIleague(html: string, competition: CompetitionId): SourceMatch[] {
  const rows = html.matchAll(
    /<a\s[^>]*?href="[^"]*\/result\/detail\/[^"]*\/(\d{4}-\d{2}-\d{2})\/([^/"]+)\/([^/"]+)"[^>]*>([\s\S]*?)<\/a>/g,
  )
  const out: SourceMatch[] = []
  for (const [, date, homeSlug, awaySlug, body] of rows) {
    const score = body.match(/FT<\/span>\s*(\d+)\s*:\s*(\d+)/)
    if (!score) continue
    const home = Number(score[1])
    const away = Number(score[2])
    const persibHome = homeSlug.includes('PERSIB_BANDUNG')
    const persibAway = awaySlug.includes('PERSIB_BANDUNG')
    if (!persibHome && !persibAway) continue
    out.push({
      competition,
      date,
      opponent: (persibHome ? awaySlug : homeSlug).replace(/_/g, ' '),
      score: persibHome ? { persib: home, opponent: away } : { persib: away, opponent: home },
    })
  }
  return out
}

async function fetchIleagueWeeks(
  slug: string,
  competition: CompetitionId,
  weeks: number[],
  mode: FetchMode,
): Promise<SourceMatch[]> {
  const pages = await Promise.allSettled(
    weeks.map((week) => fetchText(`${ILEAGUE}/${slug}/${week}`, mode)),
  )
  const matches: SourceMatch[] = []
  let failures = 0
  for (const page of pages) {
    if (page.status === 'fulfilled') matches.push(...parseIleague(page.value, competition))
    else failures++
  }
  if (failures === pages.length && pages.length > 0) throw new Error('ileague.id is unreachable')
  return matches
}

/* ------------------------------- aseanutdfc.com (ACC) ------------------------------- */

function parseAcc(html: string): SourceMatch[] {
  const sections = html.split(/<div id="scroll-\d+" class="mn-dt-part">/).slice(1)
  const out: SourceMatch[] = []
  for (const section of sections) {
    const header = section.match(/<h3>\s*([A-Za-z]{3}) (\d{2}) (\d{4})\s*<\/h3>/)
    if (!header) continue
    const date = `${header[3]}-${MONTHS[header[1]] ?? '01'}-${header[2]}`
    for (const card of section.split('<div class="first-card-match').slice(1)) {
      if (!/full time/i.test(card)) continue
      const names = [...card.matchAll(/<h4>\s*([^<]*?)\s*<\/h4>/g)]
        .map((m) => decodeEntities(m[1].replace(/\s+/g, ' ').trim()))
        .filter((n) => n && n.toLowerCase() !== 'vs')
      const [homeName, awayName] = names
      const centre = card.split('vs-dtl-main')[1] ?? ''
      const scores = [...centre.matchAll(/<h3>\s*(\d+)\s*<\/h3>/g)].map((m) => Number(m[1]))
      if (!homeName || !awayName || scores.length < 2) continue
      const persibHome = /^persib/i.test(homeName)
      const persibAway = /^persib/i.test(awayName)
      if (!persibHome && !persibAway) continue
      const [home, away] = scores
      out.push({
        competition: 'ACC',
        date,
        opponent: persibHome ? awayName : homeName,
        score: persibHome ? { persib: home, opponent: away } : { persib: away, opponent: home },
      })
    }
  }
  return out
}

async function fetchAcc(mode: FetchMode): Promise<SourceMatch[]> {
  return parseAcc(await fetchText(ACC_URL, mode))
}

/* ------------------------------- the-afc.com (ACL Two) ------------------------------- */

interface AfcTeam {
  name?: string
  shortName?: string
  score?: number | string
}

/** Best-effort: the AFC widget API is undocumented, so accept the common field layouts. */
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
    const homeName = home?.name ?? home?.shortName ?? ''
    const awayName = away?.name ?? away?.shortName ?? ''
    const rawDate = String(item.date ?? item.matchDate ?? item.kickOff ?? item.startDate ?? '')
    const date = rawDate.match(/\d{4}-\d{2}-\d{2}/)?.[0]
    if (!date || !Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue
    const persibHome = /persib/i.test(homeName)
    const persibAway = /persib/i.test(awayName)
    if (!persibHome && !persibAway) continue
    out.push({
      competition: 'ACL2',
      date,
      opponent: persibHome ? awayName : homeName,
      score: persibHome
        ? { persib: homeScore, opponent: awayScore }
        : { persib: awayScore, opponent: homeScore },
    })
  }
  return out
}

async function fetchAfc(mode: FetchMode): Promise<SourceMatch[]> {
  const params = new URLSearchParams({
    competitionCodes: 'afc-champions-league-two',
    locale: 'en',
    source: 'OPTA',
    live: 'true',
  })
  const body = await fetchText(`${AFC_URL}?${params}`, mode)
  return parseAfc(JSON.parse(body))
}

/* ------------------------------------- orchestration ------------------------------------- */

function jakartaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

/** Fixtures whose date has arrived but still have no final score. */
export function pendingFixtures(fixtures: RawFixture[]): RawFixture[] {
  const today = jakartaToday()
  return fixtures.filter(
    (f) =>
      !f.score &&
      f.date !== null &&
      f.date <= today &&
      (f.status === 'scheduled' || f.status === 'tentative'),
  )
}

export async function fetchSourceMatches(
  pending: RawFixture[],
  mode: FetchMode,
): Promise<{ matches: SourceMatch[]; reports: SourceReport[] }> {
  const jobs: { name: string; run: () => Promise<SourceMatch[]> }[] = []
  const has = (c: CompetitionId) => pending.some((f) => f.competition === c)

  if (has('SL')) {
    const weeks = [
      ...new Set(
        pending
          .filter((f) => f.competition === 'SL')
          .map((f) => Number(f.round.match(/Pekan (\d+)/)?.[1] ?? f.id.match(/^sl-(\d+)$/)?.[1]))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, MAX_SUPER_LEAGUE_WEEKS)
    if (weeks.length > 0) {
      jobs.push({
        name: 'BRI Super League (ileague.id)',
        run: () => fetchIleagueWeeks('BRI_SUPER_LEAGUE_2026-27', 'SL', weeks, mode),
      })
    }
  }
  if (has('ILC')) {
    const weeks = Array.from({ length: ILEAGUE_CUP_WEEKS }, (_, i) => i + 1)
    jobs.push({
      name: 'I-League Cup (ileague.id)',
      run: () => fetchIleagueWeeks('I.LEAGUE_CUP_2026-2027', 'ILC', weeks, mode),
    })
  }
  if (has('ACC')) jobs.push({ name: 'Shopee Cup (aseanutdfc.com)', run: () => fetchAcc(mode) })
  if (has('ACL2')) jobs.push({ name: 'AFC Champions League Two (the-afc.com)', run: () => fetchAfc(mode) })

  const settled = await Promise.allSettled(jobs.map((job) => job.run()))
  const matches: SourceMatch[] = []
  const reports: SourceReport[] = settled.map((result, i) => {
    const name = jobs[i].name
    if (result.status === 'fulfilled') {
      matches.push(...result.value)
      return { name, ok: true, found: result.value.length }
    }
    const error = result.reason instanceof Error ? result.reason.message : 'Request failed'
    return { name, ok: false, found: 0, error }
  })
  return { matches, reports }
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/** Maps scraped matches onto fixture ids by competition, date (±1 day) and opponent name. */
export function matchToFixtures(
  fixtures: RawFixture[],
  matches: SourceMatch[],
): Record<string, ScoreResult> {
  const out: Record<string, ScoreResult> = {}
  const used = new Set<SourceMatch>()
  for (const fixture of fixtures) {
    if (!fixture.date) continue
    const candidates = matches
      .filter(
        (m) =>
          !used.has(m) &&
          m.competition === fixture.competition &&
          dayDistance(m.date, fixture.date as string) <= 1 &&
          (fixture.opponent === 'TBD' || sameTeam(m.opponent, fixture.opponent)),
      )
      .sort(
        (a, b) =>
          dayDistance(a.date, fixture.date as string) - dayDistance(b.date, fixture.date as string),
      )
    const best = candidates[0]
    if (best) {
      used.add(best)
      out[fixture.id] = best.score
    }
  }
  return out
}

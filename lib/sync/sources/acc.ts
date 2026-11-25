import { ACC_MATCHES_URL, ACC_SOURCE_TZ } from '../config'
import { fetchText } from '../http'
import { cleanText, isPersib } from '../teams'
import { convertToWib, isIanaZone } from '../timezone'
import type { SourceGoal, SourceMatch, SourceReport, SyncKind } from '../types'

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
}

const SOURCE_NAME = 'ASEAN United FC – Shopee Cup'

/** The page groups matches into `<div id="scroll-N" class="mn-dt-part">` sections. */
const SECTION_SPLIT = /(?=<div id="scroll-\d+" class="mn-dt-part">)/

/** Each match is one `first-card-match` / `match-card-box` block. */
const CARD_RE =
  /<div class="(?:first-card-match[^"]*|match-card-box)"([\s\S]*?)(?=<div class="(?:first-card-match|match-card-box)"|<div id="scroll-\d+"|<\/section>|$)/g

const CLOCK_RE = /^\d{1,2}:\d{2}\s*(am|pm)$/i

/** Section header, e.g. `<h3>Nov 19 2026</h3>`. */
function parseSectionDate(section: string): string | null {
  const header = section.match(/<h3>\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\s*<\/h3>/)
  if (!header) return null
  const month = MONTHS[header[1].slice(0, 3).toLowerCase()]
  if (!month) return null
  return `${header[3]}-${month}-${header[2].padStart(2, '0')}`
}

function to24h(raw: string): string | null {
  const match = raw.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i)
  if (!match) return null
  let hour = Number(match[1]) % 12
  if (match[3].toLowerCase() === 'pm') hour += 12
  return `${String(hour).padStart(2, '0')}:${match[2]}`
}

function firstHeading(block: string): string | null {
  const match = block.match(/<h4>\s*([\s\S]*?)\s*<\/h4>/)
  const text = match ? cleanText(match[1]) : ''
  return text && !/^(tbd|tba)$/i.test(text) ? text : null
}

interface ParsedCard {
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  /** Clock time as shown, e.g. "07:00 pm". Null for finished/undated cards. */
  rawTime: string | null
  /** The `<p>` next to the time: either an IANA zone or a status marker. */
  marker: string | null
  group: string | null
  status: SourceMatch['status']
  sourceMatchId: string | null
}

/**
 * One card is:
 *   [home team] <div class="vs-dtl-main"> <h3>home</h3> <div class="other-details">
 *     <div class="grp-dtl">Grup B</div>
 *     <div class="vs-dtl"><h4>07:00 pm</h4><p>Asia/Jakarta</p></div>
 *     <a href=".../match/{id}/details">…</a>
 *   </div> <h3>away</h3> </div> [away team]
 */
function parseCard(card: string): ParsedCard | null {
  const mainIdx = card.indexOf('<div class="vs-dtl-main">')
  if (mainIdx === -1) return null
  const secondIdx = card.indexOf('scnd-team')

  const homeBlock = card.slice(0, mainIdx)
  const mainBlock = card.slice(mainIdx, secondIdx === -1 ? card.length : secondIdx)
  const awayBlock = secondIdx === -1 ? '' : card.slice(secondIdx)

  const homeTeam = firstHeading(homeBlock)
  const awayTeam = firstHeading(awayBlock)
  if (!homeTeam || !awayTeam) return null

  const scores = [...mainBlock.matchAll(/<h3>\s*([\s\S]*?)\s*<\/h3>/g)]
    .map((m) => cleanText(m[1]))
    .map((text) => (/^\d{1,2}$/.test(text) ? Number(text) : null))
  const homeScore = scores.length >= 2 ? scores[0] : null
  const awayScore = scores.length >= 2 ? scores[1] : null

  const details = mainBlock.match(
    /<div class="vs-dtl">\s*<h4>\s*([\s\S]*?)\s*<\/h4>\s*<p>\s*([\s\S]*?)\s*<\/p>/,
  )
  const heading = details ? cleanText(details[1]) : ''
  const marker = details ? cleanText(details[2]) : ''
  const rawTime = CLOCK_RE.test(heading) ? heading : null

  const group = cleanText((mainBlock.match(/<div class="grp-dtl">([\s\S]*?)<\/div>/) || [])[1] || '')

  const text = marker.toLowerCase()
  let status: SourceMatch['status'] = 'unknown'
  if (/(postpon|tunda)/.test(text)) status = 'postponed'
  else if (/(cancel|batal)/.test(text)) status = 'cancelled'
  else if (/(full ?time|selesai|akhir|\bft\b)/.test(text)) status = 'finished'
  else if (/(live|half ?time|berlangsung|in ?progress|\bht\b|\d+\s*')/.test(text)) status = 'live'
  else if (rawTime) status = 'scheduled'
  else if (homeScore !== null && awayScore !== null) status = 'finished'

  const idMatch = card.match(/\/match\/([A-Za-z0-9]+)\/details/)

  return {
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    rawTime,
    marker: marker || null,
    group: group || null,
    status,
    sourceMatchId: idMatch ? idMatch[1] : null,
  }
}

/* ------------------------------ goal detail enrichment ------------------------------ */

function accDetailUrl(matchId: string): string {
  const base = ACC_MATCHES_URL.replace(/\/matches\/?$/, '')
  return `${base}/match/${encodeURIComponent(matchId)}/details`
}

function accTeamId(name: string): string {
  return cleanText(name).toUpperCase()
}

function normalizeAccMinute(raw: string): string | null {
  const text = cleanText(raw)
  const added = text.match(/(\d{1,3})\s*'\s*\+\s*(\d{1,2})\s*'/)
  if (added) return `${added[1]}+${added[2]}'`
  const plain = text.match(/(\d{1,3})\s*'/)
  return plain ? `${plain[1]}'` : null
}

/**
 * The detail page splits scorers into a home column (`first-hlf-goal-comm`)
 * and an away column (`scnd-hlf-goal-comm`), despite the half-time class names.
 * Goal rows that cannot be tied to a side or to a minute are ignored.
 */
function parseAccGoals(html: string, homeTeam: string, awayTeam: string): SourceGoal[] | null {
  const section = html.match(
    /<div class="goal-comm-div-top">([\s\S]*?)<\/div>\s*<!--goals details ends-->/,
  )
  if (!section) return null

  const [homePart = '', awayPart = ''] = section[1].split(
    /<div class="mid-prt-goal-comm">[\s\S]*?<\/div>/,
  )
  const goals: SourceGoal[] = []

  for (const [part, team] of [
    [homePart, homeTeam],
    [awayPart, awayTeam],
  ] as const) {
    const id = accTeamId(team)
    for (const row of part.matchAll(/<div class="plyr-info d-flex">([\s\S]*?)<\/div>/g)) {
      const nameMatch = row[1].match(/<h4>([\s\S]*?)<\/h4>/)
      const minuteMatch = row[1].match(/<span>([\s\S]*?)<\/span>/)
      if (!nameMatch || !minuteMatch) continue
      const playerName = cleanText(nameMatch[1]).replace(/\s*\((?:og|p|pen|penalty)\)\s*$/i, '').trim()
      const minute = normalizeAccMinute(minuteMatch[1])
      if (!playerName || !minute) continue
      goals.push({
        playerName,
        minute,
        teamId: id,
        ownGoal: /\(og\)|own\s*goal/i.test(nameMatch[1]),
        penaltyGoal: /\(p(?:en|alty)?\)|penalty/i.test(nameMatch[1]),
      })
    }
  }

  return goals.length > 0 ? goals : null
}

/** Best-effort enrichment; a broken or inconsistent detail page never changes the score. */
async function withAccGoals(
  matches: SourceMatch[],
  revalidate: number,
): Promise<{ matches: SourceMatch[]; failed: number }> {
  const candidates = matches.filter(
    (match) =>
      match.status === 'finished' &&
      match.homeScore !== null &&
      match.awayScore !== null &&
      /^[A-Za-z0-9]+$/.test(match.sourceMatchId ?? ''),
  )
  if (candidates.length === 0) return { matches, failed: 0 }

  const enriched = await Promise.all(
    candidates.map(async (match) => {
      try {
        const html = await fetchText(accDetailUrl(match.sourceMatchId as string), { revalidate })
        const goals = parseAccGoals(html, match.homeTeam, match.awayTeam)
        if (!goals) return null
        const homeId = accTeamId(match.homeTeam)
        const awayId = accTeamId(match.awayTeam)
        const homeGoals = goals.filter((goal) => goal.teamId === homeId).length
        const awayGoals = goals.filter((goal) => goal.teamId === awayId).length
        if (homeGoals !== match.homeScore || awayGoals !== match.awayScore) return null
        return { ...match, homeTeamId: homeId, awayTeamId: awayId, goals }
      } catch {
        return null
      }
    }),
  )

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
 * Scrape the ASEAN Club Championship (Shopee Cup) match list published by
 * ASEAN United FC, converting every kickoff to WIB with IANA rules.
 */
export async function scrapeAcc(options: { fresh?: boolean; kind?: SyncKind } = {}): Promise<{
  matches: SourceMatch[]
  report: SourceReport
}> {
  const started = Date.now()
  const report: SourceReport = {
    name: SOURCE_NAME,
    url: ACC_MATCHES_URL,
    ok: false,
    found: 0,
    total: 0,
    weeks: [],
    unavailableWeeks: [],
    durationMs: 0,
  }

  let html: string
  try {
    html = await fetchText(ACC_MATCHES_URL, { revalidate: options.fresh ? 0 : 120 })
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Request failed'
    report.durationMs = Date.now() - started
    return { matches: [], report }
  }

  const sections = html.split(SECTION_SPLIT).filter((s) => s.includes('mn-dt-part'))
  let matches: SourceMatch[] = []
  const declaredZones = new Set<string>()
  const unresolved: string[] = []
  const shifted: string[] = []

  for (const section of sections) {
    const date = parseSectionDate(section)
    if (!date) continue
    for (const cardMatch of section.matchAll(CARD_RE)) {
      const parsed = parseCard(cardMatch[1])
      if (!parsed) continue
      report.total++

      const persibHome = isPersib(parsed.homeTeam)
      const persibAway = isPersib(parsed.awayTeam)
      if (!persibHome && !persibAway) continue

      // The card declares the zone it is expressed in; fall back to the
      // documented source timezone only when it does not.
      const declared = isIanaZone(parsed.marker) ? (parsed.marker as string) : null
      const sourceTz = declared ?? ACC_SOURCE_TZ

      let fixtureDate = date
      let kickoff: string | null = null
      if (parsed.status === 'scheduled' || parsed.status === 'live') {
        const hhmm = parsed.rawTime ? to24h(parsed.rawTime) : null
        if (hhmm && isIanaZone(sourceTz)) {
          const converted = convertToWib(date, hhmm, sourceTz)
          if (converted) {
            kickoff = converted.time
            if (converted.date !== date) fixtureDate = converted.date
            declaredZones.add(sourceTz)
            if (sourceTz !== 'Asia/Jakarta') shifted.push(`${fixtureDate} ${kickoff} WIB`)
          } else {
            unresolved.push(`${date} ${parsed.rawTime} (${sourceTz})`)
          }
        } else if (parsed.rawTime) {
          unresolved.push(`${date} ${parsed.rawTime} (${parsed.marker ?? 'no timezone'})`)
        }
      }

      matches.push({
        source: report.name,
        sourceUrl: ACC_MATCHES_URL,
        competition: 'ACC',
        week: null,
        date: fixtureDate,
        kickoff,
        homeTeam: parsed.homeTeam,
        awayTeam: parsed.awayTeam,
        homeScore: parsed.homeScore,
        awayScore: parsed.awayScore,
        status: parsed.status,
        stadium: null,
        sourceMatchId: parsed.sourceMatchId ?? `${fixtureDate}:${parsed.homeTeam}:${parsed.awayTeam}`,
      })
    }
  }

  const notes: string[] = []
  if (declaredZones.size > 0) {
    notes.push(`Kickoff times converted to Asia/Jakarta from ${[...declaredZones].sort().join(', ')} using IANA rules.`)
  }
  if (shifted.length > 0) {
    notes.push(`${shifted.length} kickoff(s) land on a different WIB calendar day than the source section date.`)
  }
  if (unresolved.length > 0) {
    notes.push(`Timezone not resolvable for ${unresolved.length} kickoff(s); left unconfirmed: ${unresolved.join('; ')}.`)
  }
  notes.push('The match list publishes the group but no matchday number, so existing round labels are left unchanged.')

  // Detail enrichment is scores-only. Schedule refreshes keep the original
  // source report and must not fetch scorer pages or add a failure note.
  if (options.kind === 'scores') {
    const enriched = await withAccGoals(matches, options.fresh ? 0 : 120)
    matches = enriched.matches
    if (enriched.failed > 0) {
      notes.push(`${enriched.failed} result detail page(s) had no scorer list matching the final score; scores were left unchanged.`)
    }
  }
  report.note = notes.join(' ')

  report.found = matches.length
  report.ok = true
  report.durationMs = Date.now() - started
  return { matches, report }
}

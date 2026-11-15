import { ACC_MATCHES_URL } from '../config'
import { fetchText } from '../http'
import { cleanText, isPersib } from '../teams'
import type { SourceMatch, SourceReport } from '../types'

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

function parseCards(section: string): string[] {
  const cardRe =
    /<div class="(?:first-card-match[^"]*|match-card-box)"([\s\S]*?)(?=<div class="(?:first-card-match|match-card-box)"|<div id="scroll-\d+"|<\/section>|$)/g
  return [...section.matchAll(cardRe)].map((m) => m[1])
}

function parseCard(card: string): {
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: SourceMatch['status']
  kickoff: string | null
  sourceMatchId: string | null
} | null {
  const headings = [...card.matchAll(/<h4>\s*([\s\S]*?)\s*<\/h4>/g)].map((m) => cleanText(m[1]))
  const names = headings.filter(
    (name) => name && !/^vs$/i.test(name) && !/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(name) && !/^(tbd|tba)$/i.test(name),
  )
  if (names.length < 2) return null
  const [homeTeam, awayTeam] = names

  const main = card.match(/<div class="vs-dtl-main">([\s\S]*?)<div class="team-flag-name-nd-score scnd-team">/)
  const mainBlock = main ? main[1] : card
  const scores = [...mainBlock.matchAll(/<h3>\s*([\s\S]*?)\s*<\/h3>/g)]
    .map((m) => cleanText(m[1]))
    .map((text) => (/^\d{1,2}$/.test(text) ? Number(text) : null))
    .filter((value): value is number => value !== null)
  const homeScore = scores.length >= 2 ? scores[0] : null
  const awayScore = scores.length >= 2 ? scores[1] : null

  const paragraphs = [...card.matchAll(/<p>\s*([^<]*?)\s*<\/p>/g)].map((m) => cleanText(m[1]))
  const marker = paragraphs.join(' ').toLowerCase()
  const timeText = headings.find((name) => /^\d{1,2}:\d{2}\s*(am|pm)$/i.test(name)) ?? ''

  let status: SourceMatch['status'] = 'unknown'
  if (/(postpon|tunda|batal|cancel)/.test(marker)) {
    status = /(batal|cancel)/.test(marker) ? 'cancelled' : 'postponed'
  } else if (/(full ?time|selesai|akhir)/.test(marker) && homeScore !== null && awayScore !== null) {
    status = 'finished'
  } else if (/(live|half ?time|berlangsung|in ?progress)/.test(marker)) {
    status = 'live'
  } else if (to24h(timeText)) {
    status = 'scheduled'
  }

  const idMatch = card.match(/\/match\/([A-Za-z0-9]+)\/details/)
  return {
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    status,
    kickoff: status === 'scheduled' || status === 'live' ? to24h(timeText) : null,
    sourceMatchId: idMatch ? idMatch[1] : null,
  }
}

/** Scrape the ASEAN Club Championship (Shopee Cup) match list. */
export async function scrapeAcc(options: { fresh?: boolean } = {}): Promise<{
  matches: SourceMatch[]
  report: SourceReport
}> {
  const started = Date.now()
  const report: SourceReport = {
    name: 'ASEAN Club Championship (aseanutdfc.com)',
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

  const sections = html.split(/(?=<div id="scroll-\d+" class="mn-dt-part">)/).filter((s) => s.includes('mn-dt-part'))
  const matches: SourceMatch[] = []

  for (const section of sections) {
    const date = parseSectionDate(section)
    if (!date) continue
    for (const card of parseCards(section)) {
      const parsed = parseCard(card)
      if (!parsed) continue
      report.total++
      const persibHome = isPersib(parsed.homeTeam)
      const persibAway = isPersib(parsed.awayTeam)
      if (!persibHome && !persibAway) continue
      matches.push({
        source: report.name,
        sourceUrl: ACC_MATCHES_URL,
        competition: 'ACC',
        week: null,
        date,
        kickoff: parsed.kickoff,
        homeTeam: parsed.homeTeam,
        awayTeam: parsed.awayTeam,
        homeScore: parsed.homeScore,
        awayScore: parsed.awayScore,
        status: parsed.status,
        stadium: null,
        sourceMatchId: parsed.sourceMatchId ? `${date}:${parsed.sourceMatchId}` : `${date}:${parsed.homeTeam}:${parsed.awayTeam}`,
      })
    }
  }

  report.found = matches.length
  report.ok = true
  report.durationMs = Date.now() - started
  return { matches, report }
}

import { COMPETITION_MAP } from './competitions'
import { homeAway, kickoffDate, scoreline, STATUS_LABEL, venueLabel } from './fixtures'
import type { Fixture } from './types'

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCSV(fixtures: Fixture[]) {
  const header = [
    'Date', 'Kickoff (WIB)', 'Competition', 'Round', 'Home', 'Away', 'Venue',
    'Status', 'Score', 'Kickoff confirmed', 'Source', 'Source URL', 'Verified',
  ]
  const rows = fixtures.map((f) => {
    const { home, away } = homeAway(f)
    return [
      f.date ?? 'TBA', f.kickoff ?? 'TBA', COMPETITION_MAP[f.competition].name, f.round,
      home, away, venueLabel(f), STATUS_LABEL[f.status], scoreline(f) ?? '',
      f.kickoffConfirmed ? 'yes' : 'no', f.source.name, f.source.url, f.verifiedAt,
    ].map(csvCell).join(',')
  })
  download('persib-2026-27-fixtures.csv', [header.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8')
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n')

export function buildICS(fixtures: Fixture[]) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Persib Calendar//2026-27//EN',
    'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Persib 2026/27', 'X-WR-TIMEZONE:Asia/Jakarta',
  ]
  const stamp = icsDate(new Date())
  for (const f of fixtures) {
    if (!f.date) continue
    const { home, away } = homeAway(f)
    const comp = COMPETITION_MAP[f.competition]
    const score = scoreline(f)
    lines.push('BEGIN:VEVENT', `UID:${f.id}@persib-calendar`, `DTSTAMP:${stamp}`)
    if (f.kickoff) {
      const start = kickoffDate(f)!
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
      lines.push(`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`)
    } else {
      const d = f.date.replace(/-/g, '')
      lines.push(`DTSTART;VALUE=DATE:${d}`)
    }
    lines.push(
      `SUMMARY:${icsText(`[${comp.short}] ${home} ${score ?? 'vs'} ${away}`)}`,
      `LOCATION:${icsText(venueLabel(f))}`,
      `DESCRIPTION:${icsText(`${comp.name} · ${f.round}\nStatus: ${STATUS_LABEL[f.status]}${f.kickoff && !f.kickoffConfirmed ? ' (kickoff provisional)' : ''}\nSource: ${f.source.url}`)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function exportICS(fixtures: Fixture[], filename = 'persib-2026-27.ics') {
  download(filename, buildICS(fixtures), 'text/calendar;charset=utf-8')
}

export function shareText(f: Fixture) {
  const { home, away } = homeAway(f)
  const comp = COMPETITION_MAP[f.competition]
  const score = scoreline(f)
  return `${comp.name} · ${f.round}\n${home} ${score ?? 'vs'} ${away}\n${f.date ?? 'Date TBA'} · ${f.kickoff ? `${f.kickoff} WIB` : 'Kickoff TBA'}\n${venueLabel(f)}`
}

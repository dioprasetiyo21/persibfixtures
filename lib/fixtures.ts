import { COMPETITION_MAP } from './competitions'
import type { Fixture } from './types'

export const TZ = 'Asia/Jakarta'
export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

export function kickoffDate(f: Fixture): Date | null {
  if (!f.date) return null
  return new Date(`${f.date}T${f.kickoff ?? '00:00'}:00+07:00`)
}

export function todayKeyWIB(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

export function monthKey(date: string) {
  return date.slice(0, 7)
}

export function seasonMonths(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  const months: string[] = []
  let y = sy
  let m = sm
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return months
}

export function monthLabel(key: string, style: 'long' | 'short' = 'long') {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-GB', { month: style, year: 'numeric', timeZone: 'UTC' })
    .toUpperCase()
}

/** Monday-first grid of ISO date strings (null = padding cell), always 6 rows. */
export function monthMatrix(key: string): (string | null)[][] {
  const [y, m] = key.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const offset = (first.getUTCDay() + 6) % 7
  const cells: (string | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${key}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length < 42) cells.push(null)
  const rows: (string | null)[][] = []
  for (let i = 0; i < 42; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

export function isCompleted(f: Fixture) {
  return f.status === 'finished'
}

export function isUpcoming(f: Fixture, now = new Date()) {
  if (f.status === 'finished' || f.status === 'cancelled') return false
  if (!f.date) return true
  return f.date >= todayKeyWIB(now)
}

export function sortFixtures(list: Fixture[]) {
  return [...list].sort((a, b) => {
    if (!a.date) return 1
    if (!b.date) return -1
    return (a.date + (a.kickoff ?? '99')).localeCompare(b.date + (b.kickoff ?? '99'))
  })
}

export function formatLongDate(date: string | null) {
  if (!date) return 'Date TBA'
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  })
}

export function formatShortDate(date: string | null) {
  if (!date) return 'TBA'
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  })
}

export function shortTeam(name: string) {
  return name
    .replace(/ (FC|Samarinda|Surabaya|Jakarta|Makassar|Kediri|Jepara|Sleman|Yogyakarta|Tangerang|Presisi|Kalteng FC)$/i, '')
    .replace(/^FC /, '')
    .toUpperCase()
}

export function teamInitials(name: string) {
  if (name === 'TBD') return '?'
  const words = name.replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

export function homeAway(f: Fixture) {
  const persib = 'Persib Bandung'
  if (f.venueType === 'away') return { home: f.opponent, away: persib }
  return { home: persib, away: f.opponent }
}

export function scoreline(f: Fixture) {
  if (!f.score) return null
  const { persib, opponent } = f.score
  return f.venueType === 'away' ? `${opponent}–${persib}` : `${persib}–${opponent}`
}

export function resultOutcome(f: Fixture): 'W' | 'D' | 'L' | null {
  if (!f.score) return null
  if (f.score.persib > f.score.opponent) return 'W'
  if (f.score.persib < f.score.opponent) return 'L'
  return 'D'
}

export function venueLabel(f: Fixture) {
  if (f.stadium) return f.city ? `${f.stadium}, ${f.city}` : f.stadium
  if (f.venueType === 'home') return 'Bandung · venue to be confirmed'
  if (f.city) return `${f.city} · venue to be confirmed`
  return 'Venue to be confirmed'
}

export const STATUS_LABEL: Record<Fixture['status'], string> = {
  finished: 'Finished',
  scheduled: 'Scheduled',
  tentative: 'Provisional',
  tba: 'Date TBA',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
}

export function matchesQuery(f: Fixture, q: string) {
  if (!q) return true
  const comp = COMPETITION_MAP[f.competition]
  const hay = [
    f.opponent,
    comp.name,
    comp.short,
    f.round,
    f.stadium ?? '',
    f.city ?? '',
    f.date ?? 'tba',
    formatLongDate(f.date),
    f.venueType,
  ]
    .join(' ')
    .toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t))
}

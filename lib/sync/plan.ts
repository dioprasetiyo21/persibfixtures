import type { CompetitionId, MatchStatus, RawFixture, VenueType } from '@/lib/types'
import { cloneDataset } from './dataset'
import { TZ } from './config'
import { isPersib, isPlaceholderTeam, sameTeam, sameVenue, cleanText } from './teams'
import type {
  ChangeKind,
  Dataset,
  FieldChange,
  PendingPayload,
  ProposedChange,
  SkippedMatch,
  SourceMatch,
  SyncKind,
} from './types'

const DAY_MS = 86_400_000

export function wibDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS)
}

function fixtureWeek(fixture: RawFixture): number | null {
  const match = fixture.round.match(/pekan\s*(\d{1,2})/i)
  return match ? Number(match[1]) : null
}

const FIELD_LABELS: Record<string, string> = {
  opponent: 'Opponent',
  date: 'Date',
  dateWindow: 'Date window',
  kickoff: 'Kickoff',
  kickoffConfirmed: 'Kickoff confirmed',
  venueType: 'Home / away',
  stadium: 'Stadium',
  city: 'City',
  round: 'Round',
  status: 'Status',
  score: 'Score',
  notes: 'Notes',
  verifiedAt: 'Verified at',
  sourceKey: 'Source key',
  sourceMatchId: 'Official match id',
}

const STATUS_TEXT: Record<MatchStatus, string> = {
  finished: 'Finished',
  scheduled: 'Scheduled',
  tentative: 'Provisional',
  tba: 'Date TBA',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
}

const VENUE_TEXT: Record<VenueType, string> = {
  home: 'Home',
  away: 'Away',
  neutral: 'Neutral',
  tba: 'TBA',
}

export function formatFieldValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  switch (field) {
    case 'date':
      return String(value)
    case 'kickoff':
      return `${value} WIB`
    case 'status':
      return STATUS_TEXT[value as MatchStatus] ?? String(value)
    case 'venueType':
      return VENUE_TEXT[value as VenueType] ?? String(value)
    case 'score': {
      const score = value as { persib?: number; opponent?: number }
      if (typeof score.persib !== 'number' || typeof score.opponent !== 'number') return null
      return `${score.persib}–${score.opponent}`
    }
    case 'kickoffConfirmed':
      return value ? 'Yes' : 'No'
    default:
      return String(value)
  }
}

function diff(field: string, from: unknown, to: unknown): FieldChange {
  return {
    field,
    label: FIELD_LABELS[field] ?? field,
    from: formatFieldValue(field, from),
    to: formatFieldValue(field, to),
  }
}

/* ------------------------------- fixture matching ------------------------------- */

interface MatchOutcome {
  fixture: RawFixture | null
  ambiguous: boolean
}

function oppositeVenue(row: SourceMatch): VenueType {
  return isPersib(row.homeTeam) ? 'home' : 'away'
}

function matchFixture(fixtures: RawFixture[], row: SourceMatch, opponent: string): MatchOutcome {
  const sameCompetition = fixtures.filter((f) => f.competition === row.competition)
  const sameOpponent = sameCompetition.filter((f) => sameTeam(f.opponent, opponent))

  if (sameOpponent.length === 0) return { fixture: null, ambiguous: false }
  if (sameOpponent.length === 1) return { fixture: sameOpponent[0], ambiguous: false }

  const venue = oppositeVenue(row)
  let pool = sameOpponent.filter((f) => f.venueType === venue)
  if (pool.length === 0) pool = sameOpponent
  if (pool.length === 1) return { fixture: pool[0], ambiguous: false }

  if (row.week !== null) {
    const byWeek = pool.filter((f) => fixtureWeek(f) === row.week)
    if (byWeek.length === 1) return { fixture: byWeek[0], ambiguous: false }
  }

  if (row.date) {
    const near = pool.filter((f) => f.date && daysBetween(f.date, row.date as string) <= 10)
    if (near.length === 1) return { fixture: near[0], ambiguous: false }
    const undated = pool.filter((f) => !f.date)
    if (near.length === 0 && undated.length === 1) return { fixture: undated[0], ambiguous: false }
  }

  return { fixture: null, ambiguous: true }
}

/** Match an announced opponent onto a fixture that only has TBD/TBA details. */
function matchPlaceholder(
  fixtures: RawFixture[],
  row: SourceMatch,
  used: Set<string>,
): MatchOutcome {
  const candidates = fixtures.filter(
    (f) => f.competition === row.competition && isPlaceholderTeam(f.opponent) && !used.has(f.id),
  )
  if (candidates.length === 0) return { fixture: null, ambiguous: false }
  if (candidates.length === 1 && !row.date) return { fixture: candidates[0], ambiguous: false }

  if (row.date) {
    const near = candidates.filter((f) => !f.date || daysBetween(f.date, row.date as string) <= 14)
    if (near.length === 1) return { fixture: near[0], ambiguous: false }
    if (near.length > 1) return { fixture: null, ambiguous: true }
  }

  if (row.week !== null) {
    const byWeek = candidates.filter((f) => fixtureWeek(f) === row.week)
    if (byWeek.length === 1) return { fixture: byWeek[0], ambiguous: false }
  }

  return { fixture: candidates.length === 1 ? candidates[0] : null, ambiguous: candidates.length > 1 }
}

/* --------------------------------- field diffs --------------------------------- */

interface FieldResult {
  set: Record<string, unknown>
  /** Fields to delete from the stored fixture (e.g. a superseded date window). */
  clear: string[]
  warnings: string[]
  /** Present when the row must be skipped entirely. */
  skip?: string
}

function scheduleFields(
  fixture: RawFixture,
  row: SourceMatch,
  opponent: string,
  venue: VenueType,
): FieldResult {
  const set: Record<string, unknown> = {}
  const clear: string[] = []
  const warnings: string[] = []

  if (isPlaceholderTeam(fixture.opponent) && !isPlaceholderTeam(opponent)) {
    set.opponent = opponent
  } else if (!sameTeam(fixture.opponent, opponent)) {
    warnings.push(`Opponent differs from the database ("${fixture.opponent}" vs "${opponent}"); left unchanged`)
  }

  if (fixture.venueType === 'tba') set.venueType = venue
  else if (fixture.venueType !== 'neutral' && fixture.venueType !== venue) {
    set.venueType = venue
    warnings.push('Official source lists Persib on the other side (home/away reversed)')
  }

  if (row.date) {
    if (row.date !== fixture.date) {
      set.date = row.date
      if (fixture.status === 'finished') {
        warnings.push('Match is already marked finished; the date change should be reviewed')
      } else {
        warnings.push('Kickoff date moved')
      }
    }
    // A concrete date from an official source supersedes an approximate window.
    if (fixture.dateWindow) clear.push('dateWindow')
  }

  if (row.kickoff) {
    if (fixture.kickoff !== row.kickoff) {
      set.kickoff = row.kickoff
      if (fixture.kickoffConfirmed) warnings.push('Previously confirmed kickoff time changed by the official source')
    }
    if (fixture.kickoffConfirmed !== true) set.kickoffConfirmed = true
  }

  if (row.stadium && (!fixture.stadium || !sameVenue(fixture.stadium, row.stadium))) {
    set.stadium = cleanText(row.stadium)
  }

  if (row.week !== null && !/pekan/i.test(fixture.round) && /^putaran\s+\d+/i.test(fixture.round)) {
    set.round = `${fixture.round} · Pekan ${row.week}`
  }

  if (row.status === 'postponed' && fixture.status !== 'postponed') {
    set.status = 'postponed'
    warnings.push('Source reports the match as postponed')
  } else if (row.status === 'cancelled' && fixture.status !== 'cancelled') {
    set.status = 'cancelled'
    warnings.push('Source reports the match as cancelled')
  } else if (
    row.status === 'scheduled' &&
    (fixture.status === 'tba' || fixture.status === 'tentative' || fixture.status === 'postponed') &&
    row.date
  ) {
    set.status = 'scheduled'
  }

  return { set, clear, warnings }
}

function scoreFields(
  fixture: RawFixture,
  row: SourceMatch,
  distance: number | null,
): FieldResult {
  const set: Record<string, unknown> = {}
  const clear: string[] = []
  const warnings: string[] = []
  const persibScore = isPersib(row.homeTeam) ? row.homeScore : row.awayScore
  const opponentScore = isPersib(row.homeTeam) ? row.awayScore : row.homeScore

  if (row.status !== 'finished') return { set, clear, warnings, skip: `Source status is "${row.status}", not a final result` }
  if (persibScore === null || opponentScore === null) return { set, clear, warnings, skip: 'Source does not publish a complete score' }
  if (fixture.status === 'cancelled') return { set, clear, warnings, skip: 'Fixture is marked cancelled in the database' }
  if (distance !== null && distance > 10) return { set, clear, warnings, skip: `Result is ${distance} days away from the stored date` }
  if (fixture.status === 'postponed' && distance !== null && distance > 3) {
    return { set, clear, warnings, skip: 'Fixture is postponed and the result date does not line up' }
  }
  if (distance !== null && distance > 3) warnings.push(`Result published ${distance} days from the stored date`)

  const sameScore =
    fixture.score && fixture.score.persib === persibScore && fixture.score.opponent === opponentScore
  if (sameScore && fixture.status === 'finished') return { set, clear, warnings }

  if (fixture.score && !sameScore) {
    warnings.push(
      `Score correction: stored ${fixture.score.persib}–${fixture.score.opponent}, source ${persibScore}–${opponentScore}`,
    )
  }

  set.score = { persib: persibScore, opponent: opponentScore }
  set.status = 'finished'
  return { set, clear, warnings }
}

/* --------------------------------- planning --------------------------------- */

export interface PlanResult {
  changes: ProposedChange[]
  skipped: SkippedMatch[]
  checked: number
  unchanged: number
}

const CREATE_PREFIX: Record<string, string> = { SL: 'sl', ACC: 'acc', ILC: 'ilc', ACL2: 'acl', PI: 'pi', FR: 'fr' }

function nextFixtureId(fixtures: RawFixture[], competition: CompetitionId): string {
  const prefix = CREATE_PREFIX[competition] ?? competition.toLowerCase()
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  const max = fixtures.reduce((acc, fixture) => {
    const match = fixture.id.match(pattern)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(2, '0')}`
}

const SOURCE_KEYS: Record<string, string> = {
  SL: 'ileague',
  ILC: 'ileague',
  ACC: 'acc',
  ACL2: 'afc',
  PI: 'persib',
  FR: 'persib',
}

function sourceKeyFor(competition: CompetitionId): string {
  return SOURCE_KEYS[competition] ?? 'ileague'
}

/** Build the schedule diff for every matched fixture. */
export function buildPlan(
  kind: SyncKind,
  fixtures: RawFixture[],
  matches: SourceMatch[],
): PlanResult {
  const verifiedAt = wibDate()
  const changes: ProposedChange[] = []
  const skipped: SkippedMatch[] = []
  const touched = new Set<string>()
  let checked = 0
  let unchanged = 0

  const ordered = [...matches].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  const working = [...fixtures]

  for (const row of ordered) {
    const opponent = isPersib(row.homeTeam) ? row.awayTeam : row.homeTeam
    const venue = oppositeVenue(row)
    checked++

    let outcome = matchFixture(working, row, opponent)
    if (!outcome.fixture && !outcome.ambiguous) {
      outcome = matchPlaceholder(working, row, touched)
    }

    if (outcome.ambiguous) {
      skipped.push({
        match: `${row.homeTeam} vs ${row.awayTeam}`,
        competition: row.competition,
        date: row.date,
        reason: 'More than one stored fixture could match this source row',
      })
      continue
    }

    if (!outcome.fixture) {
      if (kind === 'schedule' && row.date && row.status !== 'unknown') {
        const id = nextFixtureId(working, row.competition)
        const created: RawFixture = {
          id,
          competition: row.competition,
          round: row.week !== null ? `Pekan ${row.week}` : 'Fixture',
          date: row.date,
          kickoff: row.kickoff,
          kickoffConfirmed: !!row.kickoff,
          opponent,
          venueType: venue,
          stadium: row.stadium ? cleanText(row.stadium) : null,
          status: 'scheduled',
          sourceKey: sourceKeyFor(row.competition),
          verifiedAt,
          sourceMatchId: row.sourceMatchId,
        }
        const set = { ...created } as Record<string, unknown>
        delete set.id
        changes.push({
          fixtureId: id,
          kind: 'create',
          competition: row.competition,
          round: created.round,
          opponent,
          home: venue === 'away' ? opponent : 'Persib Bandung',
          away: venue === 'away' ? 'Persib Bandung' : opponent,
          status: created.status,
          source: { name: row.source, url: row.sourceUrl },
          sourceMatchId: row.sourceMatchId,
          week: row.week,
          verifiedAt,
          changes: Object.entries(set).map(([field, value]) => diff(field, null, value)),
          warnings: ['New fixture discovered from an official source'],
          set,
        })
        working.push(created)
        touched.add(id)
        continue
      }
      skipped.push({
        match: `${row.homeTeam} vs ${row.awayTeam}`,
        competition: row.competition,
        date: row.date,
        reason: 'No stored fixture matches this source row',
      })
      continue
    }

    const fixture = outcome.fixture
    if (touched.has(fixture.id)) {
      skipped.push({
        match: `${row.homeTeam} vs ${row.awayTeam}`,
        competition: row.competition,
        date: row.date,
        reason: 'Another source row already proposes a change for this fixture',
      })
      continue
    }

    const distance = row.date && fixture.date ? daysBetween(row.date, fixture.date) : null
    const result =
      kind === 'schedule'
        ? scheduleFields(fixture, row, opponent, venue)
        : scoreFields(fixture, row, distance)

    if (result.skip) {
      skipped.push({
        match: `${row.homeTeam} vs ${row.awayTeam}`,
        competition: row.competition,
        date: row.date,
        reason: result.skip,
      })
      continue
    }

    const fields = result.set
    const clear = result.clear
    if (Object.keys(fields).length === 0 && clear.length === 0) {
      unchanged++
      continue
    }

    fields.verifiedAt = verifiedAt
    const fieldChanges = Object.entries(fields)
      .filter(([field]) => field !== 'verifiedAt')
      .map(([field, value]) => diff(field, (fixture as unknown as Record<string, unknown>)[field], value))
    for (const field of clear) {
      fieldChanges.push(diff(field, (fixture as unknown as Record<string, unknown>)[field], null))
    }

    changes.push({
      fixtureId: fixture.id,
      kind: 'update',
      competition: fixture.competition,
      round: String(fields.round ?? fixture.round),
      opponent: String(fields.opponent ?? fixture.opponent),
      home: venue === 'away' ? String(fields.opponent ?? fixture.opponent) : 'Persib Bandung',
      away: venue === 'away' ? 'Persib Bandung' : String(fields.opponent ?? fixture.opponent),
      status: (fields.status as MatchStatus) ?? fixture.status,
      source: { name: row.source, url: row.sourceUrl },
      sourceMatchId: row.sourceMatchId,
      week: row.week,
      verifiedAt,
      changes: fieldChanges,
      warnings: result.warnings,
      set: fields,
      clear: clear.length > 0 ? clear : undefined,
    })
    touched.add(fixture.id)
  }

  return { changes, skipped, checked, unchanged }
}

/* -------------------------------- applying --------------------------------- */

const WRITABLE_FIELDS = new Set([
  'competition',
  'round',
  'date',
  'dateWindow',
  'kickoff',
  'kickoffConfirmed',
  'opponent',
  'venueType',
  'stadium',
  'city',
  'status',
  'score',
  'notes',
  'sourceKey',
  'verifiedAt',
  'sourceMatchId',
])

export interface MergeResult {
  dataset: Dataset
  applied: number
  skipped: Array<{ fixtureId: string; reason: string }>
}

/**
 * Apply approved changes onto the newest dataset. Deterministic and safe to run
 * twice: unchanged values produce no diff, so no second commit is created.
 */
export function mergePending(dataset: Dataset, pending: PendingPayload): MergeResult {
  const next = cloneDataset(dataset)
  const skipped: MergeResult['skipped'] = []
  let applied = 0

  for (const change of pending.changes) {
    const index = next.fixtures.findIndex((fixture) => fixture.id === change.fixtureId)

    if (change.kind === 'create') {
      if (index >= 0) {
        skipped.push({ fixtureId: change.fixtureId, reason: 'Fixture already exists' })
        continue
      }
      const record: Record<string, unknown> = { id: change.fixtureId }
      for (const [field, value] of Object.entries(change.set)) {
        if (!WRITABLE_FIELDS.has(field)) continue
        record[field] = value
      }
      next.fixtures.push(record as unknown as RawFixture)
      applied++
      continue
    }

    if (index < 0) {
      skipped.push({ fixtureId: change.fixtureId, reason: 'Fixture no longer exists' })
      continue
    }

    const target = next.fixtures[index] as unknown as Record<string, unknown>
    let changed = false
    for (const [field, value] of Object.entries(change.set)) {
      if (!WRITABLE_FIELDS.has(field)) continue
      if (JSON.stringify(target[field]) === JSON.stringify(value)) continue
      target[field] = value
      changed = true
    }
    for (const field of change.clear ?? []) {
      if (!WRITABLE_FIELDS.has(field)) continue
      if (!(field in target)) continue
      delete target[field]
      changed = true
    }
    if (changed) applied++
    else skipped.push({ fixtureId: change.fixtureId, reason: 'Values already applied' })
  }

  return { dataset: next, applied, skipped }
}

/** True when every approved value is either already stored or still proposed by the source. */
export function pendingIsStillValid(
  dataset: Dataset,
  pending: PendingPayload,
  freshChanges: ProposedChange[],
): { valid: boolean; stale: Array<{ fixtureId: string; field: string }> } {
  const stale: Array<{ fixtureId: string; field: string }> = []
  for (const change of pending.changes) {
    const stored = dataset.fixtures.find((fixture) => fixture.id === change.fixtureId)
    const fresh = freshChanges.find(
      (candidate) => candidate.fixtureId === change.fixtureId && candidate.kind === change.kind,
    )
    for (const [field, value] of Object.entries(change.set)) {
      const current = stored ? (stored as unknown as Record<string, unknown>)[field] : undefined
      if (JSON.stringify(current) === JSON.stringify(value)) continue
      const proposed = fresh ? (fresh.set as Record<string, unknown>)[field] : undefined
      if (fresh && JSON.stringify(proposed) === JSON.stringify(value)) continue
      stale.push({ fixtureId: change.fixtureId, field })
    }
    for (const field of change.clear ?? []) {
      const current = stored ? (stored as unknown as Record<string, unknown>)[field] : undefined
      if (current === undefined) continue
      if (fresh?.clear?.includes(field)) continue
      stale.push({ fixtureId: change.fixtureId, field })
    }
  }
  return { valid: stale.length === 0, stale }
}

export function toProposed(change: ProposedChange): {
  fixtureId: string
  kind: ChangeKind
  set: Record<string, unknown>
  clear?: string[]
  verifiedAt: string
  source: { name: string; url: string }
  sourceMatchId: string | null
  week: number | null
  competition: CompetitionId
  label: string
} {
  return {
    fixtureId: change.fixtureId,
    kind: change.kind,
    set: change.set,
    clear: change.clear,
    verifiedAt: change.verifiedAt,
    source: change.source,
    sourceMatchId: change.sourceMatchId,
    week: change.week,
    competition: change.competition,
    label: `${change.home} vs ${change.away}`,
  }
}

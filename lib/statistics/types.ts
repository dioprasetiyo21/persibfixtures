import type { CompetitionId } from '@/lib/types'

/** Which official competition website a statistics adapter reads from. */
export type StatisticsSourceId = 'ileague' | 'acc' | 'afc'

/**
 * Lifecycle of a statistics lookup.
 *
 * `not_checked` and `pending` only exist on the client while a request is in
 * flight; the API always answers with one of the three terminal states.
 */
export type StatisticsState = 'not_checked' | 'pending' | 'found' | 'unavailable' | 'error'

export type StatGroupId = 'general' | 'attack' | 'defence' | 'discipline'

/**
 * A single numeric value as published by the source. `null` means the source
 * did not publish a value — it is never coerced to zero.
 */
export type StatValue = number | null

export interface StatRow {
  /** Canonical key shared across every source. */
  key: string
  /** Indonesian display label. */
  label: string
  group: StatGroupId
  /** True when the value is a percentage (0–100). */
  percent: boolean
  home: StatValue
  away: StatValue
}

export interface StatisticsGroup {
  id: StatGroupId
  label: string
  rows: StatRow[]
}

export interface StatisticsTeam {
  name: string
  score: number | null
}

export interface StatisticsSourceRef {
  id: StatisticsSourceId
  name: string
  /** Official statistics page for this match. */
  url: string
}

/** Normalised payload returned by `GET /api/matches/[id]/statistics`. */
export interface MatchStatistics {
  fixtureId: string
  state: Exclude<StatisticsState, 'not_checked' | 'pending'>
  competition: CompetitionId
  date: string | null
  /** Home/away are always oriented the same way the fixture detail modal is. */
  home: StatisticsTeam
  away: StatisticsTeam
  groups: StatisticsGroup[]
  source: StatisticsSourceRef | null
  fetchedAt: string
  /** Human readable explanation for `unavailable` / `error`. */
  message?: string
}

/* --------------------------- adapter-facing contract --------------------------- */

/** One stat exactly as a source published it, before normalisation. */
export interface SourceStatRow {
  label: string
  home: number | null
  away: number | null
}

/** What a source adapter returns before the orchestrator orients/normalises it. */
export interface SourceStatistics {
  state: 'found' | 'unavailable' | 'error'
  sourceId: StatisticsSourceId
  sourceName: string
  /** Official statistics page (may be the origin when no match page was resolved). */
  url: string
  homeTeam: string | null
  awayTeam: string | null
  homeScore: number | null
  awayScore: number | null
  stats: SourceStatRow[]
  message?: string
}

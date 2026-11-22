import type { HighlightPreview, PendingHighlights } from '@/lib/highlights/types'
import type {
  CompetitionId,
  MatchStatus,
  RawFixture,
  SeasonMeta,
  Source,
  VenueType,
} from '@/lib/types'

/** Which synchronisation flow produced a preview. */
export type SyncKind = 'schedule' | 'scores'

/** A fixture row normalised from an official competition source. */
export interface SourceMatch {
  /** Human readable source name shown in the preview. */
  source: string
  sourceUrl: string
  competition: CompetitionId
  /** Competition week / matchday, when the source exposes one. */
  week: number | null
  /** YYYY-MM-DD in WIB. */
  date: string | null
  /** HH:MM 24h in WIB. */
  kickoff: string | null
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' | 'unknown'
  stadium: string | null
  /** Stable identifier from the source (URL slug, match id, …). */
  sourceMatchId: string | null
}

export interface SourceReport {
  name: string
  url: string
  ok: boolean
  /** Rows parsed for Persib from this source. */
  found: number
  /** Total rows parsed (all clubs). */
  total: number
  weeks: number[]
  unavailableWeeks: number[]
  durationMs: number
  error?: string
  note?: string
}

export type ChangeKind = 'update' | 'create'

export interface FieldChange {
  field: string
  label: string
  from: string | null
  to: string | null
}

/** One proposed fixture change, safe to display and to sign into a token. */
export interface ProposedChange {
  fixtureId: string
  kind: ChangeKind
  competition: CompetitionId
  round: string
  opponent: string
  home: string
  away: string
  status: MatchStatus
  source: Source
  sourceMatchId: string | null
  week: number | null
  verifiedAt: string
  changes: FieldChange[]
  warnings: string[]
  /**
   * Fields that will be written. Values are validated JSON primitives/objects.
   * `null` means "explicitly set this field to null".
   */
  set: Record<string, unknown>
  /** Optional fields to remove entirely (e.g. a date window superseded by a real date). */
  clear?: string[]
}

export interface SkippedMatch {
  match: string
  competition: CompetitionId
  date: string | null
  reason: string
}

export interface PreviewSummary {
  checked: number
  changed: number
  created: number
  unchanged: number
  skipped: number
}

export interface SyncPreview {
  ok: true
  kind: SyncKind
  token: string
  expiresAt: string
  generatedAt: string
  base: {
    source: 'github' | 'raw' | 'local'
    sha: string | null
    fixtureCount: number
    branch: string
    path: string
  }
  summary: PreviewSummary
  changes: ProposedChange[]
  reports: SourceReport[]
  skipped: SkippedMatch[]
  warnings: string[]
  /** Present for schedule previews; candidates are never published without confirmation. */
  highlights?: HighlightPreview
}

export interface SyncConfirmResult {
  ok: true
  committed: boolean
  message: string
  applied: number
  commit: { sha: string; url: string; message: string } | null
  fileSha: string | null
  branch: string
  path: string
  /** Number of approved highlight operations that changed data/highlights.json. */
  highlightsApplied?: number
  /** Per-file outcome, including partial failures. */
  files?: Array<{
    path: string
    committed: boolean
    sha: string | null
    action: 'changed' | 'unchanged' | 'failed'
  }>
  /** Non-secret messages describing partial writes or skipped operations. */
  warnings?: string[]
}

/** Payload embedded in the signed confirmation token. */
export interface PendingPayload {
  v: 1
  kind: SyncKind
  exp: number
  iat: number
  baseSha: string | null
  changes: Array<{
    fixtureId: string
    kind: ChangeKind
    set: Record<string, unknown>
    clear?: string[]
    verifiedAt: string
    source: Source
    sourceMatchId: string | null
    week: number | null
    competition: CompetitionId
    label: string
  }>
  /** Optional highlight data signed into a schedule preview. Old tokens omit this. */
  highlights?: PendingHighlights
}

export interface Dataset {
  meta: SeasonMeta
  sources: Record<string, Source>
  fixtures: RawFixture[]
}

export type SyncErrorCode =
  | 'unauthorized'
  | 'rate_limited'
  | 'config'
  | 'source_unavailable'
  | 'invalid_token'
  | 'expired_token'
  | 'stale_preview'
  | 'github_conflict'
  | 'github_error'
  | 'invalid_dataset'
  | 'invalid_selection'
  | 'no_changes'
  | 'internal'

export interface SyncErrorBody {
  ok: false
  code: SyncErrorCode
  error: string
  detail?: unknown
  authRequired?: boolean
  retryAfter?: number
}

export type Venue = VenueType

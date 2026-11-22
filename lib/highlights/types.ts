import type { CompetitionId } from '@/lib/types'

/** Where a stored highlight came from. Manual entries are never overwritten by auto search. */
export type HighlightSource = 'manual' | 'youtube'

/** Only published entries are exposed to visitors; rejected entries are search cooldowns. */
export type HighlightStatus = 'published' | 'rejected'

export interface StoredHighlight {
  fixtureId: string
  videoId?: string
  url?: string
  title?: string
  channel?: string
  channelId?: string
  thumbnailUrl?: string
  publishedAt?: string
  source: HighlightSource
  status: HighlightStatus
  updatedAt: string
  /** Search fingerprint used to avoid repeating the same query without a reason. */
  queryHash?: string
  /** ISO date until which automatic search should skip this fixture. */
  nextSearchAfter?: string
  /** Short, non-sensitive reason for a rejection or skip. */
  reason?: string
}

export interface HighlightSearchState {
  /** ISO date until which YouTube search calls are paused after quota exhaustion. */
  quotaExhaustedUntil?: string
  lastSearchAt?: string
}

export interface HighlightStore {
  _comment?: string
  highlights: Record<string, StoredHighlight>
  searchState?: HighlightSearchState
}

/** Safe subset sent to the browser. The embed URL is generated on the server. */
export interface PublicHighlight {
  fixtureId: string
  /** Always 'published'; kept on the wire so clients cannot infer publish state. */
  status: 'published'
  videoId: string
  url: string
  embedUrl: string
  title: string
  channel: string
  thumbnailUrl?: string
  publishedAt?: string
  source: HighlightSource
}

export interface HighlightCandidate {
  /** Stable preview id, `${fixtureId}:${videoId}`. */
  id: string
  fixtureId: string
  videoId: string
  url: string
  title: string
  channel: string
  channelId?: string
  thumbnailUrl?: string
  publishedAt: string
  durationSeconds: number
  /** Search fingerprint used to avoid repeating the same query without a reason. */
  queryHash: string
  /** Multi-signal relevance score; higher is better. */
  score: number
  /** Human-readable reasons why this video was shortlisted. */
  reasons: string[]
}

export interface HighlightManualTarget {
  fixtureId: string
  label: string
  competition: CompetitionId
  date: string | null
}

export interface HighlightSkipped {
  fixtureId: string
  label: string
  reason: string
}

export interface HighlightSearchInfo {
  enabled: boolean
  checked: number
  searched: number
  skipped: number
  quotaExhaustedUntil?: string
  error?: string
}

export interface HighlightPreview {
  candidates: HighlightCandidate[]
  manualTargets: HighlightManualTarget[]
  skipped: HighlightSkipped[]
  warnings: string[]
  search: HighlightSearchInfo
  /** True when cooldown/quota state changed and must be persisted on confirm. */
  searchStateChanged: boolean
}

export interface HighlightSelectionResult {
  operations: HighlightOperation[]
  warnings: string[]
}

/** Browser selection for one preview. It is validated against the signed token on confirm. */
export interface HighlightSelection {
  approvedCandidateIds: string[]
  rejectedFixtureIds: string[]
  manualUrls: Record<string, string>
}

/** Server-built operations embedded in the signed confirmation token. */
export interface HighlightOperation {
  fixtureId: string
  action: 'publish-auto' | 'publish-manual' | 'reject'
  source: HighlightSource
  videoId?: string
  url?: string
  title?: string
  channel?: string
  channelId?: string
  thumbnailUrl?: string
  publishedAt?: string
  queryHash?: string
  reason?: string
}

export interface PendingHighlights {
  baseSource: 'github' | 'raw' | 'local' | 'bundled'
  baseSha: string | null
  candidates: HighlightCandidate[]
  manualTargets: HighlightManualTarget[]
  operations: HighlightOperation[]
  /** Search cooldown/quota state captured at preview time and persisted on confirm. */
  searchState?: HighlightSearchState
}

export interface HighlightMergeResult {
  store: HighlightStore
  applied: number
  skipped: Array<{ fixtureId: string; reason: string }>
}

/** Server-side configuration for fixture synchronisation. */

export const TZ = 'Asia/Jakarta'

function str(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export interface GithubConfig {
  owner: string
  repo: string
  branch: string
  path: string
  apiBase: string
  token: string | null
}

export function githubConfig(): GithubConfig {
  return {
    owner: str(process.env.GITHUB_OWNER, 'dioprasetiyo21'),
    repo: str(process.env.GITHUB_REPO, 'persibfixtures'),
    branch: str(process.env.GITHUB_BRANCH, 'main'),
    path: str(process.env.FIXTURES_FILE_PATH, 'data/fixtures.json').replace(/^\/+/, ''),
    apiBase: str(process.env.GITHUB_API_BASE, 'https://api.github.com').replace(/\/+$/, ''),
    token: process.env.GITHUB_TOKEN?.trim() || null,
  }
}

export function rawFixturesUrl(cfg: GithubConfig = githubConfig()): string {
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${cfg.path}`
}

export interface IleagueCompetitionConfig {
  competition: 'SL' | 'ILC'
  slug: string
  url: string
  label: string
}

function ileagueUrl(slug: string, week?: number): string {
  const base = `https://ileague.id/fixtures/index/${slug}`
  return week === undefined ? base : `${base}/${week}`
}

export function ileagueCompetitions(): IleagueCompetitionConfig[] {
  const sl = str(process.env.ILEAGUE_SUPER_LEAGUE_SLUG, 'BRI_SUPER_LEAGUE_2026-27')
  const ilc = str(process.env.ILEAGUE_CUP_SLUG, 'I.LEAGUE_CUP_2026-2027')
  return [
    { competition: 'SL', slug: sl, url: ileagueUrl(sl), label: 'BRI Super League' },
    { competition: 'ILC', slug: ilc, url: ileagueUrl(ilc), label: 'I.League Cup' },
  ]
}

export const ILEAGUE_WEEK_START = int(process.env.ILEAGUE_WEEK_START, 1)
export const ILEAGUE_WEEK_END = process.env.ILEAGUE_WEEK_END
  ? int(process.env.ILEAGUE_WEEK_END, 0)
  : null
/** Safety cap so a broken week picker can never trigger thousands of requests. */
export const ILEAGUE_MAX_WEEKS = int(process.env.ILEAGUE_MAX_WEEKS, 60)
export const ILEAGUE_CONCURRENCY = int(process.env.ILEAGUE_CONCURRENCY, 6)

export const ACC_MATCHES_URL = str(
  process.env.ACC_MATCHES_URL,
  'https://aseanutdfc.com/id/asean-club-championship/matches',
)
export const AFC_FIXTURES_URL = str(
  process.env.AFC_FIXTURES_URL,
  'https://www.the-afc.com/api/live/fixtures',
)
export const AFC_COMPETITION_CODES = str(
  process.env.AFC_COMPETITION_CODES,
  'afc-champions-league-two',
)

export const FETCH_TIMEOUT_MS = int(process.env.SYNC_FETCH_TIMEOUT_MS, 15_000)

/** Pending confirmation tokens live for 10 minutes by default. */
export const PENDING_TTL_SECONDS = Math.min(int(process.env.SYNC_PENDING_TTL_SECONDS, 600), 1_800)

/** Optional shared secret. When set, every refresh/confirm call must present it. */
export const ADMIN_TOKEN = process.env.SYNC_ADMIN_TOKEN?.trim() || null

export const RATE_LIMITS = {
  preview: { limit: int(process.env.SYNC_PREVIEW_RATE_LIMIT, 8), windowMs: 10 * 60_000 },
  confirm: { limit: int(process.env.SYNC_CONFIRM_RATE_LIMIT, 10), windowMs: 10 * 60_000 },
}

export const RECHECK_ON_CONFIRM = process.env.SYNC_RECHECK_ON_CONFIRM !== 'false'

export function missingWriteConfig(): string[] {
  const cfg = githubConfig()
  const missing: string[] = []
  if (!cfg.token) missing.push('GITHUB_TOKEN')
  if (!cfg.owner) missing.push('GITHUB_OWNER')
  if (!cfg.repo) missing.push('GITHUB_REPO')
  return missing
}

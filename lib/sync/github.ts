import localDataset from '@/data/fixtures.json'
import { githubConfig, rawFileUrl, rawFixturesUrl, type GithubConfig } from './config'
import { DatasetError, validateDataset } from './dataset'
import type { Dataset } from './types'

export type ReadSource = 'github' | 'raw' | 'local'

export interface ReadResult {
  dataset: Dataset
  sha: string | null
  source: ReadSource
}

export class GithubError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: unknown

  constructor(message: string, code: string, status = 502, detail?: unknown) {
    super(message)
    this.name = 'GithubError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

export class ShaConflictError extends GithubError {
  constructor(message = 'GitHub reported a concurrent update (SHA conflict)') {
    super(message, 'github_conflict', 409)
    this.name = 'ShaConflictError'
  }
}

function headers(cfg: GithubConfig): Record<string, string> {
  const out: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'PersibFixturesSync/1.0',
  }
  if (cfg.token) out.Authorization = `Bearer ${cfg.token}`
  return out
}

function contentsUrl(cfg: GithubConfig, path = cfg.path): string {
  return `${cfg.apiBase}/repos/${cfg.owner}/${cfg.repo}/contents/${path.replace(/^\/+/, '')}`
}

function decodeBase64(value: string): string {
  return Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8')
}

async function githubFetch(
  url: string,
  cfg: GithubConfig,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...headers(cfg), ...(init.headers as Record<string, string> | undefined) },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new GithubError(
      `Could not reach GitHub: ${error instanceof Error ? error.message : 'network error'}`,
      'github_error',
      502,
    )
  }

  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = res.headers.get('x-ratelimit-reset')
    throw new GithubError(
      `GitHub rate limit reached${reset ? ` (resets at ${new Date(Number(reset) * 1000).toISOString()})` : ''}`,
      'github_error',
      429,
    )
  }

  return { status: res.status, body }
}

/** Read data/fixtures.json from GitHub (Contents API) or the public raw file. */
export async function readDataset(options: { fresh?: boolean } = {}): Promise<ReadResult> {
  const cfg = githubConfig()
  const revalidate = options.fresh ? 0 : 30

  if (cfg.token) {
    const { status, body } = await githubFetch(`${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, cfg, {
      method: 'GET',
    })
    if (status === 401) throw new GithubError('GitHub rejected GITHUB_TOKEN', 'config', 401)
    if (status === 403) throw new GithubError('GITHUB_TOKEN is not allowed to read this repository', 'config', 403)
    if (status === 404) {
      throw new GithubError(`Repository or file not found: ${cfg.owner}/${cfg.repo}/${cfg.path}`, 'config', 404)
    }
    if (status !== 200) throw new GithubError(`GitHub responded ${status}`, 'github_error', 502, body)
    const file = body as { content?: string; encoding?: string; sha?: string }
    if (!file?.content || !file.sha) throw new GithubError('GitHub returned an unexpected file payload', 'github_error')
    let dataset: Dataset
    try {
      dataset = validateDataset(JSON.parse(decodeBase64(file.content)))
    } catch (error) {
      if (error instanceof DatasetError) throw error
      throw new DatasetError('data/fixtures.json on GitHub is not valid JSON')
    }
    return { dataset, sha: file.sha, source: 'github' }
  }

  // No token: public repositories can still be read from raw.githubusercontent.com.
  try {
    const res = await fetch(rawFixturesUrl(cfg), {
      headers: { Accept: 'application/json', 'User-Agent': 'PersibFixturesSync/1.0' },
      ...(revalidate === 0 ? { cache: 'no-store' as const } : { next: { revalidate, tags: ['fixtures'] } }),
    })
    if (!res.ok) throw new Error(`raw.githubusercontent.com responded ${res.status}`)
    return { dataset: validateDataset(await res.json()), sha: null, source: 'raw' }
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw new GithubError(
        `Could not read fixtures from GitHub: ${error instanceof Error ? error.message : 'unknown error'}`,
        'github_error',
        502,
      )
    }
    return { dataset: validateDataset(localDataset), sha: null, source: 'local' }
  }
}

export interface JsonFileResult<T> {
  value: T
  sha: string | null
  source: 'github' | 'raw' | 'local'
  /** Non-secret, user-facing note when a fallback copy was used. */
  warning?: string
}

/**
 * Generic read for secondary JSON files such as data/highlights.json. It reuses
 * the existing GitHub credential and Contents API path handling, but degrades
 * safely to a supplied fallback instead of failing the whole page.
 */
export async function readJsonFile<T>(args: {
  cfg: GithubConfig
  validate: (raw: unknown) => T
  fallback: T
  fresh?: boolean
}): Promise<JsonFileResult<T>> {
  const { cfg, validate, fallback } = args
  const revalidate = args.fresh ? 0 : 30
  const fallbackFor = (warning: string): JsonFileResult<T> => ({
    value: fallback,
    sha: null,
    source: 'local',
    warning,
  })

  if (cfg.token) {
    const { status, body } = await githubFetch(`${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, cfg, {
      method: 'GET',
    })
    if (status === 401) throw new GithubError('GitHub rejected GITHUB_TOKEN', 'config', 401)
    if (status === 403) throw new GithubError('GITHUB_TOKEN is not allowed to read this repository', 'config', 403)
    if (status === 404) return fallbackFor(`${cfg.path} does not exist on GitHub yet; using an empty copy`)
    if (status !== 200) throw new GithubError(`GitHub responded ${status}`, 'github_error', 502, body)

    const file = body as { content?: string; sha?: string }
    if (!file?.content || !file.sha) {
      return fallbackFor(`GitHub returned an unexpected payload for ${cfg.path}`)
    }
    try {
      return { value: validate(JSON.parse(decodeBase64(file.content))), sha: file.sha, source: 'github' }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid JSON'
      return fallbackFor(`${cfg.path} is invalid (${reason}); using an empty copy`)
    }
  }

  try {
    const res = await fetch(rawFileUrl(cfg, cfg.path), {
      headers: { Accept: 'application/json', 'User-Agent': 'PersibFixturesSync/1.0' },
      ...(revalidate === 0 ? { cache: 'no-store' as const } : { next: { revalidate, tags: ['fixtures'] } }),
    })
    if (!res.ok) throw new Error(`raw.githubusercontent.com responded ${res.status}`)
    return { value: validate(await res.json()), sha: null, source: 'raw' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    return fallbackFor(`Could not read ${cfg.path} (${reason}); using an empty copy`)
  }
}

export interface WriteResult {
  commit: { sha: string; url: string; message: string }
  fileSha: string
}

/**
 * Write one JSON file back to GitHub with the existing Contents API flow.
 * Requires GITHUB_TOKEN; secondary files pass their own config/path.
 */
export async function writeJsonFile(args: {
  content: string
  sha: string | null
  message: string
  cfg?: GithubConfig
  path?: string
}): Promise<WriteResult> {
  const cfg = args.cfg ?? githubConfig()
  const path = args.path ?? cfg.path
  if (!cfg.token) {
    throw new GithubError(
      'GITHUB_TOKEN is not configured, so changes cannot be committed',
      'config',
      501,
    )
  }

  const body: Record<string, unknown> = {
    message: args.message,
    content: Buffer.from(args.content, 'utf8').toString('base64'),
    branch: cfg.branch,
  }
  if (args.sha) body.sha = args.sha

  const { status, body: response } = await githubFetch(contentsUrl(cfg, path), cfg, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (status === 409 || status === 422) {
    const message = typeof response === 'object' && response && 'message' in response
      ? String((response as { message?: unknown }).message)
      : ''
    if (/sha/i.test(message) || status === 409) throw new ShaConflictError(message || undefined)
    throw new GithubError(`GitHub rejected the update: ${message || 'validation error'}`, 'github_error', 422, response)
  }
  if (status === 401 || status === 403) {
    throw new GithubError('GITHUB_TOKEN cannot write to this repository (Contents: Read and write required)', 'config', 403)
  }
  if (status !== 200 && status !== 201) {
    throw new GithubError(`GitHub responded ${status}`, 'github_error', 502, response)
  }

  const result = response as {
    commit?: { sha?: string; html_url?: string; message?: string }
    content?: { sha?: string }
  }
  if (!result?.commit?.sha) {
    throw new GithubError('GitHub did not confirm the commit', 'github_error', 502, response)
  }

  return {
    commit: {
      sha: result.commit.sha,
      url: result.commit.html_url ?? `https://github.com/${cfg.owner}/${cfg.repo}/commit/${result.commit.sha}`,
      message: result.commit.message ?? args.message,
    },
    fileSha: result.content?.sha ?? '',
  }
}

/** Backwards-compatible wrapper for the primary fixtures dataset. */
export async function writeDataset(args: {
  content: string
  sha: string | null
  message: string
}): Promise<WriteResult> {
  return writeJsonFile(args)
}

export function commitMessageFor(kind: 'schedule' | 'scores' | 'highlights', count: number): string {
  if (kind === 'highlights') {
    const suffix = count > 0 ? ` (${count} highlight${count === 1 ? '' : 's'})` : ''
    return `Update Persib match highlights${suffix}`
  }
  const suffix = count > 0 ? ` (${count} fixture${count === 1 ? '' : 's'})` : ''
  return kind === 'schedule'
    ? `Update Persib fixtures schedule${suffix}`
    : `Update Persib match scores${suffix}`
}

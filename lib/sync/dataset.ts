import type { CompetitionId, MatchStatus, RawFixture, VenueType } from '@/lib/types'
import type { Dataset } from './types'

const COMPETITIONS = new Set<CompetitionId>(['SL', 'ACL2', 'ACC', 'ILC', 'PI', 'FR'])
const STATUSES = new Set<MatchStatus>(['finished', 'scheduled', 'tentative', 'tba', 'postponed', 'cancelled'])
const VENUES = new Set<VenueType>(['home', 'away', 'neutral', 'tba'])

export class DatasetError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message)
    this.name = 'DatasetError'
  }
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/**
 * Structural validation of data/fixtures.json. Rejects anything that would
 * break the frontend before it can be written to GitHub.
 */
export function validateDataset(input: unknown): Dataset {
  const issues: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DatasetError('Fixture dataset must be an object', ['root is not an object'])
  }
  const dataset = input as Dataset
  const meta = dataset.meta
  if (!meta || typeof meta !== 'object') issues.push('meta is missing')
  else {
    if (typeof meta.club !== 'string') issues.push('meta.club must be a string')
    if (typeof meta.season !== 'string') issues.push('meta.season must be a string')
    if (typeof meta.seasonStart !== 'string') issues.push('meta.seasonStart must be a string')
    if (typeof meta.seasonEnd !== 'string') issues.push('meta.seasonEnd must be a string')
    if (typeof meta.timezone !== 'string') issues.push('meta.timezone must be a string')
    if (typeof meta.lastUpdated !== 'string') issues.push('meta.lastUpdated must be a string')
  }

  if (!dataset.sources || typeof dataset.sources !== 'object' || Array.isArray(dataset.sources)) {
    issues.push('sources must be an object')
  }

  if (!Array.isArray(dataset.fixtures)) {
    issues.push('fixtures must be an array')
    throw new DatasetError('Invalid fixture dataset', issues)
  }

  const ids = new Set<string>()
  dataset.fixtures.forEach((fixture, index) => {
    const where = `fixtures[${index}]`
    if (!fixture || typeof fixture !== 'object') {
      issues.push(`${where} is not an object`)
      return
    }
    const f = fixture as RawFixture
    if (typeof f.id !== 'string' || f.id.length === 0) issues.push(`${where}.id must be a non-empty string`)
    else if (ids.has(f.id)) issues.push(`${where}.id "${f.id}" is duplicated`)
    else ids.add(f.id)

    if (!COMPETITIONS.has(f.competition)) issues.push(`${where}.competition is invalid`)
    if (typeof f.round !== 'string') issues.push(`${where}.round must be a string`)
    if (typeof f.opponent !== 'string' || f.opponent.length === 0) issues.push(`${where}.opponent must be a non-empty string`)
    if (f.date !== null && !isDate(f.date)) issues.push(`${where}.date must be YYYY-MM-DD or null`)
    if (f.kickoff !== null && f.kickoff !== undefined && !/^\d{2}:\d{2}$/.test(String(f.kickoff))) {
      issues.push(`${where}.kickoff must be HH:MM or null`)
    }
    if (typeof f.kickoffConfirmed !== 'boolean') issues.push(`${where}.kickoffConfirmed must be a boolean`)
    if (!VENUES.has(f.venueType)) issues.push(`${where}.venueType is invalid`)
    if (f.stadium !== null && f.stadium !== undefined && typeof f.stadium !== 'string') issues.push(`${where}.stadium must be a string or null`)
    if (f.city !== undefined && f.city !== null && typeof f.city !== 'string') issues.push(`${where}.city must be a string or null`)
    if (!STATUSES.has(f.status)) issues.push(`${where}.status is invalid`)
    if (f.score !== undefined && f.score !== null) {
      if (typeof f.score !== 'object') issues.push(`${where}.score must be an object`)
      else {
        const { persib, opponent } = f.score
        if (!Number.isInteger(persib) || persib < 0) issues.push(`${where}.score.persib must be a non-negative integer`)
        if (!Number.isInteger(opponent) || opponent < 0) issues.push(`${where}.score.opponent must be a non-negative integer`)
      }
    }
    if (f.dateWindow !== undefined && typeof f.dateWindow !== 'string') issues.push(`${where}.dateWindow must be a string`)
    if (f.notes !== undefined && typeof f.notes !== 'string') issues.push(`${where}.notes must be a string`)
    if (typeof f.sourceKey !== 'string' || f.sourceKey.length === 0) issues.push(`${where}.sourceKey must be a non-empty string`)
    if (typeof f.verifiedAt !== 'string' || !isDateTime(f.verifiedAt)) issues.push(`${where}.verifiedAt must be an ISO date`)
    if (f.sourceMatchId !== undefined && f.sourceMatchId !== null && typeof f.sourceMatchId !== 'string') {
      issues.push(`${where}.sourceMatchId must be a string or null`)
    }
  })

  if (issues.length > 0) {
    throw new DatasetError(`Fixture dataset is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'})`, issues.slice(0, 12))
  }
  return dataset
}

/**
 * Serialise in the same shape the repository already uses: one fixture per
 * line, two-space meta, one-line source entries. Keeps GitHub diffs readable.
 */
export function serializeDataset(dataset: Dataset): string {
  const metaJson = JSON.stringify(dataset.meta, null, 2).split('\n').join('\n  ')
  const sourceEntries = Object.entries(dataset.sources)
  const lines: string[] = ['{', `  "meta": ${metaJson},`, '  "sources": {']
  sourceEntries.forEach(([key, value], index) => {
    lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)}${index < sourceEntries.length - 1 ? ',' : ''}`)
  })
  lines.push('  },', '  "fixtures": [')
  dataset.fixtures.forEach((fixture, index) => {
    lines.push(`    ${JSON.stringify(fixture)}${index < dataset.fixtures.length - 1 ? ',' : ''}`)
  })
  lines.push('  ]', '}')
  return `${lines.join('\n')}\n`
}

export function cloneDataset(dataset: Dataset): Dataset {
  return JSON.parse(JSON.stringify(dataset)) as Dataset
}

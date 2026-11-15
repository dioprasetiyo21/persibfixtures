import type { CompetitionId, RawFixture } from '@/lib/types'
import { ileagueCompetitions } from '../config'
import type { SourceMatch, SourceReport, SyncKind } from '../types'
import { scrapeAcc } from './acc'
import { scrapeAfc } from './afc'
import { scrapeIleague } from './ileague'

export interface CollectOptions {
  /** Recheck on confirm: bypass HTTP caches. */
  fresh?: boolean
  /** Restrict I.League weeks per competition (used when verifying a preview). */
  weeksByCompetition?: Partial<Record<CompetitionId, number[]>>
}

export interface SourceCollection {
  matches: SourceMatch[]
  reports: SourceReport[]
}

function dedupe(matches: SourceMatch[]): SourceMatch[] {
  const byKey = new Map<string, SourceMatch>()
  for (const match of matches) {
    const key =
      match.sourceMatchId ??
      `${match.competition}:${match.date ?? 'tba'}:${match.homeTeam}:${match.awayTeam}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, match)
      continue
    }
    // A finished row carries more information than a scheduled duplicate.
    if (existing.status !== 'finished' && match.status === 'finished') byKey.set(key, match)
  }
  return [...byKey.values()]
}

/**
 * Run every adapter that can contribute to the requested sync kind.
 * Independent failures are reported and never abort the whole refresh.
 */
export async function collectSourceMatches(
  kind: SyncKind,
  fixtures: RawFixture[],
  options: CollectOptions = {},
): Promise<SourceCollection> {
  const competitions = new Set<CompetitionId>(fixtures.map((f) => f.competition))
  const reports: SourceReport[] = []
  const all: SourceMatch[] = []

  const tasks: Array<Promise<void>> = []

  for (const cfg of ileagueCompetitions()) {
    if (!competitions.has(cfg.competition)) continue
    tasks.push(
      scrapeIleague(cfg, {
        fresh: options.fresh,
        weeks: options.weeksByCompetition?.[cfg.competition],
      }).then(({ matches, report }) => {
        all.push(...matches)
        reports.push(report)
      }),
    )
  }

  if (competitions.has('ACC')) {
    tasks.push(
      scrapeAcc({ fresh: options.fresh }).then(({ matches, report }) => {
        all.push(...matches)
        reports.push(report)
      }),
    )
  }

  if (competitions.has('ACL2')) {
    if (kind === 'scores') {
      tasks.push(
        scrapeAfc({ fresh: options.fresh }).then(({ matches, report }) => {
          all.push(...matches)
          reports.push(report)
        }),
      )
    } else {
      reports.push({
        name: 'AFC Champions League Two (the-afc.com)',
        url: 'https://www.the-afc.com/en/club/afc_champions_league_two.html',
        ok: true,
        found: 0,
        total: 0,
        weeks: [],
        unavailableWeeks: [],
        durationMs: 0,
        note: 'The AFC feed only publishes live and finished matches; ACL Two schedules cannot be verified from it.',
      })
    }
  }

  await Promise.all(tasks)

  return { matches: dedupe(all), reports: reports.sort((a, b) => a.name.localeCompare(b.name)) }
}

import type { CompetitionId } from '@/lib/types'
import type { StatisticsSourceId } from './types'

export interface StatisticsSourceConfig {
  id: StatisticsSourceId
  name: string
  competitions: CompetitionId[]
}

/** Competition → official statistics website. */
export const STATISTICS_SOURCES: readonly StatisticsSourceConfig[] = [
  { id: 'ileague', name: 'I.League', competitions: ['SL', 'ILC'] },
  { id: 'acc', name: 'ASEAN United FC', competitions: ['ACC'] },
  { id: 'afc', name: 'AFC', competitions: ['ACL2'] },
]

export function statisticsSourceFor(competition: CompetitionId): StatisticsSourceConfig | null {
  return STATISTICS_SOURCES.find((source) => source.competitions.includes(competition)) ?? null
}

/** True when an official statistics source exists for this competition. */
export function supportsStatistics(competition: CompetitionId): boolean {
  return statisticsSourceFor(competition) !== null
}

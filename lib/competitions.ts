import type { CompetitionId } from './types'

export interface Competition {
  id: CompetitionId
  name: string
  short: string
  color: string
  text: string
}

export const COMPETITIONS: Competition[] = [
  { id: 'SL', name: 'Super League', short: 'SL', color: '#3478D4', text: '#FFFFFF' },
  { id: 'ACL2', name: 'AFC Champions League Two', short: 'ACL2', color: '#7652B8', text: '#FFFFFF' },
  { id: 'ACC', name: 'ASEAN Club Championship', short: 'ACC', color: '#F58220', text: '#2E1600' },
  { id: 'ILC', name: 'I-League Cup', short: 'ILC', color: '#E5383B', text: '#FFFFFF' },
  { id: 'PI', name: 'Piala Indonesia', short: 'PI', color: '#2AA8B5', text: '#03262B' },
  { id: 'FR', name: 'Friendlies', short: 'FR', color: '#858C98', text: '#FFFFFF' },
]

export const COMPETITION_MAP = Object.fromEntries(
  COMPETITIONS.map((c) => [c.id, c]),
) as Record<CompetitionId, Competition>

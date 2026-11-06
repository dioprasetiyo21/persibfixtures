export type CompetitionId = 'SL' | 'ACL2' | 'ACC' | 'ILC' | 'PI' | 'FR'

export type MatchStatus =
  | 'finished'
  | 'scheduled'
  | 'tentative'
  | 'tba'
  | 'postponed'
  | 'cancelled'

export type VenueType = 'home' | 'away' | 'neutral' | 'tba'

export interface Source {
  name: string
  url: string
}

export interface RawFixture {
  id: string
  competition: CompetitionId
  round: string
  date: string | null
  dateWindow?: string
  kickoff: string | null
  kickoffConfirmed: boolean
  opponent: string
  venueType: VenueType
  stadium: string | null
  city?: string
  status: MatchStatus
  score?: { persib: number; opponent: number }
  notes?: string
  sourceKey: string
  verifiedAt: string
}

export interface Fixture extends Omit<RawFixture, 'sourceKey'> {
  source: Source
}

export interface SeasonMeta {
  club: string
  season: string
  seasonStart: string
  seasonEnd: string
  lastUpdated: string
  timezone: string
  notes: string
}

export interface FixturesPayload {
  meta: SeasonMeta
  fixtures: Fixture[]
}

export type ViewMode = 'season' | 'month' | 'upcoming' | 'completed'

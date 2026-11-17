import { sameTeam } from '@/lib/sync/teams'

export type Orientation = 'aligned' | 'reversed' | 'unknown'

/**
 * Decide whether a source lists the two teams in the same order as the fixture.
 *
 * Both sides must match — the opponent name alone is never enough, so a match
 * against a club whose short name is ambiguous cannot be silently mis-oriented.
 */
export function orient(
  sourceHome: string | null,
  sourceAway: string | null,
  expectedHome: string,
  expectedAway: string,
): Orientation {
  if (!sourceHome || !sourceAway) return 'unknown'
  if (sameTeam(sourceHome, expectedHome) && sameTeam(sourceAway, expectedAway)) return 'aligned'
  if (sameTeam(sourceHome, expectedAway) && sameTeam(sourceAway, expectedHome)) return 'reversed'
  return 'unknown'
}

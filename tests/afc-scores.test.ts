import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RawFixture } from '../lib/types'

const http = require('../lib/sync/http') as typeof import('../lib/sync/http')

function afcMatch(overrides: Record<string, unknown> = {}) {
  return {
    matchId: '3cvg2650t0nq73tzy8azsct1w',
    ffeedId: '2683750',
    season: 20262027,
    status: 'played',
    dateVenue: '2026-11-25',
    timeVenueUTC: '12:15:00',
    homeTeam: { name: 'Persib Bandung', officialName: 'Persib Bandung' },
    awayTeam: { name: 'Seoul', officialName: 'FC Seoul' },
    result: { homeGoals: 3, awayGoals: 1, winner: 'home' },
    originCompetitionId: 'afc-champions-league-two',
    liveMinute: { minute: 'FT', currentPeriod: 'FT' },
    ...overrides,
  }
}

const payload = {
  data: [
    afcMatch(),
    afcMatch({
      ffeedId: '2683751',
      status: 'scheduled',
      dateVenue: '2026-12-02',
      homeTeam: { name: 'The Cong – Viettel' },
      awayTeam: { name: 'Persib Bandung' },
      // A scheduled placeholder still carries 0-0 in the live feed.
      result: { homeGoals: 0, awayGoals: 0, winner: null },
      liveMinute: null,
    }),
    afcMatch({
      ffeedId: '2683752',
      status: 'inplay',
      dateVenue: '2026-12-02',
      homeTeam: { name: 'The Cong – Viettel' },
      awayTeam: { name: 'Persib Bandung' },
      result: { homeGoals: 1, awayGoals: 0 },
      liveMinute: { minute: "54'", currentPeriod: '2' },
    }),
    afcMatch({
      ffeedId: '9999999',
      homeTeam: { name: 'Ulsan HD' },
      awayTeam: { name: 'Vissel Kobe' },
      result: { homeGoals: 2, awayGoals: 2 },
    }),
    afcMatch({
      ffeedId: '2652471',
      dateVenue: '2026-08-31',
      homeTeam: { name: 'Persib Bandung' },
      awayTeam: { name: 'Manila Digger' },
      result: { homeGoals: 1, awayGoals: 0 },
      stage: { name: 'PRELIMINARY STAGE' },
    }),
  ],
}

let lastFetchUrl = ''
http.fetchText = (async (url: string) => {
  lastFetchUrl = url
  return JSON.stringify(payload)
}) as never

const afc = require('../lib/sync/sources/afc') as typeof import('../lib/sync/sources/afc')
const plan = require('../lib/sync/plan') as typeof import('../lib/sync/plan')

test('scrapeAfc requests a season-bearing feed and parses real AFC result fields', async () => {
  const { matches, report } = await afc.scrapeAfc({ fresh: true })

  assert.match(lastFetchUrl, /season=latest/)
  assert.equal(lastFetchUrl.includes('source=OPTA'), false)
  assert.equal(lastFetchUrl.includes('live=true'), false)
  assert.equal(report.ok, true)
  assert.equal(report.total, 5)
  assert.equal(report.found, 2)
  assert.equal(
    matches.some((match) => match.awayTeam === 'Manila Digger'),
    false,
    'preliminary results must not fill the Round-of-16 placeholder',
  )

  const finished = matches.find((match) => match.sourceMatchId === '2026-11-25:2683750')
  assert.ok(finished, 'finished Persib match is present')
  assert.equal(finished.status, 'finished')
  assert.equal(finished.date, '2026-11-25')
  assert.equal(finished.homeTeam, 'Persib Bandung')
  assert.equal(finished.awayTeam, 'Seoul')
  assert.equal(finished.homeScore, 3)
  assert.equal(finished.awayScore, 1)

  const live = matches.find((match) => match.status === 'live')
  assert.ok(live, 'live match is visible without being final')
  assert.equal(live.homeScore, 1)
  assert.equal(live.awayScore, 0)

  assert.equal(
    matches.some((match) => match.status === 'scheduled'),
    false,
    'scheduled 0-0 placeholders are not treated as results',
  )
})

function fixture(overrides: Partial<RawFixture> & Pick<RawFixture, 'id' | 'opponent'>): RawFixture {
  return {
    competition: 'ACL2',
    round: 'Group E',
    date: '2026-11-25',
    kickoff: null,
    kickoffConfirmed: false,
    venueType: 'home',
    stadium: null,
    status: 'scheduled',
    sourceKey: 'afc',
    verifiedAt: '2026-11-07',
    ...overrides,
  }
}

const fixtures: RawFixture[] = [
  fixture({
    id: 'acl-01',
    opponent: 'FC Seoul',
    venueType: 'away',
    date: '2026-09-16',
    status: 'finished',
    score: { persib: 1, opponent: 0 },
  }),
  fixture({ id: 'acl-05', opponent: 'FC Seoul', date: '2026-11-25' }),
  fixture({ id: 'acl-06', opponent: 'The Cong-Viettel', date: '2026-12-02', venueType: 'away' }),
]

test('ACL2 score preview updates only the correct fixture and keeps live scores out of commits', async () => {
  const { matches } = await afc.scrapeAfc({ fresh: true })
  const { changes, skipped } = plan.buildPlan('scores', fixtures, matches)

  assert.equal(changes.length, 1)
  const change = changes[0]
  assert.equal(change.fixtureId, 'acl-05')
  assert.deepEqual(change.set.score, { persib: 3, opponent: 1 })
  assert.equal(change.set.status, 'finished')
  assert.equal(change.warnings.length, 0)
  assert.equal(
    skipped.some((item) => /not a final result/i.test(item.reason)),
    true,
  )
})

test('re-running the same ACL2 result does not produce a false update', async () => {
  const { matches } = await afc.scrapeAfc({ fresh: true })
  const first = plan.buildPlan('scores', fixtures, matches)
  assert.equal(first.changes.length, 1)

  const updated = fixtures.map((item) => {
    if (item.id !== 'acl-05') return item
    return {
      ...item,
      status: 'finished' as const,
      score: first.changes[0].set.score as { persib: number; opponent: number },
    }
  })
  const second = plan.buildPlan('scores', updated, matches)
  assert.equal(second.changes.length, 0)
  assert.ok(second.unchanged >= 1)
  assert.equal(
    second.skipped.some((item) => /Score correction/i.test(item.reason)),
    false,
  )
})

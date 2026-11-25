import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RawFixture } from '../lib/types'
import type { SourceGoal } from '../lib/sync/types'

const http = require('../lib/sync/http') as typeof import('../lib/sync/http')
const afc = require('../lib/sync/sources/afc') as typeof import('../lib/sync/sources/afc')
const notes = require('../lib/sync/notes') as typeof import('../lib/sync/notes')
const plan = require('../lib/sync/plan') as typeof import('../lib/sync/plan')

const PERSIB_ID = '4hz9pkq1g1xwg6m8769runh4l'
const SEOUL_ID = '4dhojk80ifrs6ax05725bala2'
const VICTORY_ID = '9xmhnv6im8h7c9e17oqvcx8gl'

const feedGoals = [
  { playerName: 'Mariano Peralta', timeMinSecAdvanced: "6'", teamId: PERSIB_ID, ownGoal: false, penaltyGoal: false },
  { playerName: 'Leonardo Ruiz', timeMinSecAdvanced: "37'", teamId: SEOUL_ID, ownGoal: false, penaltyGoal: false },
  { playerName: 'Luka Menalo', timeMinSecAdvanced: "41'", teamId: PERSIB_ID, ownGoal: false, penaltyGoal: false },
  { playerName: 'Beckham Putra', timeMinSecAdvanced: "78'", teamId: PERSIB_ID, ownGoal: false, penaltyGoal: false },
]

const feed = {
  data: [
    {
      matchId: '3cvg2650t0nq73tzy8azsct1w',
      ffeedId: '2683750',
      status: 'played',
      dateVenue: '2026-11-25',
      homeTeam: { name: 'Persib Bandung', id: PERSIB_ID },
      awayTeam: { name: 'Seoul', id: SEOUL_ID },
      result: { homeGoals: 3, awayGoals: 1, goals: feedGoals },
    },
    {
      matchId: '3bqc7a6wepjq4tonqdjl7ojys',
      ffeedId: '2683747',
      status: 'played',
      dateVenue: '2026-11-04',
      homeTeam: { name: 'Melbourne Victory', id: VICTORY_ID },
      awayTeam: { name: 'Persib Bandung', id: PERSIB_ID },
      // Malformed enrichment must never break the score update.
      result: { homeGoals: 1, awayGoals: 2, goals: { unexpected: true } },
    },
    {
      matchId: '3cvg2650t0nq73tzy8azsct1z',
      ffeedId: '2683748',
      status: 'played',
      dateVenue: '2026-11-06',
      homeTeam: { name: 'Persib Bandung', id: PERSIB_ID },
      awayTeam: { name: 'Melbourne Victory', id: VICTORY_ID },
      result: {
        homeGoals: 2,
        awayGoals: 1,
        goals: [
          { playerName: 'Júlio César (OG)', timeMinSecAdvanced: "71'", teamId: VICTORY_ID, ownGoal: true, penaltyGoal: false },
        ],
      },
    },
  ],
}

const nuxt = [
  null,
  '2683750',
  'Group E: Persib Bandung (IDN) 3-1 FC Seoul (KOR)',
  '<div class="font-m">Bandung: Persib Bandung sealed top spot in Group E of the 2026/27 AFC Champions League Two.</div>',
  { id: 9, matchId: 1, name: 2, teaserText: 2, fullText: 3 },
]
const articlePage = `<html><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(nuxt)}</script></html>`

http.fetchText = (async (url: string) =>
  url.includes('/api/live/fixtures') ? JSON.stringify(feed) : articlePage) as never

function fixture(
  id: string,
  overrides: Partial<RawFixture> & Pick<RawFixture, 'opponent'>,
): RawFixture {
  return {
    id,
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

test('scrapeAfc attaches official goals and a matchId-linked achievement', async () => {
  const { matches } = await afc.scrapeAfc({ fresh: true })
  const seoul = matches.find((match) => match.sourceMatchId === '2026-11-25:2683750')
  const victory = matches.find((match) => match.sourceMatchId === '2026-11-04:2683747')

  assert.ok(seoul)
  assert.equal(seoul.goals?.length, 4)
  assert.equal(seoul.context?.text, 'Secured top spot in Group E.')
  assert.match(seoul.context?.sourceUrl ?? '', /fixtures__standings\.html/)

  assert.ok(victory)
  assert.equal(victory.goals, undefined)
  assert.equal(victory.context, undefined)

  const ownGoal = matches.find((match) => match.sourceMatchId === '2026-11-06:2683748')
  assert.ok(ownGoal)
  assert.equal(ownGoal.goals?.[0].playerName, 'Júlio César')
  assert.equal(ownGoal.goals?.[0].ownGoal, true)
})

test('buildGoalsNote keeps minutes, team tags, braces, penalties and own goals', async () => {
  const { matches } = await afc.scrapeAfc({ fresh: true })
  const seoul = matches.find((match) => match.sourceMatchId === '2026-11-25:2683750')
  assert.ok(seoul?.goals)

  assert.equal(
    notes.buildGoalsNote({
      goals: seoul.goals,
      homeTeam: seoul.homeTeam,
      awayTeam: seoul.awayTeam,
      homeTeamId: seoul.homeTeamId,
      awayTeamId: seoul.awayTeamId,
    }),
    "Goals: Mariano Peralta 6', Leonardo Ruiz 37' (Seoul), Luka Menalo 41', Beckham Putra 78'.",
  )

  const brace: SourceGoal[] = [
    { playerName: 'Mariano Peralta', minute: "45'", teamId: PERSIB_ID, ownGoal: false, penaltyGoal: true },
    { playerName: 'Balsa Sekulic', minute: "47'", teamId: PERSIB_ID, ownGoal: false, penaltyGoal: false },
    { playerName: 'Balsa Sekulic', minute: "67'", teamId: PERSIB_ID, ownGoal: false, penaltyGoal: false },
    { playerName: 'Júlio César', minute: "71'", teamId: VICTORY_ID, ownGoal: true, penaltyGoal: false },
  ]
  assert.equal(
    notes.buildGoalsNote({
      goals: brace,
      homeTeam: 'Melbourne Victory',
      awayTeam: 'Persib Bandung',
      homeTeamId: VICTORY_ID,
      awayTeamId: PERSIB_ID,
    }),
    "Goals: Mariano Peralta 45' (pen), Balsa Sekulic (2) 47', 67', Júlio César 71' (OG, Melbourne Victory).",
  )

  const ownGoal = matches.find((match) => match.sourceMatchId === '2026-11-06:2683748')
  assert.ok(ownGoal?.goals)
  assert.equal(
    notes.buildGoalsNote({
      goals: ownGoal.goals,
      homeTeam: ownGoal.homeTeam,
      awayTeam: ownGoal.awayTeam,
      homeTeamId: ownGoal.homeTeamId,
      awayTeamId: ownGoal.awayTeamId,
    }),
    "Goals: Júlio César 71' (OG, Melbourne Victory).",
    'the source "(OG)" marker must not be duplicated',
  )
})

test('mergeNotes upgrades partial notes without dropping old context', () => {
  const previous = 'Goals: Luka Menalo, Balsa Sekulic. Result secured Round of 16 qualification.'
  const fresh = "Goals: Júlio César 71' (OG, Melbourne Victory), Luka Menalo 85', Balsa Sekulic 90'."

  assert.equal(
    notes.mergeNotes(previous, fresh, null, 3),
    "Goals: Júlio César 71' (OG, Melbourne Victory), Luka Menalo 85', Balsa Sekulic 90'. Result secured Round of 16 qualification.",
  )
  assert.equal(notes.mergeNotes('Brace from Balsa Sekulic.', "Goals: Balsa Sekulic (2) 47', 67'.", null, 2), "Goals: Balsa Sekulic (2) 47', 67'.")
  assert.equal(
    notes.mergeNotes('Goals: Marc Klok 10\'.', "Goals: Luka Menalo 85'.", null, 1),
    undefined,
    'a scorer missing from the source must never be dropped',
  )
  assert.equal(
    notes.mergeNotes('Goals: Mariano Peralta, Luka Menalo (2), Marc Klok.', null, null, 0),
    undefined,
    'notes stay untouched when the source publishes no goals',
  )
  assert.equal(
    notes.mergeNotes('Goals: Luka Menalo. Secured top spot in Group E.', "Goals: Luka Menalo 85'.", 'Secured top spot in Group E.', 1),
    "Goals: Luka Menalo 85'. Secured top spot in Group E.",
    'an existing verified achievement is not duplicated',
  )
})

test('a finished fixture gets notes only, and a second refresh is idempotent', async () => {
  const { matches } = await afc.scrapeAfc({ fresh: true })
  const fixtures = [
    fixture('acl-05', {
      opponent: 'FC Seoul',
      status: 'finished',
      score: { persib: 3, opponent: 1 },
    }),
  ]

  const first = plan.buildPlan('scores', fixtures, matches)
  assert.equal(first.changes.length, 1)
  const change = first.changes[0]
  assert.equal(change.fixtureId, 'acl-05')
  assert.equal(change.set.score, undefined)
  assert.equal(change.set.status, undefined)
  assert.equal(
    change.set.notes,
    "Goals: Mariano Peralta 6', Leonardo Ruiz 37' (Seoul), Luka Menalo 41', Beckham Putra 78'. Secured top spot in Group E.",
  )

  const applied = fixtures.map((item) =>
    item.id === 'acl-05' ? { ...item, notes: change.set.notes as string } : item,
  )
  const second = plan.buildPlan('scores', applied, matches)
  assert.equal(second.changes.length, 0)
  assert.ok(second.unchanged >= 1)
})

test('score updates survive broken goals and leave unrelated competitions alone', async () => {
  const { matches } = await afc.scrapeAfc({ fresh: true })
  const fixtures = [
    fixture('acl-04', {
      opponent: 'Melbourne Victory',
      date: '2026-11-04',
      venueType: 'away',
    }),
    {
      ...fixture('sl-01', { opponent: 'PSM Makassar', competition: 'SL', status: 'finished', score: { persib: 3, opponent: 1 } }),
      competition: 'SL' as const,
    },
  ]

  const { changes } = plan.buildPlan('scores', fixtures, matches)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].fixtureId, 'acl-04')
  assert.deepEqual(changes[0].set.score, { persib: 2, opponent: 1 })
  assert.equal(changes[0].set.status, 'finished')
  assert.equal(changes[0].set.notes, undefined)
})

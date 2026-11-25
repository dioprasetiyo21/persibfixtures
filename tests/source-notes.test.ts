import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RawFixture } from '../lib/types'
import type { SourceGoal, SourceMatch } from '../lib/sync/types'

const http = require('../lib/sync/http') as typeof import('../lib/sync/http')
const acc = require('../lib/sync/sources/acc') as typeof import('../lib/sync/sources/acc')
const ileague = require('../lib/sync/sources/ileague') as typeof import('../lib/sync/sources/ileague')
const notes = require('../lib/sync/notes') as typeof import('../lib/sync/notes')
const plan = require('../lib/sync/plan') as typeof import('../lib/sync/plan')

const weekHtml = `<html>
<select><option value="8" selected>Pekan 8</option></select>
<a href="https://ileague.id/result/detail/BRI_SUPER_LEAGUE_2026-27/2026-11-01/PERSIB_BANDUNG/ISENMULANG_KALTENG_FC">
  <b>PERSIB BANDUNG</b><b>ISENMULANG KALTENG FC</b>
  <td><span class="badge">FT 4 : 0</span></td>
  <td width="30%">Si Jalak Harupat</td>
</a>
</html>`

const ileagueDetail = `<html>
<div class="team match-hero-team">
  <span class="match-hero-name">PERSIB BANDUNG</span>
  <ul>
    <li>MARIANO EZEQUIEL PERALTA BAUER <i class="fa fa-futbol-o"></i> 14' </li>
    <li>LUKA MENALO <i class="fas fa-square" style="background-color:yellow"></i> 20'</li>
    <li>LUKA MENALO <i class="fa fa-futbol-o"></i> 36' </li>
    <li>LUKA MENALO <i class="fa fa-futbol-o"></i> 44' </li>
    <li>MARC ANTHONY KLOK <i class="fa fa-futbol-o"></i> 86' </li>
  </ul>
</div>
<div class="team right match-hero-team">
  <img src="logo.png" alt="Club Logo">
  <span class="match-hero-name">ISENMULANG KALTENG FC</span><ul></ul>
</div>
</html>`

function accCard(id: string): string {
  return `<div id="scroll-6" class="mn-dt-part">
<h3>Oct 08 2026</h3>
<div class="first-card-match">
  <div class="flag-nd-name"><h4>Port</h4></div>
  <div class="vs-dtl-main">
    <h3>1</h3>
    <div class="other-details">
      <div class="grp-dtl">Grup B</div>
      <div class="vs-dtl"><h4>Full time</h4><p>Full time</p></div>
      <a href="https://aseanutdfc.com/id/asean-club-championship/match/${id}/details">Detail</a>
    </div>
    <h3>3</h3>
  </div>
  <div class="team-flag-name-nd-score scnd-team"><div class="flag-nd-name"><h4>Persib</h4></div></div>
</div>
</div>`
}

const accDetails: Record<string, string> = {
  consistent: `<html><div class="goal-comm-div-top">
    <div class="first-hlf-goal-comm">
      <div class="plyr-info d-flex"><h4>J. Soonsup-Bell</h4><span>66&#039;</span></div>
    </div>
    <div class="mid-prt-goal-comm"><img src="ball.svg"></div>
    <div class="scnd-hlf-goal-comm">
      <div class="plyr-info d-flex"><h4>M. Peralta</h4><span>87&#039;</span></div>
      <div class="plyr-info d-flex"><h4>Berguinho</h4><span>90&#039;+2&#039;</span></div>
      <div class="plyr-info d-flex"><h4>L. Menalo</h4><span>90&#039;+6&#039;</span></div>
    </div>
  </div><!--goals details ends--></html>`,
  inconsistent: `<html><div class="goal-comm-div-top">
    <div class="first-hlf-goal-comm">
      <div class="plyr-info d-flex"><h4>J. Soonsup-Bell</h4><span>66&#039;</span></div>
    </div>
    <div class="mid-prt-goal-comm"><img src="ball.svg"></div>
    <div class="scnd-hlf-goal-comm">
      <div class="plyr-info d-flex"><h4>M. Peralta</h4><span>87&#039;</span></div>
      <div class="plyr-info d-flex"><h4>Berguinho</h4><span>90&#039;+2&#039;</span></div>
      <div class="plyr-info d-flex"><h4>L. Menalo</h4><span>90&#039;+5&#039;</span></div>
      <div class="plyr-info d-flex"><h4>L. Menalo</h4><span>90&#039;+6&#039;</span></div>
    </div>
  </div><!--goals details ends--></html>`,
}

const accMatches = `${accCard('consistent')}${accCard('inconsistent')}`

const fetchedUrls: string[] = []
http.fetchText = (async (url: string) => {
  fetchedUrls.push(url)
  if (url.includes('/fixtures/index/')) return weekHtml
  if (url.includes('/result/detail/')) return ileagueDetail
  if (url.includes('/asean-club-championship/matches')) return accMatches
  const id = url.match(/\/match\/([A-Za-z0-9]+)\/details/)?.[1]
  return accDetails[id ?? ''] ?? ''
}) as never

test('scrapeIleague reads official scorers without turning cards into goals', async () => {
  const { matches, report } = await ileague.scrapeIleague(
    { competition: 'SL', slug: 'BRI_SUPER_LEAGUE_2026-27', url: 'https://ileague.id/fixtures/index/BRI_SUPER_LEAGUE_2026-27', label: 'BRI Super League' },
    { weeks: [8], fresh: true, kind: 'scores' },
  )

  assert.equal(matches.length, 1)
  assert.equal(report.ok, true)
  assert.equal(matches[0].homeTeam, 'Persib Bandung')
  assert.equal(matches[0].awayTeam, 'Isenmulang Kalteng FC')
  assert.equal(matches[0].goals?.length, 4)
  assert.deepEqual(
    matches[0].goals?.map((goal) => `${goal.playerName} ${goal.minute}`),
    [
      'Mariano Ezequiel Peralta Bauer 14\'',
      'Luka Menalo 36\'',
      'Luka Menalo 44\'',
      'Marc Anthony Klok 86\'',
    ],
  )
  assert.ok(matches[0].goals?.every((goal) => goal.teamId === 'PERSIB BANDUNG'))

  const note = notes.buildGoalsNote({
    goals: matches[0].goals ?? [],
    homeTeam: matches[0].homeTeam,
    awayTeam: matches[0].awayTeam,
    homeTeamId: matches[0].homeTeamId,
    awayTeamId: matches[0].awayTeamId,
  })
  assert.match(note ?? '', /^Goals:/)
  assert.match(note ?? '', /Luka Menalo \(2\) 36', 44'/)
})

test('scrapeAcc attaches scorers only when the detail list reconciles with the score', async () => {
  const { matches, report } = await acc.scrapeAcc({ fresh: true, kind: 'scores' })
  const consistent = matches.find((match) => match.sourceMatchId === 'consistent')
  const inconsistent = matches.find((match) => match.sourceMatchId === 'inconsistent')

  assert.equal(report.ok, true)
  assert.ok(consistent)
  assert.equal(consistent.goals?.length, 4)
  assert.equal(consistent.goals?.[2].playerName, 'Berguinho')
  assert.equal(consistent.goals?.[2].minute, "90+2'")
  assert.equal(consistent.goals?.[3].teamId, 'PERSIB')
  assert.ok(inconsistent)
  assert.equal(inconsistent.goals, undefined)

  assert.equal(
    notes.buildGoalsNote({
      goals: consistent.goals ?? [],
      homeTeam: consistent.homeTeam,
      awayTeam: consistent.awayTeam,
      homeTeamId: consistent.homeTeamId,
      awayTeamId: consistent.awayTeamId,
    }),
    "Goals: J. Soonsup-Bell 66' (Port), M. Peralta 87', Berguinho 90+2', L. Menalo 90+6'.",
  )
})

test('schedule ACC scrape keeps the original report and never fetches scorer details', async () => {
  fetchedUrls.length = 0
  const { matches, report } = await acc.scrapeAcc({ fresh: true, kind: 'schedule' })

  assert.equal(
    report.note,
    'The match list publishes the group but no matchday number, so existing round labels are left unchanged.',
  )
  assert.ok(matches.length > 0)
  assert.ok(matches.every((match) => match.goals === undefined))
  assert.ok(!fetchedUrls.some((url) => url.includes('/details')))
})

test('schedule ILeague scrape skips detail pages and adds no scorer failure note', async () => {
  fetchedUrls.length = 0
  const { matches, report } = await ileague.scrapeIleague(
    { competition: 'SL', slug: 'BRI_SUPER_LEAGUE_2026-27', url: 'https://ileague.id/fixtures/index/BRI_SUPER_LEAGUE_2026-27', label: 'BRI Super League' },
    { weeks: [8], fresh: true, kind: 'schedule' },
  )

  assert.equal(report.note, undefined)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].goals, undefined)
  assert.ok(!fetchedUrls.some((url) => url.includes('/result/detail/')))
})

test('mergeNotes keeps an already complete note and accepts abbreviated source names', () => {
  const complete = "Goals: Mariano Peralta 87', Berguinho 90+2', Luka Menalo 90+6'."
  const abbreviated = "Goals: M. Peralta 87', Berguinho 90+2', L. Menalo 90+6'."
  assert.equal(
    notes.mergeNotes(complete, abbreviated, null, 3, ['M. Peralta', 'Berguinho', 'L. Menalo']),
    undefined,
  )

  const partial = 'Goals: Mariano Peralta, Luka Menalo (2), Marc Klok.'
  const enriched = "Goals: Mariano Ezequiel Peralta Bauer 14', Luka Menalo (2) 36', 44', Marc Anthony Klok 86'."
  assert.equal(
    notes.mergeNotes(partial, enriched, null, 4, [
      'Mariano Ezequiel Peralta Bauer',
      'Luka Menalo',
      'Marc Anthony Klok',
    ]),
    enriched,
  )
})

test('score planning writes enriched notes without changing an already correct score', () => {
  const fixture = {
    id: 'sl-08',
    competition: 'SL' as const,
    round: 'Pekan 8',
    date: '2026-11-01',
    kickoff: null,
    kickoffConfirmed: false,
    opponent: 'Isen Mulang Kalteng FC',
    venueType: 'home' as const,
    stadium: null,
    status: 'finished' as const,
    score: { persib: 4, opponent: 0 },
    notes: 'Goals: Mariano Peralta, Luka Menalo (2), Marc Klok.',
    sourceKey: 'ileague',
    verifiedAt: '2026-11-15',
  }
  const row = {
    source: 'BRI Super League (ileague.id)',
    sourceUrl: 'https://ileague.id/fixtures/index/BRI_SUPER_LEAGUE_2026-27/8',
    competition: 'SL' as const,
    week: 8,
    date: '2026-11-01',
    kickoff: null,
    homeTeam: 'PERSIB BANDUNG',
    awayTeam: 'ISENMULANG KALTENG FC',
    homeTeamId: 'PERSIB BANDUNG',
    awayTeamId: 'ISENMULANG KALTENG FC',
    homeScore: 4,
    awayScore: 0,
    status: 'finished' as const,
    stadium: null,
    sourceMatchId: '/result/detail/BRI_SUPER_LEAGUE_2026-27/2026-11-01/PERSIB_BANDUNG/ISENMULANG_KALTENG_FC',
    goals: [
      { playerName: 'Mariano Ezequiel Peralta Bauer', minute: "14'", teamId: 'PERSIB BANDUNG', ownGoal: false, penaltyGoal: false },
      { playerName: 'Luka Menalo', minute: "36'", teamId: 'PERSIB BANDUNG', ownGoal: false, penaltyGoal: false },
      { playerName: 'Luka Menalo', minute: "44'", teamId: 'PERSIB BANDUNG', ownGoal: false, penaltyGoal: false },
      { playerName: 'Marc Anthony Klok', minute: "86'", teamId: 'PERSIB BANDUNG', ownGoal: false, penaltyGoal: false },
    ],
  }

  const { changes, unchanged } = plan.buildPlan('scores', [fixture], [row])
  assert.equal(unchanged, 0)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].set.score, undefined, 'a correct score must not be rewritten')
  assert.match(String(changes[0].set.notes), /Luka Menalo \(2\) 36', 44'/)
})

const ACC02_NOTE = "Goals: B. Sekulić (2) 12', 66', M. Peralta 17', L. Menalo 52', A. Alis 81', Uilliam Barros 89'."
const ACC02_FULL_NOTE = "Goals: Balša Sekulic (2) 12', 66', Mariano Peralta 17', Luka Menalo 52', Adam Alis 81', Uilliam Barros 89'."
const ACC02_NAMES = ['B. Sekulić', 'M. Peralta', 'L. Menalo', 'A. Alis', 'Uilliam Barros']
const ACC02_FULL_NAMES = ['Balša Sekulic', 'Mariano Peralta', 'Luka Menalo', 'Adam Alis', 'Uilliam Barros']

test('mergeNotes leaves the exact acc-02 note unchanged when the source repeats it', () => {
  assert.equal(notes.mergeNotes(ACC02_NOTE, ACC02_NOTE, null, 6, ACC02_NAMES), undefined)
  assert.equal(notes.mergeNotes(ACC02_NOTE, ACC02_FULL_NOTE, null, 6, ACC02_FULL_NAMES), undefined)
})

test('mergeNotes keeps achievement context when player initials are upgraded', () => {
  const partial = "Goals: B. Sekulić 12', M. Peralta 17'. Secured top spot in Group B."
  const result = notes.mergeNotes(partial, ACC02_NOTE, null, 6, ACC02_NAMES)

  assert.equal(result, `${ACC02_NOTE} Secured top spot in Group B.`)
  assert.equal((result ?? '').split('Secured top spot in Group B.').length - 1, 1)
})

function acc02Fixture(note: string): RawFixture {
  return {
    id: 'acc-02',
    competition: 'ACC',
    round: 'Group B · Matchday 2',
    date: '2026-11-19',
    kickoff: '19:00',
    kickoffConfirmed: true,
    opponent: 'Shan United',
    venueType: 'home',
    stadium: 'Stadion Gelora Bandung Lautan Api',
    status: 'finished',
    score: { persib: 6, opponent: 0 },
    notes: note,
    sourceKey: 'acc',
    verifiedAt: '2026-11-26',
  }
}

const acc02Goals: SourceGoal[] = [
  { playerName: 'B. Sekulić', minute: "12'", teamId: 'PERSIB', ownGoal: false, penaltyGoal: false },
  { playerName: 'B. Sekulić', minute: "66'", teamId: 'PERSIB', ownGoal: false, penaltyGoal: false },
  { playerName: 'M. Peralta', minute: "17'", teamId: 'PERSIB', ownGoal: false, penaltyGoal: false },
  { playerName: 'L. Menalo', minute: "52'", teamId: 'PERSIB', ownGoal: false, penaltyGoal: false },
  { playerName: 'A. Alis', minute: "81'", teamId: 'PERSIB', ownGoal: false, penaltyGoal: false },
  { playerName: 'Uilliam Barros', minute: "89'", teamId: 'PERSIB', ownGoal: false, penaltyGoal: false },
]

const acc02Row: SourceMatch = {
  source: 'ASEAN United FC – Shopee Cup',
  sourceUrl: 'https://aseanutdfc.com/id/asean-club-championship/matches',
  competition: 'ACC',
  week: null,
  date: '2026-11-19',
  kickoff: '19:00',
  homeTeam: 'Persib Bandung',
  awayTeam: 'Shan United',
  homeTeamId: 'PERSIB',
  awayTeamId: 'SHAN UNITED',
  homeScore: 6,
  awayScore: 0,
  status: 'finished',
  stadium: 'Stadion Gelora Bandung Lautan Api',
  sourceMatchId: 'acc02',
  goals: acc02Goals,
}

test('acc-02 refresh is a no-op when the stored note already matches the source', () => {
  const { changes, unchanged } = plan.buildPlan('scores', [acc02Fixture(ACC02_NOTE)], [acc02Row])

  assert.equal(changes.length, 0)
  assert.equal(unchanged, 1)
})

test('acc-02 initials note is upgraded once and the second refresh is idempotent', () => {
  const partial = "Goals: B. Sekulić 12', M. Peralta 17'."
  const first = plan.buildPlan('scores', [acc02Fixture(partial)], [acc02Row])

  assert.equal(first.changes.length, 1)
  assert.equal(first.changes[0].set.score, undefined, 'a correct score must not be rewritten')
  assert.equal(first.changes[0].set.notes, ACC02_NOTE)

  const second = plan.buildPlan('scores', [acc02Fixture(ACC02_NOTE)], [acc02Row])
  assert.equal(second.changes.length, 0, 'a second refresh must not duplicate the scorer list')
  assert.equal(second.unchanged, 1)
})

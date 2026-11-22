import { createHash } from 'node:crypto'
import type { RawFixture } from '@/lib/types'

const COMPETITION_LABEL: Record<string, string> = {
  SL: 'Super League',
  ACL2: 'AFC Champions League Two',
  ACC: 'ASEAN Club Championship',
  ILC: 'I.League Cup',
  PI: 'Persib',
  FR: 'Friendly',
}

const COMPETITION_TERMS: Record<string, string[]> = {
  SL: ['super league', 'ileague', 'i league', 'liga 1'],
  ACL2: ['afc champions league two', 'acl two', 'afc champions league', 'afc'],
  ACC: ['asean club championship', 'shopee cup', 'acc'],
  ILC: ['i league cup', 'ileague cup'],
  PI: ['persib'],
  FR: ['friendly', 'persib'],
}

const OPPONENT_STOP_WORDS = new Set(['the', 'fc', 'fk', 'sc', 'club', 'united'])
const NEGATIVE_TERMS = ['prediksi', 'prediction', 'taruhan', 'betting', 'link', 'live streaming', 'jadwal', 'fixture list']

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildSearchQuery(fixture: RawFixture): string {
  const date = fixture.date ?? ''
  const score = fixture.score ? `${fixture.score.persib} ${fixture.score.opponent}` : ''
  const competition = COMPETITION_LABEL[fixture.competition] ?? fixture.competition
  return `Persib Bandung vs ${fixture.opponent} ${date} ${score} ${competition} highlights`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/** Fingerprint of the inputs that produced a query, used to avoid repeat searches. */
export function searchQueryHash(fixture: RawFixture): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        fixtureId: fixture.id,
        opponent: fixture.opponent,
        date: fixture.date,
        score: fixture.score ?? null,
        competition: fixture.competition,
      }),
    )
    .digest('hex')
    .slice(0, 16)
}

export interface ScoreCandidateInput {
  title: string
  description: string
  channelTitle: string
  publishedAt: string
  durationSeconds: number
}

export interface CandidateScore {
  score: number
  reasons: string[]
}

/** Multi-signal relevance scoring; never trusts the first search result. */
export function scoreCandidate(
  fixture: RawFixture,
  candidate: ScoreCandidateInput,
): CandidateScore {
  const text = normalize(`${candidate.title} ${candidate.description}`)
  const title = normalize(candidate.title)
  const channel = normalize(candidate.channelTitle)
  const reasons: string[] = []
  let score = 0

  const opponentTokens = normalize(fixture.opponent)
    .split(' ')
    .filter((word) => word.length > 2 && !OPPONENT_STOP_WORDS.has(word))
  const opponentMain = opponentTokens.slice().sort((a, b) => b.length - a.length)[0] ?? ''
  const mentionsPersib = /\bpersib\b|\bbandung\b/.test(text)
  const mentionsOpponent = !!opponentMain && text.includes(opponentMain)

  if (mentionsPersib && mentionsOpponent) {
    score += 35
    reasons.push('Both teams mentioned')
  } else if (mentionsPersib || mentionsOpponent) {
    score += 16
    reasons.push(mentionsPersib ? 'Persib mentioned' : 'Opponent mentioned')
  } else {
    score -= 20
    reasons.push('Neither team could be matched')
  }

  const fullOpponent = normalize(fixture.opponent)
  if (fullOpponent.length > 3 && text.includes(fullOpponent)) {
    score += 18
    reasons.push('Full opponent name found')
  }
  const tokenHits = opponentTokens.filter((word) => word.length > 3 && text.includes(word)).length
  if (tokenHits > 0) {
    score += Math.min(12, tokenHits * 4)
    reasons.push(`${tokenHits} opponent keyword${tokenHits === 1 ? '' : 's'} matched`)
  }

  if (fixture.date) {
    if (text.includes(fixture.date)) {
      score += 14
      reasons.push('Exact match date found')
    }
    const date = new Date(`${fixture.date}T12:00:00Z`)
    if (!Number.isNaN(date.getTime())) {
      const long = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      const short = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      const normalizedLong = normalize(long)
      const normalizedShort = normalize(short)
      if (text.includes(normalizedLong) || text.includes(normalizedShort)) {
        score += 10
        reasons.push('Written match date found')
      } else if (text.includes(normalize(date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })))) {
        score += 4
        reasons.push('Match month found')
      }
    }
  }

  if (fixture.score) {
    const { persib, opponent } = fixture.score
    if (text.includes(`${persib} ${opponent}`)) {
      score += 12
      reasons.push('Scoreline found')
    }
  }

  const competitionTerms = COMPETITION_TERMS[fixture.competition] ?? []
  if (competitionTerms.some((term) => text.includes(term))) {
    score += 8
    reasons.push('Competition context matched')
  }

  if (/highlight|full match|pertandingan|gol|goals/.test(text)) {
    score += 10
    reasons.push('Highlight keywords found')
  }
  if (/persib|official|league|afc|asean|klub/i.test(channel)) {
    score += 5
    reasons.push('Channel looks official')
  }
  if (candidate.durationSeconds >= 60 && candidate.durationSeconds <= 45 * 60) {
    score += 5
    reasons.push('Duration looks like a highlight package')
  }

  if (fixture.date) {
    const matchTime = Date.parse(`${fixture.date}T12:00:00Z`)
    const publishedTime = Date.parse(candidate.publishedAt)
    if (Number.isFinite(matchTime) && Number.isFinite(publishedTime)) {
      const days = Math.abs(publishedTime - matchTime) / 86_400_000
      if (days <= 45) {
        score += 6
        reasons.push('Published close to match date')
      } else if (days <= 180) {
        score += 2
      } else if (days > 365) {
        score -= 8
      }
    }
  }

  const negativeHits = NEGATIVE_TERMS.filter((term) => title.includes(term)).length
  if (negativeHits > 0) {
    score -= Math.min(24, negativeHits * 12)
    reasons.push('Title contains prediction/live/link wording')
  }

  return { score: Math.round(score), reasons: reasons.slice(0, 5) }
}

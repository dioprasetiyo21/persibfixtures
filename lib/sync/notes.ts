import { isPersib } from './teams'
import type { SourceGoal } from './types'

/**
 * Formatting and merging for fixture notes. Pure functions only: no network,
 * no dataset mutation, and no claim that is not present in the parsed source.
 */

const NAME_RE = /\b([A-Z][\p{L}]+(?:\s+[A-Z][\p{L}]+)+)/gu
const IGNORED_NAME_WORDS = new Set([
  'AFC',
  'Brace',
  'Goal',
  'Goals',
  'Own',
  'Penalty',
  'Result',
  'Secured',
  'Winner',
])

interface GroupedGoal {
  playerName: string
  tag: string | null
  ownGoal: boolean
  penaltyGoal: boolean
  minutes: string[]
  firstMinute: number
}

export interface GoalsNoteInput {
  goals: SourceGoal[]
  homeTeam: string
  awayTeam: string
  homeTeamId?: string | null
  awayTeamId?: string | null
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function minuteValue(minute: string | null): number {
  if (!minute) return Number.MAX_SAFE_INTEGER
  const match = minute.match(/(\d+)(?:\+(\d+))?/)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number(match[1]) + Number(match[2] ?? 0)
}

export function buildGoalsNote(input: GoalsNoteInput): string | null {
  const groups = new Map<string, GroupedGoal>()

  for (const goal of input.goals) {
    const playerName = goal.playerName?.trim()
    if (!playerName) continue

    const sourceTeam =
      goal.teamId && goal.teamId === input.homeTeamId
        ? input.homeTeam
        : goal.teamId && goal.teamId === input.awayTeamId
          ? input.awayTeam
          : null
    // Only the opponent is labelled. A Persib goal stays unqualified, and an
    // unknown team id is never guessed from the player name.
    const tag = sourceTeam && !isPersib(sourceTeam) ? sourceTeam : null
    const ownGoal = goal.ownGoal === true
    const penaltyGoal = goal.penaltyGoal === true && !ownGoal
    const key = `${playerName}\u0000${tag ?? ''}\u0000${ownGoal}\u0000${penaltyGoal}`
    const minute = goal.minute?.trim() || null
    const existing = groups.get(key)

    if (existing) {
      if (minute) existing.minutes.push(minute)
      continue
    }

    groups.set(key, {
      playerName,
      tag,
      ownGoal,
      penaltyGoal,
      minutes: minute ? [minute] : [],
      firstMinute: minuteValue(minute),
    })
  }

  const entries = [...groups.values()]
    .sort((a, b) => a.firstMinute - b.firstMinute)
    .map((group) => {
      const annotations: string[] = []
      if (group.ownGoal) annotations.push('OG')
      if (group.penaltyGoal) annotations.push('pen')
      if (group.tag) annotations.push(group.tag)
      const count = group.minutes.length > 1 ? ` (${group.minutes.length})` : ''
      const minutes = group.minutes.join(', ')
      return `${group.playerName}${count}${minutes ? ` ${minutes}` : ''}${
        annotations.length > 0 ? ` (${annotations.join(', ')})` : ''
      }`
    })

  return entries.length > 0 ? `Goals: ${entries.join(', ')}.` : null
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function isGoalSentence(sentence: string): boolean {
  return (
    /^goals?\s*:/i.test(sentence) ||
    /^brace\b/i.test(sentence) ||
    /\bscored by\b/i.test(sentence) ||
    /\bpenalty\b/i.test(sentence) ||
    /\bown goal\b/i.test(sentence)
  )
}

function oldNames(sentences: string[]): string[] {
  const names: string[] = []
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(NAME_RE)) {
      const words = match[1].split(/\s+/).filter((word) => !IGNORED_NAME_WORDS.has(word))
      if (words.length >= 2) names.push(words.join(' '))
    }
  }
  return names
}

function minutes(text: string): string[] {
  return [...text.matchAll(/\d{1,3}(?:\+\d{1,2})?'/g)].map((match) => match[0])
}

function oldItemCount(sentences: string[]): number {
  let count = 0
  for (const sentence of sentences) {
    const body = sentence.replace(/^goals?\s*:/i, '')
    const items = body
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /[A-Za-z]/.test(item))
    count = Math.max(count, items.length)
  }
  return count
}

function generatedNames(note: string): string[] {
  return [...note.matchAll(NAME_RE)].map((match) => match[1])
}

function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean)
}

function isSubsequence(needle: string[], haystack: string[]): boolean {
  let cursor = 0
  for (const token of haystack) {
    if (token === needle[cursor]) cursor++
    if (cursor === needle.length) return true
  }
  return false
}

/**
 * Sources alternate between full names ("Mariano Ezequiel Peralta Bauer") and
 * short forms ("M. Peralta"). Only accept a match when every old token appears
 * in order, or when a two-token short form shares the initial and surname.
 */
function samePlayer(oldName: string, newName: string): boolean {
  const oldTokens = tokens(oldName)
  const newTokens = tokens(newName)
  if (oldTokens.length === 0 || newTokens.length === 0) return false
  if (oldTokens.join(' ') === newTokens.join(' ')) return true
  if (oldTokens.length < 2 || newTokens.length < 2) return false
  if (isSubsequence(oldTokens, newTokens)) return true
  return (
    oldTokens.length === 2 &&
    newTokens.length === 2 &&
    oldTokens[0][0] === newTokens[0][0] &&
    oldTokens[1] === newTokens[1]
  )
}

/**
 * Produce the note to write, or `undefined` when nothing should change.
 * Existing achievement sentences are always kept verbatim. A goals segment is
 * replaced only when the new note accounts for every name the old one named.
 * `sourceNames` is the unformatted scorer list from the source; it is preferred
 * over regex-extracted names because sources also publish abbreviated names.
 */
export function mergeNotes(
  existing: string | undefined,
  goalsNote: string | null,
  context: string | null,
  goalCount = 0,
  sourceNames: string[] = [],
): string | undefined {
  if (!goalsNote && !context) return undefined

  const sentences = existing ? splitSentences(existing) : []
  const oldGoals = sentences.filter(isGoalSentence)
  const oldContext = sentences.filter((sentence) => !isGoalSentence(sentence))

  let goals = goalsNote
  if (goalsNote && oldGoals.length > 0) {
    const oldGoalText = oldGoals.join(' ')
    const freshNames = sourceNames.length > 0 ? sourceNames : generatedNames(goalsNote)
    const missingOldName = oldNames(oldGoals).some((name) =>
      !freshNames.some((fresh) => samePlayer(name, fresh)),
    )
    const oldImpliedCount = /brace/i.test(oldGoalText) ? 2 : oldItemCount(oldGoals)

    const oldMinutes = minutes(oldGoalText)
    const freshMinutes = minutes(goalsNote)
    const alreadyHasMinutes =
      freshMinutes.length > 0 && freshMinutes.every((minute) => oldMinutes.includes(minute))

    if (missingOldName || goalCount < oldImpliedCount || alreadyHasMinutes) goals = null
  }

  const finalContext = [...oldContext]
  if (context && !finalContext.some((sentence) => normalize(sentence).includes(normalize(context)))) {
    finalContext.push(context)
  }

  const result = [...(goals ? [goals] : oldGoals), ...finalContext].join(' ')
  if (!result || result === existing) return undefined
  return result
}

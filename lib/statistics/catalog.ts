import { normalizePercent } from './parse'
import type { SourceStatRow, StatGroupId, StatRow, StatisticsGroup } from './types'

export interface StatDefinition {
  key: string
  label: string
  group: StatGroupId
  percent: boolean
}

/**
 * Display order for the statistics modal. Every source is folded into these
 * four groups so I.League, ACC and AFC all render one consistent layout.
 */
export const STAT_GROUPS: ReadonlyArray<{ id: StatGroupId; label: string }> = [
  { id: 'general', label: 'Umum' },
  { id: 'attack', label: 'Serangan' },
  { id: 'defence', label: 'Pertahanan' },
  { id: 'discipline', label: 'Disiplin' },
]

export const STAT_DEFINITIONS: ReadonlyArray<StatDefinition> = [
  { key: 'possession', label: 'Penguasaan Bola', group: 'general', percent: true },
  { key: 'passes_accurate', label: 'Umpan Sukses', group: 'general', percent: false },
  { key: 'passes_inaccurate', label: 'Umpan Gagal', group: 'general', percent: false },
  { key: 'pass_accuracy', label: 'Akurasi Umpan', group: 'general', percent: true },
  { key: 'corners', label: 'Tendangan Sudut', group: 'general', percent: false },
  { key: 'goal_kicks', label: 'Tendangan Gawang', group: 'general', percent: false },
  { key: 'offsides', label: 'Offside', group: 'general', percent: false },
  { key: 'shots_total', label: 'Total Tembakan', group: 'attack', percent: false },
  { key: 'shots_on_target', label: 'Tembakan ke Gawang', group: 'attack', percent: false },
  { key: 'shots_off_target', label: 'Tembakan Melenceng', group: 'attack', percent: false },
  { key: 'shot_accuracy', label: 'Akurasi Tembakan', group: 'attack', percent: true },
  { key: 'blocked_shots', label: 'Tembakan Terblok', group: 'defence', percent: false },
  { key: 'tackles_won', label: 'Tekel Sukses', group: 'defence', percent: false },
  { key: 'duels_won', label: 'Keberhasilan Duel', group: 'defence', percent: true },
  { key: 'aerial_duels_won', label: 'Duel Udara Dimenangkan', group: 'defence', percent: true },
  { key: 'interceptions', label: 'Intersepsi', group: 'defence', percent: false },
  { key: 'saves', label: 'Penyelamatan', group: 'defence', percent: false },
  { key: 'fouls', label: 'Pelanggaran', group: 'discipline', percent: false },
  { key: 'yellow_cards', label: 'Kartu Kuning', group: 'discipline', percent: false },
  { key: 'red_cards', label: 'Kartu Merah', group: 'discipline', percent: false },
]

/** Source label (English or Indonesian) → canonical key. */
const LABEL_ALIASES: Record<string, string> = {
  'penguasaan bola': 'possession',
  possession: 'possession',
  'umpan sukses': 'passes_accurate',
  'accurate passes': 'passes_accurate',
  'umpan gagal': 'passes_inaccurate',
  'inaccurate passes': 'passes_inaccurate',
  'akurasi umpan': 'pass_accuracy',
  'pass accuracy': 'pass_accuracy',
  'tendangan sudut': 'corners',
  corners: 'corners',
  'tendangan gawang': 'goal_kicks',
  'goal kicks': 'goal_kicks',
  offside: 'offsides',
  offsides: 'offsides',
  'total tembakan': 'shots_total',
  'total shots': 'shots_total',
  shots: 'shots_total',
  'tembakan ke gawang': 'shots_on_target',
  'shots on target': 'shots_on_target',
  'tembakan tepat sasaran': 'shots_on_target',
  'tembakan melenceng': 'shots_off_target',
  'shots off target': 'shots_off_target',
  'akurasi tembakan': 'shot_accuracy',
  'shot accuracy': 'shot_accuracy',
  'tembakan terblok': 'blocked_shots',
  'blocked shots': 'blocked_shots',
  'tekel sukses': 'tackles_won',
  'tackles won': 'tackles_won',
  'successful tackles': 'tackles_won',
  'keberhasilan duel': 'duels_won',
  'duels success rate': 'duels_won',
  'duel success rate': 'duels_won',
  'duels won': 'duels_won',
  'successful duels': 'duels_won',
  'duel udara dimenangkan': 'aerial_duels_won',
  'aerial duels won': 'aerial_duels_won',
  'aerial duels success rate': 'aerial_duels_won',
  intersepsi: 'interceptions',
  interceptions: 'interceptions',
  penyelamatan: 'saves',
  saves: 'saves',
  pelanggaran: 'fouls',
  fouls: 'fouls',
  'kartu kuning': 'yellow_cards',
  'yellow cards': 'yellow_cards',
  'kartu merah': 'red_cards',
  'red cards': 'red_cards',
}

const DEFINITION_BY_KEY = new Map(STAT_DEFINITIONS.map((definition) => [definition.key, definition]))
const ORDER_BY_KEY = new Map(STAT_DEFINITIONS.map((definition, index) => [definition.key, index]))

/** Lower-case, punctuation-free form used to look a label up. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[%()]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function statKeyForLabel(label: string): string | null {
  return LABEL_ALIASES[normalizeLabel(label)] ?? null
}

function normalizeValue(value: number | null, percent: boolean): number | null {
  if (value === null) return null
  return percent ? normalizePercent(value) : value
}

/**
 * Map raw source rows onto the canonical catalogue. Unrecognised labels are
 * dropped, duplicate keys are merged, and rows whose value the source did not
 * publish keep `null` (rendered as "—", never as zero).
 *
 * `reversed` swaps the two sides so the result always reads home-then-away.
 */
export function buildGroups(rows: SourceStatRow[], reversed: boolean): StatisticsGroup[] {
  const byKey = new Map<string, StatRow>()

  for (const row of rows) {
    const key = statKeyForLabel(row.label)
    if (!key) continue
    const definition = DEFINITION_BY_KEY.get(key)
    if (!definition) continue

    const home = normalizeValue(reversed ? row.away : row.home, definition.percent)
    const away = normalizeValue(reversed ? row.home : row.away, definition.percent)

    const existing = byKey.get(key)
    if (existing) {
      if (existing.home === null && home !== null) existing.home = home
      if (existing.away === null && away !== null) existing.away = away
      continue
    }

    byKey.set(key, {
      key,
      label: definition.label,
      group: definition.group,
      percent: definition.percent,
      home,
      away,
    })
  }

  const groups: StatisticsGroup[] = []
  for (const group of STAT_GROUPS) {
    const groupRows = [...byKey.values()]
      .filter((row) => row.group === group.id)
      .sort((a, b) => (ORDER_BY_KEY.get(a.key) ?? 0) - (ORDER_BY_KEY.get(b.key) ?? 0))
    if (groupRows.length > 0) groups.push({ id: group.id, label: group.label, rows: groupRows })
  }
  return groups
}

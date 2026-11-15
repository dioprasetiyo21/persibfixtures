/**
 * Team / venue name normalisation shared by every source adapter and by the
 * fixture matcher. Kept dependency-free so it can be reasoned about in isolation.
 */

const STOP_WORDS = new Set(['fc', 'fk', 'sc', 'cf', 'club', 'perserikatan'])

/**
 * Only words that are always a suffix on top of the club's identity. We do not
 * strip geography in general: "Bali United" and "Java United" must stay
 * distinct. These four cover the known official/database spelling differences.
 */
const SAFE_SUFFIXES = new Set(['tangerang', 'banten', 'presisi', 'lampung'])

/** Explicit aliases for clubs whose official and database names differ. */
const ALIASES: string[][] = [
  ['bhayangkara', 'bhayangkaralampung', 'bhayangkarapresisi'],
  ['psm', 'psmmakassar'],
  ['persib', 'persibbandung'],
  ['persebaya', 'persebayasurabaya'],
  ['persija', 'persijajakarta'],
  ['psim', 'psimyogyakarta'],
  ['pss', 'psssleman'],
  ['psis', 'psissemarang'],
  ['psms', 'psmsmedan'],
  ['psps', 'pspspekanbaru'],
  ['sriwijaya', 'sriwijayafc'],
  ['barito', 'baritoputera'],
  ['madura', 'maduraunited'],
  ['dewa', 'dewaunited'],
  ['persita', 'persitatangerang'],
]

export function decodeEntities(text: string): string {
  return text
    .replace(/&#0*39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

export function cleanText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim()
}

/** Compare-friendly key: accents, punctuation and legal suffixes removed. */
export function teamKey(name: string): string {
  const tokens = cleanText(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOP_WORDS.has(t))
  const kept = tokens.filter((t) => !SAFE_SUFFIXES.has(t))
  return (kept.length > 0 ? kept : tokens).join('')
}

function aliasGroup(key: string): string | null {
  for (const group of ALIASES) if (group.includes(key)) return group[0]
  return null
}

export function isPersib(name: string | null | undefined): boolean {
  // Word boundary matters: "Persiba Balikpapan" is a different club.
  return !!name && /\bpersib\b/i.test(cleanText(name))
}

/** True when two different spellings describe the same club. */
export function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const x = teamKey(a)
  const y = teamKey(b)
  if (!x || !y) return false
  if (x === y) return true
  const gx = aliasGroup(x)
  const gy = aliasGroup(y)
  if (gx && gx === gy) return true
  // "Persib" vs "Persib Bandung" style short forms.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 6 && long.startsWith(short)
}

/** True when a stored value is an unresolved placeholder. */
export function isPlaceholderTeam(name: string | null | undefined): boolean {
  if (!name) return true
  return /^(tbd|tba|to be (announced|determined)|-|—|\?)+$/i.test(cleanText(name))
}

const VENUE_NOISE = new Set(['stadion', 'stadium', 'gelora', 'lapangan', 'field'])

/** Compare venue names: "Stadion Pakansari" == "Pakansari". */
export function venueKey(name: string | null | undefined): string {
  if (!name) return ''
  return cleanText(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !VENUE_NOISE.has(t))
    .join('')
}

export function sameVenue(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = venueKey(a)
  const y = venueKey(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 6 && long.includes(short)
}

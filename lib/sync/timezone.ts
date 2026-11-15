/**
 * IANA timezone conversion helpers.
 *
 * Official sources publish a wall-clock time together with the timezone it is
 * expressed in. We never apply a fixed offset and never rewrite the string: every
 * conversion goes through `Intl` with the IANA zone name, so daylight saving
 * transitions (for example `America/New_York` EST↔EDT) are resolved by the
 * runtime instead of by hand.
 */

/** Target timezone for every stored fixture (Waktu Indonesia Barat). */
export const WIB = 'Asia/Jakarta'

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, dtf)
    return dtf
  } catch {
    return null
  }
}

/** True when the runtime recognises this value as an IANA timezone name. */
export function isIanaZone(value: string | null | undefined): boolean {
  return !!value && formatter(value) !== null
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function partsIn(instant: number, timeZone: string): ZonedParts | null {
  const dtf = formatter(timeZone)
  if (!dtf) return null
  const out: Record<string, number> = {}
  for (const part of dtf.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  if (!Number.isFinite(out.year) || !Number.isFinite(out.month) || !Number.isFinite(out.day)) return null
  return {
    year: out.year,
    // `hour12: false` may render midnight as 24 on some engines.
    hour: out.hour === 24 ? 0 : out.hour,
    month: out.month,
    day: out.day,
    minute: out.minute ?? 0,
  }
}

/** Offset of `timeZone` from UTC, in milliseconds, at a given instant. */
function offsetMs(instant: number, timeZone: string): number | null {
  const parts = partsIn(instant, timeZone)
  if (!parts) return null
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0)
  return asUtc - instant
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Resolve a wall-clock date/time in `timeZone` to an absolute instant (epoch ms).
 * Returns null for an unknown zone or malformed input — callers must then leave
 * the time unconfirmed rather than guessing.
 */
export function zonedWallTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): number | null {
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const t = time.match(/^(\d{2}):(\d{2})$/)
  if (!d || !t || !isIanaZone(timeZone)) return null

  const month = Number(d[2])
  const day = Number(d[3])
  const hour = Number(t[1])
  const minute = Number(t[2])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null

  const utcGuess = Date.UTC(Number(d[1]), month - 1, day, hour, minute, 0)
  const firstOffset = offsetMs(utcGuess, timeZone)
  if (firstOffset === null) return null

  let instant = utcGuess - firstOffset
  // One correction pass is enough for every real DST rule.
  const secondOffset = offsetMs(instant, timeZone)
  if (secondOffset !== null && secondOffset !== firstOffset) instant = utcGuess - secondOffset
  return instant
}

/** Format an absolute instant as a WIB (Asia/Jakarta) date + `HH:MM`. */
export function instantToWib(instant: number): { date: string; time: string } | null {
  const parts = partsIn(instant, WIB)
  if (!parts) return null
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  }
}

/**
 * Convert a wall-clock date/time expressed in `sourceTz` to WIB.
 * The date can shift by a day (e.g. a late New York kickoff lands the next
 * morning in Jakarta), so both fields are returned.
 */
export function convertToWib(
  date: string,
  time: string,
  sourceTz: string,
): { date: string; time: string } | null {
  const instant = zonedWallTimeToInstant(date, time, sourceTz)
  if (instant === null) return null
  return instantToWib(instant)
}

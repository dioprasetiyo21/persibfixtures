/**
 * Small, dependency-free numeric helper shared by every statistics adapter.
 * Sources publish numbers as text (sometimes with a `%`, thousands separators
 * or an em dash for "not available"); we only accept a real number and never
 * substitute a value the source did not give us.
 */
export function toStatNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const text = value.replace(/,/g, '.').replace(/[^\d.-]/g, '')
  if (!text || text === '-' || text === '.' || text === '-.') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** Round a percentage to one decimal place and keep it inside 0–100. */
export function normalizePercent(value: number | null): number | null {
  if (value === null) return null
  const clamped = Math.min(100, Math.max(0, value))
  return Math.round(clamped * 10) / 10
}

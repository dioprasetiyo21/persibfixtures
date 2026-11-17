/** Server-side configuration for the match statistics feature. */

function str(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

/** How long a successful lookup is cached in memory and by the fetch layer. */
export const STATS_CACHE_TTL_MS = 10 * 60_000

/** Unavailable/error results are retried sooner so a late upload shows up. */
export const STATS_RETRY_TTL_MS = 2 * 60_000

/** Next.js data-cache lifetime for upstream statistics requests. */
export const STATS_FETCH_REVALIDATE = 300

/** Hard timeout for a single upstream statistics request. */
export const STATS_FETCH_TIMEOUT_MS = 12_000

/**
 * AFC statistics come from the same Opta feed the official match-centre widget
 * reads. The widget's public subscription (decoded from
 * `secure.widget.cloud.opta.net`) authorises this outlet key for `matchstats`,
 * so the request is the one the site itself makes — nothing is guessed.
 *
 * The feed only answers with a `Referer` from the AFC origin (403 otherwise),
 * and `detailed=yes` is required: without it the feed omits the duel, aerial
 * and interception counters the match centre shows.
 */
export const AFC_OPTA_OUTLET_KEY = str(
  process.env.AFC_OPTA_OUTLET_KEY,
  '128xen4hdv7uf1enfqfzljrxfd',
)

/** Opta `matchstats` feed base; `<base>/<outlet>/<matchId>` is requested. */
export const AFC_OPTA_MATCHSTATS_BASE = str(
  process.env.AFC_OPTA_MATCHSTATS_BASE,
  'https://api.performfeeds.com/soccerdata/matchstats',
).replace(/\/+$/, '')

/** Origin the Opta feed expects in `Referer`/`Origin`. */
export const AFC_ORIGIN = str(process.env.AFC_ORIGIN, 'https://www.the-afc.com').replace(/\/+$/, '')

import { handleConfirm } from '@/lib/sync/route-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Step C: commit a previously previewed change set.
 * Accepts only a signed, short-lived token; the browser never sends fixture data.
 */
export function POST(request: Request) {
  return handleConfirm(request)
}

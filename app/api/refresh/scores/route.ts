import { handlePreview } from '@/lib/sync/route-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Step A of the score sync: scrape results, compare, return a preview. Never writes. */
export function POST(request: Request) {
  return handlePreview(request, 'scores')
}

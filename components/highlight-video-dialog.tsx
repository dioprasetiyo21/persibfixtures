'use client'

import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PublicHighlight } from '@/lib/highlights/types'

/**
 * Plays an approved highlight inside the site. The embed URL and video id are
 * produced and validated on the server, so no API key ever reaches the client.
 */
export function HighlightVideoDialog({
  highlight,
  open,
  onOpenChange,
}: {
  highlight: PublicHighlight | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open && !!highlight} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        {highlight && (
          <>
            <DialogHeader className="border-b border-border px-5 py-4">
              <DialogTitle className="font-display text-base font-bold uppercase leading-snug tracking-wide text-brand">
                {highlight.title}
              </DialogTitle>
              <DialogDescription>
                Match highlights · {highlight.channel}
              </DialogDescription>
            </DialogHeader>

            <div className="px-5 py-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                <iframe
                  src={highlight.embedUrl}
                  title={`YouTube highlight: ${highlight.title}`}
                  className="absolute inset-0 size-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                If the video cannot be played here, your browser or network may be blocking embedded YouTube
                players. Open it directly on YouTube instead.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={highlight.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
                >
                  <ExternalLink aria-hidden />
                  Watch on YouTube
                </a>
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

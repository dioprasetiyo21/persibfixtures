'use client'

import { useEffect, useState } from 'react'

export function Countdown({ target }: { target: Date | null }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!target || now === null) {
    return <span className="font-display text-2xl font-bold tabular-nums">--</span>
  }
  const diff = Math.max(0, target.getTime() - now)
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor((diff / 3_600_000) % 24)
  const m = Math.floor((diff / 60_000) % 60)
  const s = Math.floor((diff / 1000) % 60)
  const parts: [number, string][] = [
    [d, 'd'],
    [h, 'h'],
    [m, 'm'],
    [s, 's'],
  ]
  return (
    <span className="flex items-baseline gap-1.5 font-display font-bold tabular-nums" aria-live="off">
      {parts.map(([v, u]) => (
        <span key={u}>
          <span className="text-2xl">{String(v).padStart(2, '0')}</span>
          <span className="text-xs opacity-70">{u}</span>
        </span>
      ))}
    </span>
  )
}

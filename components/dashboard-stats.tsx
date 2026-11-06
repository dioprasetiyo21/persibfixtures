import { Countdown } from '@/components/countdown'
import { kickoffDate } from '@/lib/fixtures'
import type { Fixture } from '@/lib/types'

interface DashboardStatsProps {
  total: number
  upcoming: number
  completed: number
  competitions: number
  record: { w: number; d: number; l: number }
  next: Fixture | null
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col justify-between gap-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="font-display text-3xl font-bold leading-none text-navy tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function DashboardStats({ total, upcoming, completed, competitions, record, next }: DashboardStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <Stat label="Total matches" value={total} hint="Incl. provisional knockouts" />
      <Stat label="Upcoming" value={upcoming} hint="Scheduled & TBA" />
      <Stat label="Completed" value={completed} hint={`W${record.w} · D${record.d} · L${record.l}`} />
      <Stat label="Competitions" value={competitions} hint="Active this season" />
      <div className="col-span-2 flex flex-col justify-between gap-1 rounded-lg bg-navy px-4 py-3 text-white shadow-sm md:col-span-2 lg:col-span-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Next match in</span>
        <Countdown target={next ? kickoffDate(next) : null} />
        <span className="truncate text-xs text-white/70">
          {next ? `vs ${next.opponent}${next.kickoff ? '' : ' · kickoff TBA'}` : 'No upcoming match'}
        </span>
      </div>
    </div>
  )
}

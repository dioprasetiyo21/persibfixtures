'use client'

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  FileSpreadsheet,
  Printer,
  Search,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { monthLabel } from '@/lib/fixtures'
import type { ViewMode } from '@/lib/types'
import { cn } from '@/lib/utils'

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'season', label: 'Full season' },
  { id: 'month', label: 'Month' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Results' },
]

interface CalendarToolbarProps {
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  months: string[]
  focusMonth: string
  onMonthChange: (m: string) => void
  onToday: () => void
  query: string
  onQueryChange: (q: string) => void
  onPrint: () => void
  onCSV: () => void
  onICS: () => void
}

export function CalendarToolbar(p: CalendarToolbarProps) {
  const idx = p.months.indexOf(p.focusMonth)
  const navDisabled = p.view === 'upcoming' || p.view === 'completed'
  const items = p.months.map((m) => ({ value: m, label: monthLabel(m) }))

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Display" className="flex rounded-md border border-border bg-white p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={p.view === v.id}
              onClick={() => p.onViewChange(v.id)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-semibold transition sm:px-3',
                p.view === v.id ? 'bg-navy text-white' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className={cn('flex items-center gap-1', navDisabled && 'pointer-events-none opacity-40')}>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            disabled={idx <= 0}
            onClick={() => p.onMonthChange(p.months[idx - 1])}
          >
            <ChevronLeft />
          </Button>
          <Select items={items} value={p.focusMonth} onValueChange={(v) => v && p.onMonthChange(v as string)}>
            <SelectTrigger size="sm" className="w-40 bg-white font-semibold" aria-label="Jump to month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            disabled={idx >= p.months.length - 1}
            onClick={() => p.onMonthChange(p.months[idx + 1])}
          >
            <ChevronRight />
          </Button>
          <Button variant="outline" size="sm" onClick={p.onToday}>
            <CalendarDays aria-hidden /> Today
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 lg:w-72 lg:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={p.query}
            onChange={(e) => p.onQueryChange(e.target.value)}
            placeholder="Search opponent, venue, date…"
            aria-label="Search matches"
            className="h-8 bg-white pl-8 pr-8"
          />
          {p.query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => p.onQueryChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" />}>
            <Download aria-hidden /> Export
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={p.onPrint}>
              <Printer aria-hidden /> Print calendar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={p.onPrint}>
              <FileDown aria-hidden /> Save as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={p.onCSV}>
              <FileSpreadsheet aria-hidden /> Export CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={p.onICS}>
              <CalendarDays aria-hidden /> Download .ics
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

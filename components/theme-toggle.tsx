'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeMode } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/**
 * Light / Dark / System selector. Styled for the navy header by default; pass
 * `className` to override the trigger when used on another surface.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const active = OPTIONS.find((option) => option.value === theme) ?? OPTIONS[2]
  const ActiveIcon = active.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1.5 rounded-full px-2 text-xs text-white hover:bg-white/10 hover:text-white',
              className,
            )}
            aria-label={`Colour theme: ${active.label}. Change theme`}
          />
        }
      >
        <ActiveIcon aria-hidden className="size-3.5" />
        <span className="hidden sm:inline">{active.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeMode)}>
          {OPTIONS.map((option) => {
            const OptionIcon = option.icon
            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <OptionIcon aria-hidden />
                {option.label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

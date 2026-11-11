import Image from 'next/image'
import { cn } from '@/lib/utils'
import { teamInitials } from '@/lib/fixtures'
import { teamLogo } from '@/lib/team-logos'

/** Bare club logo for dense calendar cells. Renders nothing when no logo file exists. */
export function TeamLogo({ name, className }: { name: string; className?: string }) {
  const src = teamLogo(name)
  if (!src) return null
  return (
    <Image
      src={src}
      alt=""
      aria-hidden
      decoding="async"
      width={64}
      height={64}
      className={cn('size-6 shrink-0 object-contain', className)}
    />
  )
}

export function TeamCrest({ name, className }: { name: string; className?: string }) {
  const src = teamLogo(name)
  if (src) {
    return (
      <div
        className={cn(
          'flex size-16 items-center justify-center rounded-full bg-white p-1.5 ring-2 ring-white shadow-md',
          className,
        )}
      >
        <Image
          src={src}
          alt={`${name} crest`}
          width={64}
          height={64}
          className="h-full w-full object-contain"
        />
      </div>
    )
  }
  return (
    <div
      role="img"
      aria-label={name === 'TBD' ? 'Opponent to be decided' : `${name} (club crest placeholder)`}
      className={cn(
        'flex size-16 items-center justify-center rounded-full border-2 border-slate-300 bg-slate-100 font-display text-lg font-bold tracking-wide text-slate-600 shadow-sm',
        className,
      )}
    >
      {teamInitials(name)}
    </div>
  )
}

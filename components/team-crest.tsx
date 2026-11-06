import Image from 'next/image'
import { cn } from '@/lib/utils'
import { teamInitials } from '@/lib/fixtures'

export function TeamCrest({ name, className }: { name: string; className?: string }) {
  if (name === 'Persib Bandung') {
    return (
      <div
        className={cn(
          'flex size-16 items-center justify-center rounded-full bg-white p-1.5 ring-2 ring-white shadow-md',
          className,
        )}
      >
        <Image
          src="/logos/persib.svg"
          alt="Persib Bandung"
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

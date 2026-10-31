import { initialsOf } from '@/domain/users'
import { cn } from '@/lib/utils'
import type { User } from '@/domain/types'

/** A person's face: their profile photo, or their initials when there is none. */
export function PersonAvatar({ user, small = false }: { user: Pick<User, 'name' | 'avatarUrl'>; small?: boolean }) {
  const size = small ? 'h-4 w-4' : 'h-6 w-6'
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className={cn(size, 'shrink-0 rounded-full object-cover')} />
  }
  return (
    <span className={cn(size, 'grid shrink-0 place-items-center rounded-full bg-slate-700 text-micro font-bold text-white')}>
      {initialsOf(user.name)}
    </span>
  )
}

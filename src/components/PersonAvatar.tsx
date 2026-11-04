import { initialsOf } from '@/domain/users'
import { cn } from '@/lib/utils'
import type { User } from '@/domain/types'

/**
 * A person's face: their profile photo, their initials when there is none, or the mark of an account
 * that has been removed.
 *
 * One component for every surface that draws a person — the drawer's chips, a card's avatar row, a
 * timeline block — so the same person cannot be two different marks on two screens. The initials
 * are decoration over a name the surrounding control says in words, which is why `title` carries it
 * and the image's `alt` does not repeat it.
 */
export function PersonAvatar({
  user,
  small = false,
  gone = false,
  className,
}: {
  user: Pick<User, 'name' | 'avatarUrl'>
  small?: boolean
  /** The account this id named has been removed: the work still names them. */
  gone?: boolean
  className?: string
}) {
  const size = small ? 'h-4 w-4' : 'h-6 w-6'
  if (gone) {
    return (
      <span
        className={cn(size, 'grid shrink-0 place-items-center rounded-full bg-slate-200 text-micro font-bold text-slate-600', className)}
        title={`${user.name}: their account was removed`}
        aria-label={user.name}
      >
        ?
      </span>
    )
  }
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        title={user.name}
        className={cn(size, 'shrink-0 rounded-full object-cover', className)}
      />
    )
  }
  return (
    <span
      className={cn(size, 'grid shrink-0 place-items-center rounded-full bg-slate-700 text-micro font-bold text-white', className)}
      title={user.name}
    >
      {initialsOf(user.name)}
    </span>
  )
}

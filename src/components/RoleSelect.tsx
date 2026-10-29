import { ROLES } from '@/domain/roles'
import type { Role } from '@/domain/roles'
import { cn } from '@/lib/utils'

/**
 * The role select, once.
 *
 * Two screens change somebody's role — the People drawer and the workspace's member list — and both
 * offer the same three choices with the same sentence under each. A second copy would drift the
 * moment one of them gained a fourth role, so this is the only copy.
 */
export function RoleSelect({
  value,
  onChange,
  disabled,
  label,
  compact,
  className,
}: {
  value: string
  onChange(role: Role): void
  disabled?: boolean
  /** Given when the select needs a visible label of its own. */
  label?: string
  /** In a table row the sentence is too long for the cell: show the role's name alone. */
  compact?: boolean
  className?: string
}) {
  const select = (
    <select
      value={value}
      disabled={disabled}
      aria-label={label ?? 'Role'}
      title={compact ? ROLES.find((entry) => entry.id === value)?.description : undefined}
      onChange={(event) => onChange(event.target.value as Role)}
      className={cn(
        'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none focus:border-indigo-400 disabled:opacity-40',
        className,
      )}
    >
      {ROLES.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {compact ? entry.label : `${entry.label} — ${entry.description}`}
        </option>
      ))}
    </select>
  )

  if (!label) return select
  return (
    <label className="block text-micro font-semibold uppercase tracking-wide text-slate-500">
      {label}
      <span className="mt-1 block font-normal normal-case">{select}</span>
    </label>
  )
}

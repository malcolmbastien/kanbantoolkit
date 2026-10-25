import { can } from '@/domain/roles'
import type { Action, Role } from '@/domain/roles'
import { useAuth } from './auth'

/**
 * Whether the person at this browser may do a thing — the interface's half of the matrix.
 *
 * `src/domain/roles.ts` is the decision: the server asks it on every request, and a control that
 * disagrees with it is a lie in one direction or the other. This module is the courtesy the matrix
 * promises — the interface hides or disables what the role cannot do, so a Viewer is not offered a
 * button that answers 403.
 *
 * **A browser with no account is not a Viewer.** The static build is a workspace the person owns in
 * `localStorage`: there is no server, no role, and nothing to enforce, so it stays editable. Roles
 * only exist where somebody signed in.
 */
export function may(role: string | undefined, action: Action): boolean {
  if (!role) return true
  return can(role, action)
}

/** The same question, for a component: it re-renders when the account or its role changes. */
export function useMay(): (action: Action) => boolean {
  const role = useAuth((state) => state.user?.role)
  return (action) => may(role as Role | undefined, action)
}

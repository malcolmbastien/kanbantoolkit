import { Component, type ReactNode } from 'react'
import { reportError } from '@/lib/errors'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render errors so a stale/broken module shows a friendly reload prompt
 * instead of a blank screen (common when a dev server HMRs mid-edit).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[Kanban Toolkit] render error:', error, info)
    // A render failure is the one people see and never report; this does it for them.
    reportError(error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-full place-items-center bg-slate-100 p-6 text-center">
          <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
            <h2 className="text-title font-semibold text-slate-800">Something went wrong</h2>
            <p className="mt-1 break-words text-meta text-slate-600">
              {String(this.state.error.message || this.state.error)}
            </p>
            <p className="mt-2 text-meta text-slate-600">
              If you were just editing files, a stale dev module is the usual cause — a hard reload fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-meta font-medium text-white hover:bg-indigo-700"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

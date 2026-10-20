import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { startSnapshotSchedule } from './lib/snapshots'
import { PERSIST_VERSION, persistedSlice, useStore } from './store'
import './index.css'

/**
 * The workspace is snapshotted outside React: a schedule is not a component's business, and
 * starting it once here means StrictMode's double render cannot start it twice.
 */
startSnapshotSchedule({
  read: () => persistedSlice(useStore.getState()),
  subscribe: (listener) => useStore.subscribe(listener),
  version: PERSIST_VERSION,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

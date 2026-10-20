import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installErrorHandlers } from './lib/errors'
import { startSnapshotSchedule } from './lib/snapshots'
import { measureStorage, verifyStorage } from './lib/storage'
import { listenForTabs } from './lib/tabSync'
import { PERSIST_KEY, PERSIST_VERSION, adoptWorkspace, persistedSlice, useStore } from './store'
import './index.css'

// Nothing the app throws goes unnoticed: both handlers report to the endpoint, which keeps the
// message and the stack and nothing about the workspace.
installErrorHandlers()

/**
 * The workspace is snapshotted outside React: a schedule is not a component's business, and
 * starting it once here means StrictMode's double render cannot start it twice.
 */
startSnapshotSchedule({
  read: () => persistedSlice(useStore.getState()),
  subscribe: (listener) => useStore.subscribe(listener),
  version: PERSIST_VERSION,
})

// Another tab's write is adopted, not raced: the workspace is shared, and the tab that did not
// write it must see it before its next change.
listenForTabs(PERSIST_KEY, adoptWorkspace)

// A write is only known to have landed when it is read back, and the storage figures the panel
// shows are only as good as their last reading. Both are cheap, and neither belongs on a keystroke.
void measureStorage()
window.setInterval(() => {
  verifyStorage()
  void measureStorage()
}, 30_000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

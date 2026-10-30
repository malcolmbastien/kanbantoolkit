import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { filtersFromParam } from '@/domain/filters'
import { useStore } from '@/store'
import { DEFAULT_FLOW_WINDOW } from '@/domain/flowWindow'
import { placeFromQuery, urlQuery, viewOf, type Place } from './url'
import { titleFor } from './title'

/**
 * The URL, read and written.
 *
 * One owner for both directions, because they are one fact — where the app is. On the way in it
 * applies what a link asked for: the place (board, view, open card) and the intentions the app
 * also understands (`?q=`, `?filters=`, `?collapse=`, `?select=`, `?lens=`, `?boundary=`,
 * `?stress=`, `?edit=`). On the way out it keeps the query in step with the place, so anywhere the
 * app can be is a link somebody can send.
 *
 * Reading and writing are the same effect on purpose, and the first write comes after the read: a
 * write from the default state would erase the very parameters being read. For the same reason the
 * write reads the store at the moment it fires rather than through its own closure — the closure
 * belongs to the render that scheduled it, and the first of those is the pre-boot one.
 */
export function useUrl() {
  const ready = useRef(false)
  const first = useRef(true)
  // The place as last written, so the effect can tell a journey — another board or view, which is
  // a step in history — from an open card, which is not.
  const last = useRef<Place | null>(null)
  // Subscribed so the write effect has something to fire on; the values themselves are read fresh.
  const boardId = useStore((s) => s.boardId)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const view = useStore(viewOf)
  // The Flow view's reading: which window and which cards flow. Subscribed because a change to
  // either is a change to the place, and the URL has to follow it.
  const flowWindow = useStore((s) => s.flowWindow)
  const metricsFlowId = useStore((s) => s.metricsFlowId)
  // The document's name, derived the same way the URL is: the board and the view. The open card
  // is deliberately not read here — opening a drawer must not rename the page.
  const title = useStore((s) =>
    titleFor({
      view: viewOf(s),
      board: s.boards.find((b) => b.id === s.boardId)?.name,
    }),
  )

  useEffect(() => {
    document.title = title
  }, [title])

  /**
   * Apply the Flow view's reading from a place.
   *
   * A flow id that is not one of this board's cards flows is not a reading this link can give, so
   * it falls back to every flow rather than lighting a control with no effect. The window falls
   * back to the default; the URL is then normalised to the place actually shown.
   */
  const applyFlowReading = useCallback((place: Partial<Place>) => {
    if (place.view !== 'flow') return
    const s = useStore.getState()
    s.setFlowWindow(place.range ?? DEFAULT_FLOW_WINDOW)
    const flowId = place.flowId
    const known = Boolean(flowId) && s.flows.some((f) => f.id === flowId && f.boardId === s.boardId && f.kind === 'cards')
    s.setMetricsFlow(known ? flowId! : null)
  }, [])

  // ---- On the way in: what the link asked for ----
  // A layout effect, so the place is applied before the first paint. The app's home and a board are
  // different screens, and a link to one must not flash the other — or download it — on the way in.
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const place = placeFromQuery(window.location.search)
    const s = () => useStore.getState()
    const known = (id: string | null | undefined, has: { id: string }[]) => Boolean(id && has.some((x) => x.id === id))

    // A board or a card that is not here is not a place. A link from another dataset — or to
    // something somebody has since deleted — lands on what is there, rather than on a blank
    // surface under a URL claiming otherwise.
    if (known(place.boardId, s().boards)) s().selectBoard(place.boardId!)
    if (params.get('edit')) s().beginEdit()
    if (place.view) s().setView(place.view)
    applyFlowReading(place)
    // My work is a drawer, not a view: a link that names it opens the drawer over the place it
    // would otherwise have landed on. (The first write normalises the URL back to that place.)
    if (params.get('view') === 'mywork') s().setMyWork(true)
    // The open card is applied before the intentions below: it is the place's most specific fact,
    // and a view on its way in (the workspace, notably) clears a selection.
    if (known(place.itemId, s().items)) s().openItem(place.itemId!)

    const lens = params.get('lens')
    if (lens) s().setLens(lens)
    const boundary = params.get('boundary')
    if (boundary && s().boundaryId !== boundary) s().toggleBoundary(boundary)
    // ?select=id1,id2 pre-selects cards in the multi-select group.
    const select = params.get('select')
    if (select) {
      for (const id of select.split(',').map((t) => t.trim()).filter(Boolean)) {
        if (!s().multiSelect.includes(id)) s().toggleMultiSelect(id)
      }
    }
    const q = params.get('q')
    if (q) {
      s().setSearch(q)
      // A deep-linked ?q= meant a narrowed board, and the top-bar search no longer filters the
      // columns — narrowing by text is the filter panel's criterion now. Both get the query: the
      // finder keeps its results, the board keeps its narrowing.
      s().setFilters({ text: q })
    }
    // ?filters=1 opens the panel; ?filters=blocked,overdue also applies those filters.
    const filtersParam = params.get('filters')
    if (filtersParam) {
      if (!s().showFilters) s().toggleFilters()
      const parsed = filtersFromParam(filtersParam)
      if (parsed) s().setFilters(parsed)
    }
    // Idempotent: StrictMode double-invokes this effect, and toggleCollapse would flip twice.
    for (const id of params.getAll('collapse')) {
      if (!s().collapsedLanes[id]) s().toggleCollapse(id)
    }
    // A load-test board, built on request: `?stress=300` (and `?stress` alone is 300). Asking
    // again replaces the one it built before, so the size is changed by asking, not by cleaning up.
    const stress = params.get('stress')
    if (stress !== null) s().addStressBoard(Math.max(1, Math.min(2000, Number(stress) || 300)))

    ready.current = true
  }, [applyFlowReading])

  // ---- On the way out: the place, as a query ----
  useEffect(() => {
    if (!ready.current) return
    const wasFirst = first.current
    first.current = false
    const s = useStore.getState()
    const flow = viewOf(s) === 'flow'
    const place: Place = {
      boardId: s.boardId,
      view: viewOf(s),
      itemId: s.selectedItemId,
      ...(flow ? { range: s.flowWindow, flowId: s.metricsFlowId } : {}),
    }
    const before = last.current
    last.current = place
    const query = urlQuery(place)
    if (query === window.location.search) return
    // A board and a view are journeys: each is a step the back button can undo. An open card is
    // not — it is the same place with something drawn over it — so it rewrites the step it is on.
    // Otherwise every dismissal would leave a duplicate behind, and back would look broken once
    // before it worked. The first write normalises whatever link arrived (dropping `?q=` and the
    // rest, and filling in the board chosen for us) and is not a step either.
    const samePlace = before !== null && before.boardId === place.boardId && before.view === place.view
    if (wasFirst || samePlace) window.history.replaceState(null, '', query)
    else window.history.pushState(null, '', query)
  }, [boardId, view, selectedItemId, flowWindow, metricsFlowId])

  // ---- And back: the places the app has been ----
  useEffect(() => {
    const onPop = () => {
      const s = useStore.getState()
      const place = placeFromQuery(window.location.search)
      if (place.boardId && place.boardId !== s.boardId && s.boards.some((b) => b.id === place.boardId)) s.selectBoard(place.boardId)
      // Always applied, including when the URL says nothing: an absent view means the board's own
      // flow, so going back from the Timeline returns to the board rather than leaving the URL and
      // the screen disagreeing.
      if (place.view) s.setView(place.view)
      applyFlowReading(place)
      // Whatever the URL says about the open card is the truth, including saying nothing.
      const open = useStore.getState().selectedItemId
      if (place.itemId && place.itemId !== open && s.items.some((i) => i.id === place.itemId)) s.openItem(place.itemId)
      else if (!place.itemId && open) useStore.getState().openItem(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [applyFlowReading])
}

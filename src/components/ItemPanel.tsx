import { useState } from 'react'
import { Ban, ChevronRight, GitBranch, Plus, Sparkles, X } from 'lucide-react'
import {
  attributedObjectives,
  blockingSummary,
  computeLevel,
  decompositionChildren,
  descendants,
  dependencyState,
  incomingDependencies,
  openDescendants,
  outgoingDependencies,
  portfolioStatus,
  resolved,
  type Graph,
} from '@/domain/derive'
import { homeScopeId } from '@/domain/board'
import { LIFECYCLES, nominalResolution } from '@/domain/lifecycles'
import { DEP_STATE_STYLES, TYPE_STYLES, streamColor } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item, SponsorDecision } from '@/domain/types'

interface Props {
  itemId: string
  requestMove: (itemId: string, toScopeId: string, toState: string) => void
}

export function ItemPanel({ itemId, requestMove }: Props) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const scopes = useStore((s) => s.scopes)
  const objectives = useStore((s) => s.objectives)
  const sponsors = useStore((s) => s.sponsors)
  const close = useStore((s) => s.openItem)
  const addStory = useStore((s) => s.addStory)
  const raiseDependency = useStore((s) => s.raiseDependency)
  const confirmDependency = useStore((s) => s.confirmDependency)
  const rejectDependency = useStore((s) => s.rejectDependency)
  const setAttribution = useStore((s) => s.setAttribution)
  const confirmSponsor = useStore((s) => s.confirmSponsor)

  const [blockerId, setBlockerId] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [showOverride, setShowOverride] = useState(false)

  const graph = { items, edges }
  const item = items.find((i) => i.id === itemId)

  if (!item) return null

  const level = computeLevel(item, graph)
  const lifecycle = LIFECYCLES[nominalResolution(item.type)]
  const vs = scopes.find((s) => s.id === item.valueStreamId)
  const team = scopes.find((s) => s.id === item.teamId)
  const children = decompositionChildren(item.id, edges)
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is Item => Boolean(i))
  const incoming = incomingDependencies(item.id, graph)
  const outgoing = outgoingDependencies(item.id, graph)
  const exposure = openDescendants(item.id, graph)
  const badge = blockingSummary(item.id, graph, scopes)
  const attributed = attributedObjectives(item.id, edges, objectives)
  const candidates = items.filter(
    (i) => i.id !== item.id && !descendants(item.id, graph).includes(i.id),
  )

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-start gap-2 border-b border-slate-100 px-4 py-3">
        <span className="mt-1 h-8 w-1 rounded-full" style={{ backgroundColor: streamColor(item.valueStreamId, scopes) }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ring-1', TYPE_STYLES[item.type].pill)}>
              {TYPE_STYLES[item.type].label}
            </span>
            <span className="text-[10px] text-slate-400">{vs?.name}{team ? ` · ${team.name}` : ''}</span>
          </div>
          <h2 className="mt-0.5 text-[14px] font-semibold leading-snug text-slate-800">{item.title}</h2>
        </div>
        <button onClick={() => close(null)} className="text-slate-400 hover:text-slate-600">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[12px]">
        {/* Computed level */}
        <section className="rounded-md border border-indigo-100 bg-indigo-50/60 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700">
            <Sparkles size={12} /> Level — computed, not a field
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded bg-indigo-600 px-1.5 py-px text-[11px] font-bold text-white">
              {level.level}
            </span>
            <span className="text-slate-600">{LIFECYCLES[level.level].label} resolution</span>
          </div>
          <p className="mt-1 text-[11px] text-indigo-700/80">
            {level.derived ? 'Derived: ' : 'Nominal: '}
            {level.derivation}
          </p>
        </section>

        {/* State */}
        <section>
          <SectionLabel>State — {nominalResolution(item.type)} lifecycle</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {lifecycle.states.map((s) => (
              <button
                key={s}
                onClick={() => requestMove(item.id, homeScopeId(item, nominalResolution(item.type)), s)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-medium transition',
                  item.state === s
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          {item.lastMoveReason && (
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700 ring-1 ring-amber-100">
              Last move reason: {item.lastMoveReason}
            </p>
          )}
        </section>

        {/* Children + composition pressure */}
        <section>
          <SectionLabel>
            Decomposes into ({children.length})
            {exposure.length > 0 && (
              <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">
                {exposure.length} open below
              </span>
            )}
          </SectionLabel>
          <div className="space-y-1">
            {children.length === 0 && (
              <p className="text-[11px] text-slate-400">No children — level falls back to nominal.</p>
            )}
            {children.map((c) => {
              const cl = computeLevel(c, graph)
              return (
                <button
                  key={c.id}
                  onClick={() => close(c.id)}
                  className="flex w-full items-center gap-2 rounded border border-slate-200 px-2 py-1 text-left hover:bg-slate-50"
                >
                  <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{cl.level}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{c.title}</span>
                  <span className="text-[10px] text-slate-400">{c.state}</span>
                </button>
              )
            })}
            {(item.type === 'epic' || item.type === 'story') && (
              <button
                onClick={() => addStory(item.id, 'New story')}
                className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
              >
                <Plus size={11} /> Add child story
              </button>
            )}
          </div>
        </section>

        {/* Dependencies */}
        <section>
          <SectionLabel>Dependencies</SectionLabel>
          {badge.count > 0 && (
            <div className="mb-2 flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 ring-1 ring-amber-100">
              <Ban size={11} /> This blocks {badge.count} item{badge.count > 1 ? 's' : ''} across {badge.streams}{' '}
              stream{badge.streams > 1 ? 's' : ''}
            </div>
          )}

          <div className="space-y-1">
            {incoming.length === 0 && outgoing.length === 0 && (
              <p className="text-[11px] text-slate-400">No dependency edges.</p>
            )}

            {incoming.map((d) => {
              const state = DEP_STATE_STYLES[d.state]
              return (
                <div key={d.edge.id} className="rounded border border-slate-200 px-2 py-1.5">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Ban size={10} /> blocked by
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-slate-700">{d.blocker.title}</span>
                    {d.edge.dep?.status === 'proposed' ? (
                      <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
                        pending confirmation
                      </span>
                    ) : (
                      <span className={cn('rounded px-1 text-[9px] font-semibold ring-1', state.className)}>
                        {state.label}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    derived: Y={d.dependent.state}, X={d.blocker.state} → {dependencyState(d.blocker, d.dependent)}
                  </div>
                  {d.edge.dep?.pinTo && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                      <ChevronRight size={10} /> pinned to{' '}
                      {items.find((i) => i.id === d.edge.dep?.pinTo)?.title ?? d.edge.dep.pinTo}
                    </div>
                  )}
                </div>
              )
            })}

            {outgoing.map((d) => {
              const isProposed = d.edge.dep?.status === 'proposed'
              return (
                <div key={d.edge.id} className="rounded border border-slate-200 px-2 py-1.5">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <GitBranch size={10} /> blocks
                  </div>
                  <div className="text-slate-700">{d.dependent.title}</div>
                  {isProposed ? (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="rounded bg-amber-50 px-1 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                        confirmation requested
                      </span>
                      <button
                        onClick={() => confirmDependency(d.edge.id)}
                        className="rounded bg-emerald-600 px-1.5 py-px text-[10px] font-medium text-white hover:bg-emerald-700"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => rejectDependency(d.edge.id, 'Not a real dependency')}
                        className="rounded border border-slate-200 px-1.5 py-px text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-400">
                      {resolved(d.dependent) ? 'dependent resolved' : `derived → ${DEP_STATE_STYLES[d.state].label}`}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Raise */}
          <div className="mt-2 flex items-center gap-1">
            <select
              value={blockerId}
              onChange={(e) => setBlockerId(e.target.value)}
              className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]"
            >
              <option value="">Raise: this is blocked by…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {TYPE_STYLES[c.type].label}: {c.title}
                </option>
              ))}
            </select>
            <button
              disabled={!blockerId}
              onClick={() => {
                raiseDependency(blockerId, item.id)
                setBlockerId('')
              }}
              className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
            >
              Raise
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            Raised edges are <span className="font-medium">proposed</span> until the blocker's board confirms.
          </p>
        </section>

        {/* Attribution */}
        <section>
          <SectionLabel>Attribution — informs, never counts</SectionLabel>
          <div className="space-y-1">
            {objectives.map((o) => {
              const on = attributed.some((a) => a.id === o.id)
              return (
                <label key={o.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setAttribution(item.id, o.id, e.target.checked)}
                  />
                  <span className="flex-1 text-slate-700">{o.title}</span>
                  <span className="text-[10px] text-slate-400">{o.period}</span>
                </label>
              )
            })}
          </div>
          {attributed.length > 1 && (
            <p className="mt-1 text-[10px] text-emerald-700">
              Serves {attributed.length} objectives — still 1 unit of WIP.
            </p>
          )}
        </section>

        {/* Portfolio rollup — initiatives only */}
        {item.type === 'initiative' && (
          <PortfolioSection
            item={item}
            graph={graph}
            sponsors={sponsors}
            showOverride={showOverride}
            overrideReason={overrideReason}
            setShowOverride={setShowOverride}
            setOverrideReason={setOverrideReason}
            onConfirm={(decision, reason) => confirmSponsor(item.id, decision, reason)}
          />
        )}
      </div>
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>
}

function PortfolioSection({
  item, graph, sponsors, showOverride, overrideReason, setShowOverride, setOverrideReason, onConfirm,
}: {
  item: Item
  graph: Graph
  sponsors: Record<string, { decision: SponsorDecision; reason?: string }>
  showOverride: boolean
  overrideReason: string
  setShowOverride: (v: boolean) => void
  setOverrideReason: (v: string) => void
  onConfirm: (decision: SponsorDecision, reason?: string) => void
}) {
  const status = portfolioStatus(item, graph)
  const record = sponsors[item.id]
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <SectionLabel>Portfolio status — computed from committed work</SectionLabel>
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-800 px-1.5 py-px text-[11px] font-bold text-white">{status.label}</span>
        <span className="text-[11px] text-slate-500">{status.rationale}</span>
      </div>
      <div className="mt-1 flex gap-2 text-[10px] text-slate-500">
        <span>{status.total} epics</span>
        <span>· {status.inFlight} in flight</span>
        <span>· {status.done} done</span>
      </div>

      <div className="mt-2 rounded border border-dashed border-indigo-200 bg-white p-2">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
          <Sparkles size={11} /> Sponsor recommendation
        </div>
        <p className="mt-0.5 text-[11px] text-slate-600">
          Suggest <span className="font-semibold">{status.recommendation}</span>. A human confirms — no
          auto-approval.
        </p>
        {record ? (
          <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">
            Confirmed {record.decision}
            {record.reason ? ` — ${record.reason}` : ''}
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <button
              onClick={() => onConfirm(status.recommendation)}
              className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
            >
              Confirm {status.recommendation}
            </button>
            <button
              onClick={() => setShowOverride(!showOverride)}
              className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            >
              Override…
            </button>
          </div>
        )}
        {showOverride && !record && (
          <div className="mt-1.5 space-y-1">
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={2}
              placeholder="Reason for overriding the computed status (required)"
              className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]"
            />
            <div className="flex gap-1">
              <button
                disabled={overrideReason.trim().length < 4}
                onClick={() => {
                  onConfirm(status.recommendation === 'committed' ? 'rejected' : 'committed', overrideReason.trim())
                  setShowOverride(false)
                  setOverrideReason('')
                }}
                className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
              >
                Override with reason
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

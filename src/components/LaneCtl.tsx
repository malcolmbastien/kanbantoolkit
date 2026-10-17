import { ArrowLeftRight, BetweenHorizontalStart, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, CopyPlus, Plus, Rows3, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SplitOrientation } from '@/domain/types'

/**
 * The lane-editing controls, shared by both workflows.
 *
 * They used to be two implementations with two icon sets — the cards workflow on glyphs and the
 * initiatives workflow on different ones — so the same action looked like two different actions
 * depending on which workflow you happened to be editing. One component, one set of icons.
 *
 * They are also joined rather than separate: these are one toolbar over one lane, and a row of
 * individually-boxed buttons reads as a row of unrelated things.
 */
export function CtlGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center overflow-hidden rounded-md bg-slate-200 ring-1 ring-slate-300/70">{children}</div>
  )
}

/** A hairline between one run of controls and the next — moving a lane is not splitting it. */
export function CtlDivider() {
  return <span className="h-5 w-px shrink-0 bg-slate-300" aria-hidden />
}

export function LaneCtl({
  children,
  onClick,
  title,
  active,
  disabled,
  btnRef,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
  disabled?: boolean
  btnRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        'grid h-5 w-5 place-items-center transition',
        disabled
          ? 'cursor-not-allowed text-slate-400'
          : active
            ? 'bg-indigo-600 text-white'
            : 'text-slate-600 hover:bg-slate-300 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The whole lane-editing cluster — the one toolbar over one lane.
 *
 * Boards (edit mode) and the template editor render this same component, so the
 * capabilities are the same because the code is the same: sub-lanes move, a leaf splits,
 * a split gains a lane and flips its arrangement, and the typed top-level columns stay
 * put — never moved, inserted after or duplicated. Their *names* are the team's own, so
 * renaming is in the settings popover like every other lane's.
 */
export function LaneEditControls({
  isLeafCell,
  top,
  orientation,
  horizontal,
  canMovePrev,
  canMoveNext,
  onMove,
  onSplit,
  onAdd,
  onFlip,
  onInsert,
  onDuplicate,
  onSettings,
  settingsActive,
  settingsBtnRef,
}: {
  /** A leaf (cell) splits; a split gains a lane — the board's own vocabulary. */
  isLeafCell: boolean
  /** A top-level typed column is fixed in place — never moved, inserted after or duplicated. */
  top: boolean
  /** The lane's own arrangement, for the "add a row/column" wording. */
  orientation?: SplitOrientation
  /** Whether the *parent* arranges its children as columns — it decides which way "move" points. */
  horizontal: boolean
  canMovePrev: boolean
  canMoveNext: boolean
  onMove: (delta: number) => void
  onSplit: (orientation: SplitOrientation) => void
  onAdd: () => void
  onFlip: () => void
  onInsert: () => void
  onDuplicate: () => void
  onSettings: () => void
  settingsActive: boolean
  settingsBtnRef: React.Ref<HTMLButtonElement>
}) {
  return (
    <CtlGroup>
      {!top && (
        <>
          {horizontal ? (
            <>
              <LaneCtl title="Move left" disabled={!canMovePrev} onClick={() => onMove(-1)}>
                <ChevronLeft size={12} />
              </LaneCtl>
              <LaneCtl title="Move right" disabled={!canMoveNext} onClick={() => onMove(1)}>
                <ChevronRight size={12} />
              </LaneCtl>
            </>
          ) : (
            <>
              <LaneCtl title="Move up" disabled={!canMovePrev} onClick={() => onMove(-1)}>
                <ChevronUp size={12} />
              </LaneCtl>
              <LaneCtl title="Move down" disabled={!canMoveNext} onClick={() => onMove(1)}>
                <ChevronDown size={12} />
              </LaneCtl>
            </>
          )}
          <CtlDivider />
        </>
      )}

      {isLeafCell ? (
        <>
          <LaneCtl title="Split this cell into columns" onClick={() => onSplit('columns')}>
            <Columns3 size={12} />
          </LaneCtl>
          <LaneCtl title="Split this cell into rows" onClick={() => onSplit('rows')}>
            <Rows3 size={12} />
          </LaneCtl>
        </>
      ) : (
        <>
          <LaneCtl title={`Add a ${(orientation ?? 'columns') === 'rows' ? 'row' : 'column'} to this split`} onClick={onAdd}>
            <Plus size={12} />
          </LaneCtl>
          {/* The typed columns are fixed in place, but the shape they take is not: a split
              Backlog or Done may be arranged either way, like any split. */}
          <LaneCtl title="Flip columns ↔ rows" onClick={onFlip}>
            <ArrowLeftRight size={12} />
          </LaneCtl>
        </>
      )}
      {!top && (
        <>
          <CtlDivider />
          <LaneCtl title="Insert a new lane after this one" onClick={onInsert}>
            <BetweenHorizontalStart size={12} />
          </LaneCtl>
          <LaneCtl title="Duplicate this lane and its sub-lanes" onClick={onDuplicate}>
            <CopyPlus size={12} />
          </LaneCtl>
        </>
      )}
      <CtlDivider />
      <LaneCtl btnRef={settingsBtnRef} active={settingsActive} title="Lane settings — name, WIP limit, policy" onClick={onSettings}>
        <Settings size={12} />
      </LaneCtl>
    </CtlGroup>
  )
}

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A drop target for one cell. Extracted so the cards workflow (BoardCanvas) and the
 * initiatives workflow (BoardSummary) share the same drag gesture — an initiative is
 * dragged between the cells of its section exactly like a card is between lanes.
 */
export function DroppableCell({
  laneId,
  enabled,
  onDropItem,
  children,
}: {
  laneId: string
  enabled: boolean
  onDropItem: (itemId: string) => void
  children: React.ReactNode
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      data-lane-id={laneId}
      onDragOver={(e) => {
        if (!enabled) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!enabled) return
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData('text/plain')
        if (id) onDropItem(id)
      }}
      className={cn(
        'flex min-h-[96px] flex-1 flex-col gap-1 p-1 transition',
        enabled && over ? 'bg-indigo-300/50 ring-1 ring-inset ring-indigo-500' : 'bg-transparent',
      )}
    >
      {children}
    </div>
  )
}

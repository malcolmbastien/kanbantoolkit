import { afterEach, describe, expect, it } from 'vitest'
import { useDrag } from './drag'

describe('the drag store', () => {
  afterEach(() => {
    useDrag.setState({ dragPreview: null, dropTargetId: null })
  })

  it('does not wake a listener when a pointer move names the same gap', () => {
    let changes = 0
    const stop = useDrag.subscribe(() => {
      changes += 1
    })
    const preview = { itemId: 'i-1', height: 80, laneId: 'l-1', index: 2 }
    useDrag.getState().setDragPreview(preview)
    useDrag.getState().setDragPreview({ ...preview })
    useDrag.getState().setDropTarget('init-1')
    useDrag.getState().setDropTarget('init-1')
    expect(changes).toBe(2)
    stop()
  })
})

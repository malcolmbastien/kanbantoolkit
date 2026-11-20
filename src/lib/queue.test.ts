import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '@/domain/types'
import { QUEUE_LIMIT, newKey, queue } from './queue'
import { useStorageStatus } from './storage'

const data = new Map<string, string>()
/** The browser refuses to store anything, as a full disk or a locked-down private window does. */
let refusing = false

vi.stubGlobal('localStorage', {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (refusing) throw new Error('no room')
    data.set(key, value)
  },
  removeItem: (key: string) => {
    data.delete(key)
  },
})

const card = (id: string, title = 'A card'): Item => ({ id, title, typeId: 't-card', createdAt: 1 })
const entry = (id: string, baseRev = 0) => ({ key: newKey(), item: card(id), baseRev, at: Date.now() })

describe('the queue of changes that have not been sent', () => {
  beforeEach(() => {
    data.clear()
    refusing = false
    useStorageStatus.setState({ failed: false, queueFailed: false })
  })

  it('keeps them in the order they were made, across a reload', () => {
    queue.add(entry('i-1'))
    queue.add(entry('i-2'))

    // Reading is the same thing a fresh page does: the queue is the stored list, not module state.
    expect(queue.all().map((queued) => queued.item.id)).toEqual(['i-1', 'i-2'])
    expect(queue.size()).toBe(2)
  })

  it('forgets one that the server has answered', () => {
    const first = entry('i-1')
    queue.add(first)
    queue.add(entry('i-2'))

    queue.remove(first.key)
    expect(queue.all().map((queued) => queued.item.id)).toEqual(['i-2'])
  })

  it('keeps the parent a hierarchy change carried, and a detach as null', () => {
    queue.add({ ...entry('i-1'), parentId: 'i-parent' })
    queue.add({ ...entry('i-2'), parentId: null })

    // A retry after a reload is the same change: the edge beside the item must travel with it.
    expect(queue.all().map((queued) => queued.parentId)).toEqual(['i-parent', null])
  })

  it('says when it is full rather than dropping the oldest work', () => {
    for (let index = 0; index < QUEUE_LIMIT; index++) queue.add(entry(`i-${index}`))
    expect(queue.size()).toBe(QUEUE_LIMIT)
    expect(queue.add(entry('i-one-too-many'))).toBe(false)
    expect(queue.size()).toBe(QUEUE_LIMIT)
  })

  it('says when a change could not be stored, and stops saying it when one can', () => {
    refusing = true
    // Not held is the answer the caller needs: the change lives only in memory.
    expect(queue.add(entry('i-1'))).toBe(false)
    expect(useStorageStatus.getState().queueFailed).toBe(true)
    expect(queue.size()).toBe(0)

    refusing = false
    expect(queue.add(entry('i-2'))).toBe(true)
    expect(useStorageStatus.getState().queueFailed).toBe(false)
    expect(queue.size()).toBe(1)
  })

  it('is empty rather than broken when the stored value is not a queue', () => {
    data.set('kanbantoolkit-queue-v1', '{"not":"a queue"}')
    expect(queue.all()).toEqual([])

    data.set('kanbantoolkit-queue-v1', 'not json at all')
    expect(queue.all()).toEqual([])
  })
})

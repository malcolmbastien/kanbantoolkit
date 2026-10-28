import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '@/domain/types'
import { QUEUE_LIMIT, newKey, queue } from './queue'

const data = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
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

  it('says when it is full rather than dropping the oldest work', () => {
    for (let index = 0; index < QUEUE_LIMIT; index++) queue.add(entry(`i-${index}`))
    expect(queue.size()).toBe(QUEUE_LIMIT)
    expect(queue.add(entry('i-one-too-many'))).toBe(false)
    expect(queue.size()).toBe(QUEUE_LIMIT)
  })

  it('is empty rather than broken when the stored value is not a queue', () => {
    data.set('kanbantoolkit-queue-v1', '{"not":"a queue"}')
    expect(queue.all()).toEqual([])

    data.set('kanbantoolkit-queue-v1', 'not json at all')
    expect(queue.all()).toEqual([])
  })
})

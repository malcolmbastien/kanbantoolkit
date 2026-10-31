/**
 * The outbound events a webhook can subscribe to.
 *
 * This is a contract with the receiver, so the names are stable and the list is closed. An
 * endpoint with no event types subscribes to every one of them; that is the default, because a
 * receiver usually starts by watching everything and narrows later.
 */
export const WEBHOOK_EVENT_TYPES = [
  'item.created',
  'item.moved',
  'item.blocked',
  'item.unblocked',
  'initiative.health_changed',
  'objective.mapped',
  'objective.unmapped',
  'webhook.test',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'item.created': 'A card or initiative is created',
  'item.moved': 'A card moves between columns',
  'item.blocked': 'A card is blocked',
  'item.unblocked': 'A card is unblocked',
  'initiative.health_changed': 'An initiative’s health changes',
  'objective.mapped': 'An initiative is mapped to an objective',
  'objective.unmapped': 'An initiative is unmapped from an objective',
  'webhook.test': 'A test delivery from the admin screen',
}

/** An endpoint as the admin screen reads it: the secret is present only when it was just made. */
export interface WebhookEndpointView {
  id: string
  url: string
  eventTypes: WebhookEventType[]
  active: boolean
  createdAt: number
  disabledReason?: string
  /** Returned only by create; a read never carries it again. */
  secret?: string
}

export interface WebhookDeliveryView {
  id: string
  eventId: string
  eventType: WebhookEventType
  status: 'pending' | 'delivering' | 'delivered' | 'failed'
  attempts: number
  nextAttemptAt: number
  responseStatus?: number
  error?: string
  createdAt: number
  updatedAt: number
}

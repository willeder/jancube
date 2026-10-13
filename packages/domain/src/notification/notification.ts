import { DomainError } from '../shared/errors'

export type NotificationChannel = 'line' | 'email' | 'sms'

/** Customer notifications (L-04 / A-21). Stored as `notification_templates.event_type`. */
export const NOTIFICATION_EVENTS = [
  'booking_confirmed',
  'room_assigned',
  'booking_changed',
  'booking_canceled',
  'refund_completed',
  'coupon_granted',
  'payment_link',
  'usage_reminder',
] as const
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]

/** Where a member can be reached. */
export interface Reachability {
  /** LINE linked and the account is a friend (blocked accounts get no LINE fallback, tracker 10/7). */
  readonly line: boolean
  readonly email: boolean
  readonly sms: boolean
}

/**
 * F-NTF-07: LINE when linked, otherwise email when registered; with neither, the information is only
 * shown on screen. Each template lists its channels in priority order (A-21); the first reachable
 * one is used. SMS is used only where a template enables it (sign-in codes, payment links).
 */
export function chooseChannel(
  enabledByPriority: readonly NotificationChannel[],
  reach: Reachability,
): NotificationChannel | null {
  return enabledByPriority.find((channel) => reach[channel]) ?? null
}

const VARIABLE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

/** Variables used by a template body, e.g. `{{storeName}}`. */
export function templateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VARIABLE)].map((m) => m[1] as string))]
}

/**
 * Fills `{{name}}` placeholders. Every placeholder must have a value, so a typo in a template is
 * caught when it is published rather than sent to a customer.
 */
export function renderTemplate(body: string, values: Readonly<Record<string, string>>): string {
  return body.replace(VARIABLE, (_match, name: string) => {
    const value = values[name]
    if (value === undefined) {
      throw new DomainError('template_variable_missing', `no value for {{${name}}}`)
    }
    return value
  })
}

/** Rejects templates that use variables the event does not provide (A-21 publish check). */
export function assertTemplateVariables(body: string, allowed: readonly string[]): void {
  const unknown = templateVariables(body).filter((v) => !allowed.includes(v))
  if (unknown.length > 0) {
    throw new DomainError('template_variable_unknown', `unknown variables: ${unknown.join(', ')}`)
  }
}

/** Retry schedule for failed sends: 1, 5, 15, 60 minutes, then give up and raise an alert. */
export const NOTIFICATION_RETRY_MINUTES = [1, 5, 15, 60] as const

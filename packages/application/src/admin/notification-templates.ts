import {
  assertCan,
  assertTemplateVariables,
  DomainError,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
  renderTemplate,
  visibleStoreIds,
} from '@jancube/domain'
import { TEMPLATE_SAMPLE_VALUES, TEMPLATE_VARIABLES } from '../notifications/template-variables'
import type { TemplateAdminRepository } from '../ports/admin-masters'
import type { Clock } from '../ports/clock'
import type { AuditLog } from '../ports/ops'
import { auditActor, optionalText, type StaffActor } from './admin-actor'

export interface TemplateAdminDeps {
  readonly templates: TemplateAdminRepository
  readonly audit: AuditLog
  readonly clock: Clock
}

const CHANNELS: readonly NotificationChannel[] = ['line', 'email', 'sms']
/** LINE text messages allow 5,000 characters; SMS is kept to 670 (10 concatenated parts). */
const MAX_BODY: Readonly<Record<NotificationChannel, number>> = {
  line: 5000,
  email: 10_000,
  sms: 670,
}

export function parseEvent(value: string): NotificationEvent {
  const event = NOTIFICATION_EVENTS.find((e) => e === value)
  if (!event) throw new DomainError('invalid_template', 'unknown notification event')
  return event
}

export function parseChannel(value: string): NotificationChannel {
  const channel = CHANNELS.find((c) => c === value)
  if (!channel) throw new DomainError('invalid_template', 'unknown channel')
  return channel
}

/**
 * A-21 公開前チェック: required texts, length per channel and only the variables the event
 * provides (`assertTemplateVariables`); then renders with sample values.
 */
export function checkTemplateContent(
  event: NotificationEvent,
  channel: NotificationChannel,
  content: { subject: string | null; body: string },
) {
  const body = content.body.replace(/\r\n/g, '\n').trim()
  const subject = channel === 'email' ? (content.subject?.trim() ?? '') : null
  if (!body) throw new DomainError('template_body_required', 'body is required')
  if (body.length > MAX_BODY[channel]) {
    throw new DomainError('template_too_long', `body is longer than ${MAX_BODY[channel]}`)
  }
  if (channel === 'email' && (!subject || subject.length > 250)) {
    throw new DomainError('template_subject_required', 'email needs a subject (max 250)')
  }
  const allowed = TEMPLATE_VARIABLES[event]
  assertTemplateVariables(body, allowed)
  if (subject) assertTemplateVariables(subject, allowed)
  return {
    subject,
    body,
    preview: {
      subject: subject ? renderTemplate(subject, TEMPLATE_SAMPLE_VALUES) : null,
      body: renderTemplate(body, TEMPLATE_SAMPLE_VALUES),
    },
  }
}

function assertTemplateStore(actor: StaffActor, storeId: number | null) {
  if (storeId === null) {
    if (visibleStoreIds(actor.access, 'notifications.manage') !== null) {
      throw new DomainError('forbidden', 'all-store templates need an all-store grant')
    }
  } else {
    assertCan(actor.access, 'notifications.manage', storeId)
  }
}

/** A-21 一覧 (store-specific templates only for the stores the staff member manages). */
export function makeListTemplates(deps: TemplateAdminDeps) {
  return async function listTemplates(actor: StaffActor) {
    assertCan(actor.access, 'notifications.manage')
    const visible = visibleStoreIds(actor.access, 'notifications.manage')
    const rows = await deps.templates.list()
    return visible === null
      ? rows
      : rows.filter((r) => r.storeId === null || visible.includes(r.storeId))
  }
}

export function makeGetTemplate(deps: TemplateAdminDeps) {
  return async function getTemplate(actor: StaffActor, templateId: number) {
    assertCan(actor.access, 'notifications.manage')
    const template = await deps.templates.find(templateId)
    if (!template) throw new DomainError('template_not_found', 'template not found')
    if (template.storeId !== null) assertCan(actor.access, 'notifications.manage', template.storeId)
    return { template, variables: TEMPLATE_VARIABLES[template.event] }
  }
}

/** A-21 プレビュー (no side effects). */
export function makePreviewTemplate() {
  return function previewTemplate(
    actor: StaffActor,
    input: { event: string; channel: string; subject: string | null; body: string },
  ) {
    assertCan(actor.access, 'notifications.manage')
    return checkTemplateContent(parseEvent(input.event), parseChannel(input.channel), input).preview
  }
}

/** A-21 追加: a template for an event/channel (all stores or one store) with its first version. */
export function makeCreateTemplate(deps: TemplateAdminDeps) {
  return async function createTemplate(
    actor: StaffActor,
    input: {
      event: string
      channel: string
      storeId: number | null
      priority: number
      isEnabled: boolean
      subject: string | null
      body: string
      entryGuideUrl?: string | null
    },
  ): Promise<number> {
    const event = parseEvent(input.event)
    const channel = parseChannel(input.channel)
    assertTemplateStore(actor, input.storeId)
    assertPriority(input.priority)
    const content = checkTemplateContent(event, channel, input)
    const entryGuideUrl = checkUrl(input.entryGuideUrl)
    if (await deps.templates.exists(event, channel, input.storeId)) {
      throw new DomainError('template_exists', 'a template for this event and channel exists')
    }
    const templateId = await deps.templates.create({
      event,
      channel,
      storeId: input.storeId,
      isEnabled: input.isEnabled,
      priority: input.priority,
    })
    const now = deps.clock.now()
    const versionNo = await deps.templates.publishVersion(
      templateId,
      {
        subject: content.subject,
        body: content.body,
        variables: TEMPLATE_VARIABLES[event],
        entryGuideUrl,
      },
      actor.staffId,
      now,
    )
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'notification_template.create',
      targetType: 'notification_template',
      targetId: templateId,
      storeId: input.storeId,
      after: { event, channel, isEnabled: input.isEnabled, priority: input.priority, versionNo },
    })
    return templateId
  }
}

function assertPriority(priority: number) {
  if (!Number.isInteger(priority) || priority < 1 || priority > 99) {
    throw new DomainError('invalid_template', 'priority must be 1-99')
  }
}

function checkUrl(url: string | null | undefined): string | null {
  const value = optionalText(url, 1000)
  if (value && !/^https?:\/\/\S+$/.test(value)) {
    throw new DomainError('invalid_template', 'entry guide must be an http(s) URL')
  }
  return value
}

/** A-21 有効/無効・チャネル優先順位. */
export function makeUpdateTemplateSettings(deps: TemplateAdminDeps) {
  return async function updateTemplateSettings(
    actor: StaffActor,
    templateId: number,
    input: { isEnabled: boolean; priority: number },
  ): Promise<void> {
    const template = await deps.templates.find(templateId)
    if (!template) throw new DomainError('template_not_found', 'template not found')
    assertTemplateStore(actor, template.storeId)
    assertPriority(input.priority)
    await deps.templates.update(templateId, input)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'notification_template.update',
      targetType: 'notification_template',
      targetId: templateId,
      storeId: template.storeId,
      before: { isEnabled: template.isEnabled, priority: template.priority },
      after: input,
    })
  }
}

/**
 * A-21 文面の公開: a new version; the newest version is sent from now on. Deliveries already
 * queued keep the text they were rendered with (F-NTF-09).
 */
export function makePublishTemplateVersion(deps: TemplateAdminDeps) {
  return async function publishTemplateVersion(
    actor: StaffActor,
    templateId: number,
    input: { subject: string | null; body: string; entryGuideUrl?: string | null },
  ): Promise<number> {
    const template = await deps.templates.find(templateId)
    if (!template) throw new DomainError('template_not_found', 'template not found')
    assertTemplateStore(actor, template.storeId)
    const content = checkTemplateContent(template.event, template.channel, input)
    const entryGuideUrl = checkUrl(input.entryGuideUrl)
    const versionNo = await deps.templates.publishVersion(
      templateId,
      {
        subject: content.subject,
        body: content.body,
        variables: TEMPLATE_VARIABLES[template.event],
        entryGuideUrl,
      },
      actor.staffId,
      deps.clock.now(),
    )
    const previous = template.versions[0]
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'notification_template.publish',
      targetType: 'notification_template',
      targetId: templateId,
      storeId: template.storeId,
      before: previous
        ? { versionNo: previous.versionNo, subject: previous.subject, body: previous.body }
        : null,
      after: { versionNo, subject: content.subject, body: content.body, entryGuideUrl },
    })
    return versionNo
  }
}

import {
  type AssignmentPlanInput,
  addDays,
  dayBeforeCutoff,
  isFinalizeDue,
  isPreparationDue,
  type LocalDate,
  localDateOf,
  localToUtc,
  openingWindow,
  planCleaningTasks,
  planRoomAssignments,
  type TimeRange,
} from '@jancube/domain'
import {
  BOOKING_TEMPLATE_VARIABLES,
  type makeNotifyBooking,
} from '../notifications/booking-notifications'
import type { BookingRepository } from '../ports/booking-repository'
import type { Clock } from '../ports/clock'
import type {
  AccessKeyRecord,
  AssignmentContext,
  CleaningRepository,
  OperationsRepository,
  OpsBooking,
  OpsStore,
} from '../ports/operations'
import type { AuditLog, BatchRunRepository, OutboxEvent } from '../ports/ops'
import type { StoreRepository } from '../ports/store-repository'
import { formatLocalDateTime, type KeyDeps, makeKeyOperations } from './access-keys'

export interface OperationsDeps extends KeyDeps {
  readonly ops: OperationsRepository
  readonly bookings: Pick<BookingRepository, 'withInventoryLock'>
  readonly cleaning: CleaningRepository
  readonly stores: Pick<StoreRepository, 'weeklyHours' | 'calendarOverrides'>
  readonly batchRuns: BatchRunRepository
  readonly audit: AuditLog
  readonly notifyBooking: ReturnType<typeof makeNotifyBooking>
  readonly clock: Clock
}

/** The day-before batch and the catch-up job must not process the same booking at once. */
const CATCH_UP_DELAY_MINUTES = 15

/** Variables of the room_assigned notice (A-21 shows this list; entryCode is never stored in clear). */
export const ROOM_ASSIGNED_TEMPLATE_VARIABLES = [
  ...BOOKING_TEMPLATE_VARIABLES,
  'entryCode',
  'codeValidFrom',
  'codeValidTo',
  'previousRoomName',
] as const

/** Variables of the booking_canceled notice. */
export const BOOKING_CANCELED_TEMPLATE_VARIABLES = [
  ...BOOKING_TEMPLATE_VARIABLES,
  'cancellationFee',
  'refundAmount',
] as const

const yen = (amount: number) => `${amount.toLocaleString('ja-JP')}円`

/**
 * Turns the locked assignment context into the planner's input for one business date.
 * Bookings with a room (assigned, or named on another date) are placed; confirmed bookings of the
 * date without an assignment are pending; everything else that still needs a room is reserve.
 */
export function assignmentPlanInput(
  ctx: AssignmentContext,
  date: LocalDate,
  now: Date,
): AssignmentPlanInput {
  const dayStart = localToUtc(date, 0, ctx.timezone)
  const isPending = (b: AssignmentContext['bookings'][number]) =>
    b.status === 'confirmed' && b.businessDate === date && b.assignedRoomId === null
  const placed = ctx.bookings.flatMap((b) => {
    const roomId = b.assignedRoomId ?? (isPending(b) ? null : b.requestedRoomId)
    return roomId === null ? [] : [{ bookingId: b.bookingId, roomId, range: b.range }]
  })
  const occupiedBefore = (roomId: number) =>
    ctx.bookings.some(
      (b) =>
        b.status !== 'draft' &&
        (b.assignedRoomId ?? b.requestedRoomId) === roomId &&
        b.range.end > now &&
        b.range.start < dayStart,
    )
  return {
    rooms: ctx.rooms.map((r) => ({
      roomId: r.roomId,
      sortOrder: r.sortOrder,
      clean: r.cleaningStatus === 'clean' && !occupiedBefore(r.roomId),
      usageMinutes: r.usageMinutes,
      blocks: r.blocks,
    })),
    placed,
    pending: ctx.bookings
      .filter(isPending)
      .map((b) => ({ bookingId: b.bookingId, range: b.range, requestedRoomId: b.requestedRoomId })),
    reserve: ctx.bookings
      .filter((b) => !isPending(b) && b.assignedRoomId === null && b.requestedRoomId === null)
      .map((b) => b.range),
    bufferMinutes: ctx.bufferMinutes,
  }
}

export function makeOperations(deps: OperationsDeps) {
  const keyOps = makeKeyOperations(deps)

  async function requireStore(storeId: number): Promise<OpsStore> {
    const store = await deps.ops.store(storeId)
    if (!store) throw new Error(`store ${storeId} not found`)
    return store
  }

  /** F-RM-04: assigns every confirmed booking of the group and date that has no room yet. */
  async function assignGroup(roomGroupId: number, date: LocalDate) {
    const now = deps.clock.now()
    return deps.bookings.withInventoryLock(roomGroupId, date, async (tx) => {
      const ctx = await tx.assignmentContext(roomGroupId, date, now)
      const plan = planRoomAssignments(assignmentPlanInput(ctx, date, now))
      for (const a of plan.assigned) {
        await tx.assignRoom({
          bookingId: a.bookingId,
          roomId: a.roomId,
          status: 'final',
          source: a.source,
          staffId: null,
          reason: null,
          at: now,
        })
      }
      return plan
    })
  }

  async function raiseUnassigned(store: OpsStore, bookingIds: readonly number[]) {
    for (const bookingId of bookingIds) {
      await deps.alerts.raise({
        alertKey: `assignment_failed:${bookingId}`,
        alertType: 'room_assignment_failed',
        severity: 'critical',
        failureReason: '空き部屋が見つからず、部屋を割り当てられませんでした',
        recoverySteps:
          '予約状況で重複・ブロックを確認し、割当変更(A-07)で部屋を割り当ててください。割当後に鍵と通知が処理されます。',
        storeId: store.id,
        bookingId,
        detectedAt: deps.clock.now(),
      })
    }
  }

  /** F-CLN-02: (re)plans the cleaning tasks of a business date from the current assignments. */
  async function syncCleaning(store: OpsStore, date: LocalDate) {
    const now = deps.clock.now()
    const mode = localDateOf(now, store.timezone) < date ? 'day_before' : 'same_day'
    const dayStart = localToUtc(date, 0, store.timezone)
    const [rooms, tasks, uses, weekly, overrides] = await Promise.all([
      deps.cleaning.rooms(store.id),
      deps.cleaning.tasks(store.id, date),
      deps.cleaning.roomUses(
        store.id,
        now < dayStart ? now : dayStart,
        localToUtc(addDays(date, 2), 0, store.timezone),
      ),
      deps.stores.weeklyHours(store.id),
      deps.stores.calendarOverrides(store.id, date, date),
    ])
    const window = openingWindow(
      date,
      store.timezone,
      weekly,
      overrides.find((o) => o.date === date),
    )
    const planned = planCleaningTasks({
      businessDate: date,
      mode,
      now,
      opensAt: window?.opensAt ?? null,
      rooms: rooms.map((r) => ({
        roomId: r.roomId,
        dirty: r.cleaningStatus === 'dirty',
        hasOpeningTask: tasks.some(
          (t) => t.roomId === r.roomId && t.taskType === 'opening' && t.status !== 'canceled',
        ),
      })),
      uses,
    })
    return deps.cleaning.syncTasks(store.id, date, planned, now)
  }

  /** room_assigned notice (F-NTF-02): room number and entrance code, once per code and room. */
  async function notifyRoomAssigned(
    booking: OpsBooking,
    store: OpsStore,
    key: AccessKeyRecord,
    resend = false,
    previousRoomName = '',
  ) {
    if (!booking.assignment) return null
    const code = await keyOps.decryptCode(key)
    if (!code) return null
    return deps.notifyBooking(booking.id, 'room_assigned', {
      values: {
        entryCode: code,
        codeValidFrom: formatLocalDateTime(key.validFrom, store.timezone),
        codeValidTo: formatLocalDateTime(key.validTo, store.timezone),
        previousRoomName: previousRoomName ? `変更前のお部屋：${previousRoomName}` : '',
      },
      secretValueNames: ['entryCode'],
      dedupSuffix: resend
        ? `resend:${deps.clock.now().getTime()}`
        : `${key.id}:${booking.assignment.roomId}`,
    })
  }

  /**
   * Gets one booking ready once its day-before time has passed: room, cleaning plan, code, notice.
   * Used for late bookings, changes and the catch-up job. Idempotent.
   */
  async function prepareBooking(bookingId: number) {
    const now = deps.clock.now()
    let booking = await deps.ops.booking(bookingId)
    if (booking?.status !== 'confirmed') return 'skipped' as const
    const store = await requireStore(booking.storeId)
    if (!isPreparationDue(booking.businessDate, store.timezone, now)) return 'not_due' as const
    if (booking.end <= now) return 'skipped' as const
    if (!booking.assignment) {
      const plan = await assignGroup(booking.roomGroupId, booking.businessDate)
      await raiseUnassigned(store, plan.unassigned)
      booking = (await deps.ops.booking(bookingId)) ?? booking
    }
    await syncCleaning(store, booking.businessDate)
    await finalizeAssignments()
    const key = await keyOps.ensureKey(booking, store)
    if (key.status === 'issued' && key.key) {
      await notifyRoomAssigned(booking, store, key.key)
      return 'ready' as const
    }
    return 'key_pending' as const
  }

  /**
   * Day-before batch (cron 20:00 JST; F-RM-04, F-CLN-02, F-KEY-01, F-NTF-02): for each store and
   * tomorrow's business date, assign rooms, plan cleaning, issue codes and send the notices.
   * Recorded in batch_runs once per store and date, so a second run does nothing.
   */
  async function runDayBeforeBatch(
    options: { storeId?: number; date?: LocalDate; triggeredBy?: number | null } = {},
  ) {
    const now = deps.clock.now()
    const stores = (await deps.ops.activeStores()).filter(
      (s) => options.storeId === undefined || s.id === options.storeId,
    )
    const results: {
      storeId: number
      date: LocalDate
      status: string
      processed: number
      failed: number
    }[] = []
    for (const store of stores) {
      const date = options.date ?? addDays(localDateOf(now, store.timezone), 1)
      const runId = await deps.batchRuns.start({
        jobType: 'day_before',
        businessDate: date,
        storeId: store.id,
        runKey: `day_before:${store.id}:${date}`,
        startedAt: now,
        triggeredBy: options.triggeredBy ?? null,
      })
      if (runId === null) {
        results.push({ storeId: store.id, date, status: 'already_ran', processed: 0, failed: 0 })
        continue
      }
      let processed = 0
      let failed = 0
      const errors: string[] = []
      try {
        await checkDevice(store, date)
        const bookings = await deps.ops.bookingsOn(store.id, date, ['confirmed'])
        const groups = [...new Set(bookings.filter((b) => !b.assignment).map((b) => b.roomGroupId))]
        for (const groupId of groups) {
          const plan = await assignGroup(groupId, date)
          await raiseUnassigned(store, plan.unassigned)
        }
        await syncCleaning(store, date)
        await finalizeAssignments()
        for (const original of bookings) {
          try {
            const booking = (await deps.ops.booking(original.id)) ?? original
            const key = await keyOps.ensureKey(booking, store)
            if (key.status === 'issued' && key.key && booking.assignment) {
              await notifyRoomAssigned(booking, store, key.key)
              processed++
            } else {
              failed++
              await raiseKeyMissing(store, booking)
            }
          } catch (error) {
            failed++
            errors.push(
              `${original.bookingCode}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        await deps.batchRuns.finish(runId, {
          status: 'completed',
          processed,
          failed,
          errorSummary: errors.length ? errors.join('\n').slice(0, 2000) : null,
          finishedAt: deps.clock.now(),
        })
        results.push({ storeId: store.id, date, status: 'completed', processed, failed })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await deps.batchRuns.finish(runId, {
          status: 'failed',
          processed,
          failed,
          errorSummary: message.slice(0, 2000),
          finishedAt: deps.clock.now(),
        })
        await deps.alerts.raise({
          alertKey: `batch_failed:day_before:${store.id}:${date}`,
          alertType: 'job_failed',
          severity: 'critical',
          failureReason: `前日バッチが失敗しました (${store.code} ${date}): ${message}`.slice(
            0,
            2000,
          ),
          recoverySteps:
            '原因を解消後、未割当・未発行の予約は毎分の補完処理で順次処理されます。状況を鍵状況・清掃状況画面で確認してください。',
          storeId: store.id,
          detectedAt: deps.clock.now(),
        })
        results.push({ storeId: store.id, date, status: 'failed', processed, failed })
      }
    }
    return results
  }

  /** F-KEY-07: a booking still has no code after the batch. */
  async function raiseKeyMissing(store: OpsStore, booking: OpsBooking) {
    await deps.alerts.raise({
      alertKey: `key_missing:${booking.id}`,
      alertType: 'key_missing',
      severity: 'critical',
      failureReason: booking.assignment
        ? '前日バッチ後も入室コードが発行されていません。お客様に部屋番号・入室コードが届いていません'
        : '部屋が割り当てられていないため、お客様への前日通知が送られていません',
      recoverySteps:
        '鍵状況画面(A-09)で再発行してください。復旧できない場合は店舗スタッフによる手動解錠で対応し、お客様へご連絡ください。',
      storeId: store.id,
      bookingId: booking.id,
      detectedAt: deps.clock.now(),
    })
  }

  /** F-KEY-08: communication check of the entrance lock before codes are issued. */
  async function checkDevice(store: OpsStore, date: LocalDate) {
    const device = await deps.devices.activeForStore(store.id)
    if (!device) return
    const now = deps.clock.now()
    try {
      const status = await deps.provider.status(device)
      await deps.devices.recordStatus(device.id, { ...status, at: now })
      if (status.communication === 'offline') {
        await deps.alerts.raise({
          alertKey: `lock_offline:${device.id}:${date}`,
          alertType: 'lock_offline',
          severity: 'warning',
          failureReason: `鍵デバイス ${device.name} と通信できません${status.detail ? ` (${status.detail})` : ''}`,
          recoverySteps:
            '鍵デバイスの電源・通信を確認し、鍵デバイス管理(A-20)で疎通テストを行ってください。',
          storeId: store.id,
          lockDeviceId: device.id,
          detectedAt: now,
        })
      }
    } catch (error) {
      await deps.devices.recordStatus(device.id, {
        communication: 'offline',
        batteryPercent: null,
        at: now,
      })
      await deps.keys.recordEvent({
        accessKeyId: null,
        lockDeviceId: device.id,
        bookingId: null,
        eventType: 'status_check',
        result: 'failure',
        requestKey: null,
        attemptNo: 1,
        errorCode: 'status_failed',
        details: {
          message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        },
        at: now,
      })
    }
  }

  async function releaseAssignment(booking: OpsBooking, reason: string) {
    if (!booking.assignment) return
    await deps.bookings.withInventoryLock(booking.roomGroupId, booking.businessDate, (tx) =>
      tx.releaseAssignment(booking.id, deps.clock.now(), reason),
    )
  }

  /** Outbox `booking.canceled`: revoke the code, free the room, re-plan cleaning, notify. */
  async function onBookingCanceled(event: OutboxEvent) {
    const booking = await deps.ops.booking(event.aggregateId)
    if (!booking) return
    const store = await requireStore(booking.storeId)
    // Failed revocations stay revoke_pending and are retried by the minute job.
    await keyOps.revokeKeys(booking.id)
    await releaseAssignment(booking, 'booking canceled')
    if (isPreparationDue(booking.businessDate, store.timezone, deps.clock.now())) {
      await syncCleaning(store, booking.businessDate)
    }
    if (booking.status === 'canceled') {
      const amounts = await deps.ops.cancellation(booking.id)
      await deps.notifyBooking(booking.id, 'booking_canceled', {
        values: {
          cancellationFee: yen(amounts?.fee ?? 0),
          refundAmount: yen(amounts?.refund ?? 0),
        },
      })
    }
  }

  /**
   * Outbox `booking.changed` (payload: `{ previousBusinessDate?: 'YYYY-MM-DD' }`), produced by the
   * booking-change feature. Keeps the room if it is still free at the new time, otherwise assigns
   * again; the code follows the new time (F-KEY-04) and the customer gets the new details.
   */
  async function onBookingChanged(event: OutboxEvent) {
    const now = deps.clock.now()
    const booking = await deps.ops.booking(event.aggregateId)
    if (!booking) return
    const store = await requireStore(booking.storeId)
    const previous = event.payload.previousBusinessDate
    if (
      typeof previous === 'string' &&
      previous !== booking.businessDate &&
      isPreparationDue(previous, store.timezone, now)
    ) {
      await syncCleaning(store, previous)
    }
    if (booking.status !== 'confirmed') return

    if (!isPreparationDue(booking.businessDate, store.timezone, now)) {
      // Moved to a later date: the day-before batch of that date handles it.
      await keyOps.revokeKeys(booking.id)
      await releaseAssignment(booking, 'booking moved to a later date')
      return
    }
    if (booking.assignment) {
      const assignment = booking.assignment
      await deps.bookings.withInventoryLock(
        booking.roomGroupId,
        booking.businessDate,
        async (tx) => {
          const ctx = await tx.assignmentContext(booking.roomGroupId, booking.businessDate, now)
          const input = assignmentPlanInput(ctx, booking.businessDate, now)
          const range: TimeRange = { start: booking.start, end: booking.end }
          const room = ctx.rooms.find((r) => r.roomId === assignment.roomId)
          const clash = input.placed.some(
            (p) =>
              p.bookingId !== booking.id &&
              p.roomId === assignment.roomId &&
              p.range.start.getTime() < range.end.getTime() + ctx.bufferMinutes * 60_000 &&
              range.start.getTime() < p.range.end.getTime() + ctx.bufferMinutes * 60_000,
          )
          const blocked =
            room?.blocks.some((b) => b.start < range.end && range.start < b.end) ?? true
          if (clash || blocked) await tx.releaseAssignment(booking.id, now, 'booking changed')
        },
      )
    }
    const refreshed = (await deps.ops.booking(booking.id)) ?? booking
    await keyOps.followBookingTime(refreshed, store)
    await prepareBooking(booking.id)
  }

  /** Outbox `booking.confirmed`: bookings made after their day-before batch are prepared at once. */
  async function onBookingConfirmed(event: OutboxEvent) {
    await prepareBooking(event.aggregateId)
  }

  /** F-RM-05: provisional assignments become final at previous-day 20:00 local time. */
  async function finalizeAssignments() {
    const now = deps.clock.now()
    const candidates = await deps.ops.provisionalAssignments(
      new Date(now.getTime() + 48 * 3_600_000),
    )
    const due = candidates.filter((c) =>
      c.businessDate && c.timezone
        ? now >= dayBeforeCutoff(c.businessDate, c.timezone)
        : isFinalizeDue(c.start, now, c.finalizeMinutes),
    )
    return due.length
      ? deps.ops.finalizeAssignments(
          due.map((c) => c.assignmentId),
          now,
        )
      : 0
  }

  /** Bookings whose day-before time has passed but that never got a code (missed events). */
  async function catchUp(limit = 20) {
    const now = deps.clock.now()
    const ids = await deps.ops.bookingsWithoutKey(
      now,
      new Date(now.getTime() + 36 * 3_600_000),
      limit,
    )
    let prepared = 0
    for (const id of ids) {
      const booking = await deps.ops.booking(id)
      if (!booking) continue
      const store = await requireStore(booking.storeId)
      const cutoff = dayBeforeCutoff(booking.businessDate, store.timezone)
      if (now.getTime() - cutoff.getTime() < CATCH_UP_DELAY_MINUTES * 60_000) continue
      const result = await prepareBooking(id)
      if (result === 'ready' || result === 'key_pending') prepared++
    }
    return prepared
  }

  /** Minute job additions: finalize rooms, retry lock API calls, catch up, mark used rooms dirty. */
  async function runMinute() {
    const finalized = await finalizeAssignments()
    const keys = await keyOps.processPendingWork(
      async (bookingId) => (await deps.ops.booking(bookingId))?.status === 'confirmed',
      async (key) => {
        const booking = await deps.ops.booking(key.bookingId)
        if (!booking) return
        const store = await requireStore(booking.storeId)
        if (isPreparationDue(booking.businessDate, store.timezone, deps.clock.now())) {
          await notifyRoomAssigned(booking, store, key)
        }
      },
    )
    const expiredKeys = await deps.keys.expireKeys(deps.clock.now())
    const caughtUp = await catchUp()
    const dirtied = await deps.ops.markUsedRoomsDirty(deps.clock.now())
    return { finalized, keys, expiredKeys, caughtUp, dirtied }
  }

  return {
    keyOps,
    assignGroup,
    syncCleaning,
    notifyRoomAssigned,
    prepareBooking,
    runDayBeforeBatch,
    onBookingCanceled,
    onBookingChanged,
    onBookingConfirmed,
    finalizeAssignments,
    runMinute,
    requireStore,
  }
}

export type Operations = ReturnType<typeof makeOperations>

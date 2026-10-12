import {
  assertCan,
  checkRoomChange,
  DomainError,
  isPreparationDue,
  type LocalDate,
  type StaffAccess,
  utcToLocal,
} from '@jancube/domain'
import type {
  AccessKeyRecord,
  KeyEvent,
  LockDevice,
  LockDeviceInput,
  OpsBooking,
} from '../ports/operations'
import { formatLocalDateTime, isIssued, isLive } from './access-keys'
import { assignmentPlanInput, type Operations, type OperationsDeps } from './preparation'

/** The signed-in staff member performing an admin action. */
export interface StaffActor {
  readonly staffId: number
  readonly access: StaffAccess
}

export interface RoomOption {
  readonly roomId: number
  readonly code: string
  readonly name: string
  readonly cleaningStatus: 'clean' | 'dirty'
  readonly current: boolean
  readonly available: boolean
  /** Why the room cannot be chosen (Japanese, for the screen). */
  readonly problem: string | null
}

export interface KeyListRow {
  readonly booking: OpsBooking
  readonly key: AccessKeyRecord | null
}

const hhmm = (instant: Date, timeZone: string) => {
  const m = utcToLocal(instant, timeZone).minuteOfDay
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Staff screens of rooms, keys and lock devices: A-07 割当変更, A-09 鍵状況, A-20 鍵デバイス.
 * Every change is checked against the staff member's store scope and written to the audit log.
 */
export function makeAdminOperations(deps: OperationsDeps, operations: Operations) {
  const { keyOps } = operations

  async function bookingFor(
    actor: StaffActor,
    bookingCode: string,
    permission: 'bookings.manage' | 'keys.manage' | 'bookings.view',
  ) {
    const booking = await deps.ops.bookingByCode(bookingCode)
    if (!booking) throw new DomainError('booking_not_found', 'booking not found')
    assertCan(actor.access, permission, booking.storeId)
    return booking
  }

  /** A-07: rooms of the booking's group with availability for its time. */
  async function getAssignmentOptions(actor: StaffActor, bookingCode: string) {
    const booking = await bookingFor(actor, bookingCode, 'bookings.manage')
    const store = await operations.requireStore(booking.storeId)
    const now = deps.clock.now()
    const options = await deps.bookings.withInventoryLock(
      booking.roomGroupId,
      booking.businessDate,
      async (tx) => {
        const ctx = await tx.assignmentContext(booking.roomGroupId, booking.businessDate, now)
        return ctx.rooms.map((room): RoomOption => {
          const current = booking.assignment?.roomId === room.roomId
          const check = roomCheck(ctx, booking, room.roomId, now)
          return {
            roomId: room.roomId,
            code: room.code,
            name: room.name,
            cleaningStatus: room.cleaningStatus,
            current,
            available: !current && check.ok,
            problem: current ? null : problemText(check, store.timezone),
          }
        })
      },
    )
    return {
      booking,
      store,
      options,
      preparationDue: isPreparationDue(booking.businessDate, store.timezone, now),
    }
  }

  function roomCheck(
    ctx: Parameters<typeof assignmentPlanInput>[0],
    booking: OpsBooking,
    roomId: number,
    now: Date,
  ) {
    const input = assignmentPlanInput(ctx, booking.businessDate, now)
    return checkRoomChange({
      ...input,
      booking: { bookingId: booking.id, range: { start: booking.start, end: booking.end } },
      roomId,
      waiting: input.pending.filter((p) => p.bookingId !== booking.id).map((p) => p.range),
    })
  }

  function problemText(check: ReturnType<typeof checkRoomChange>, timeZone: string): string | null {
    if (check.ok) return null
    switch (check.reason) {
      case 'conflict':
        return `${hhmm(check.conflict.start, timeZone)}-${hhmm(check.conflict.end, timeZone)}に既存予約があるため変更できません`
      case 'blocked':
        return 'ブロック・休止中のため変更できません'
      case 'not_in_group':
        return '同じ部屋グループの部屋ではありません'
      default:
        return '他の予約の部屋が確保できなくなるため変更できません'
    }
  }

  /**
   * A-07 / F-RM-06: move a booking to another free room of the same group. `finalize` confirms the
   * room at once (F-RM-07). A spot cleaning task is added when the new room is not clean.
   */
  async function reassignRoom(
    actor: StaffActor,
    input: {
      readonly bookingCode: string
      readonly roomId: number
      readonly finalize: boolean
      readonly notifyCustomer: boolean
      readonly reason: string
    },
  ) {
    const reason = input.reason.trim()
    if (!reason) throw new DomainError('reason_required', 'enter a reason')
    const booking = await bookingFor(actor, input.bookingCode, 'bookings.manage')
    if (booking.status !== 'confirmed')
      throw new DomainError('booking_not_assignable', `booking is ${booking.status}`)
    const store = await operations.requireStore(booking.storeId)
    const now = deps.clock.now()
    if (booking.end <= now) throw new DomainError('booking_not_assignable', 'booking has ended')
    if (
      booking.assignment?.roomId === input.roomId &&
      (!input.finalize || booking.assignment.status === 'final')
    ) {
      throw new DomainError('room_unchanged', 'same room')
    }
    await deps.bookings.withInventoryLock(booking.roomGroupId, booking.businessDate, async (tx) => {
      const ctx = await tx.assignmentContext(booking.roomGroupId, booking.businessDate, now)
      if (booking.assignment?.roomId !== input.roomId) {
        const check = roomCheck(ctx, booking, input.roomId, now)
        if (!check.ok)
          throw new DomainError(
            'room_unavailable',
            problemText(check, store.timezone) ?? 'room unavailable',
          )
      }
      await tx.releaseAssignment(booking.id, now, reason)
      await tx.assignRoom({
        bookingId: booking.id,
        roomId: input.roomId,
        status: input.finalize ? 'final' : 'provisional',
        source: 'manual',
        staffId: actor.staffId,
        reason,
        at: now,
      })
    })
    const after = (await deps.ops.booking(booking.id)) ?? booking
    await deps.audit.record({
      actor: { type: 'staff', staffId: actor.staffId },
      action: 'booking.reassign',
      targetType: 'booking',
      targetId: booking.id,
      targetCode: booking.bookingCode,
      storeId: booking.storeId,
      before: booking.assignment
        ? {
            roomId: booking.assignment.roomId,
            room: booking.assignment.roomCode,
            status: booking.assignment.status,
          }
        : null,
      after: after.assignment
        ? {
            roomId: after.assignment.roomId,
            room: after.assignment.roomCode,
            status: after.assignment.status,
          }
        : null,
      reason,
    })
    if (isPreparationDue(booking.businessDate, store.timezone, now)) {
      await operations.syncCleaning(store, booking.businessDate)
      if (input.notifyCustomer) {
        const { live } = await keyOps.liveKey(booking.id)
        if (live && isIssued(live)) await operations.notifyRoomAssigned(after, store, live)
      }
    }
    return after
  }

  // ---------------------------------------------------------------- A-09 keys

  /** A-09: bookings of a date with their code status. */
  async function listKeys(actor: StaffActor, storeId: number, date: LocalDate) {
    assertCan(actor.access, 'keys.manage', storeId)
    const store = await operations.requireStore(storeId)
    const bookings = await deps.ops.bookingsOn(storeId, date, [
      'confirmed',
      'completed',
      'canceled',
    ])
    const keys = await deps.keys.keysForBookings(bookings.map((b) => b.id))
    const rows: KeyListRow[] = bookings.map((booking) => ({
      booking,
      key:
        keys.find((k) => k.bookingId === booking.id && isLive(k)) ??
        keys.find((k) => k.bookingId === booking.id) ??
        null,
    }))
    return { store, rows, device: await deps.devices.activeForStore(storeId) }
  }

  /** A-09 detail: the booking's code (decrypted for staff), its history and the lock device. */
  async function getKeyDetail(actor: StaffActor, bookingCode: string) {
    const booking = await bookingFor(actor, bookingCode, 'keys.manage')
    const store = await operations.requireStore(booking.storeId)
    const keys = await deps.keys.keysForBookings([booking.id])
    const current = keys.find(isLive) ?? keys[0] ?? null
    const events: KeyEvent[] = await deps.keys.events(booking.id)
    return {
      booking,
      store,
      key: current,
      code: current && isIssued(current) ? await keyOps.decryptCode(current) : null,
      validFrom: current ? formatLocalDateTime(current.validFrom, store.timezone) : null,
      validTo: current ? formatLocalDateTime(current.validTo, store.timezone) : null,
      events,
      device: await deps.devices.activeForStore(booking.storeId),
      preparationDue: isPreparationDue(booking.businessDate, store.timezone, deps.clock.now()),
    }
  }

  /** F-KEY-06: staff reissue with a reason; the customer gets the new code when `notify`. */
  async function reissueKey(
    actor: StaffActor,
    input: { readonly bookingCode: string; readonly reason: string; readonly notify: boolean },
  ) {
    const reason = input.reason.trim()
    if (!reason) throw new DomainError('reason_required', 'enter a reason')
    const booking = await bookingFor(actor, input.bookingCode, 'keys.manage')
    if (booking.status !== 'confirmed')
      throw new DomainError('booking_not_assignable', `booking is ${booking.status}`)
    const store = await operations.requireStore(booking.storeId)
    const result = await keyOps.reissue(booking, store)
    await deps.audit.record({
      actor: { type: 'staff', staffId: actor.staffId },
      action: 'access_key.reissue',
      targetType: 'booking',
      targetId: booking.id,
      targetCode: booking.bookingCode,
      storeId: booking.storeId,
      after: { status: result.status, accessKeyId: result.key?.id ?? null },
      reason,
    })
    if (result.key) {
      await deps.keys.recordEvent({
        accessKeyId: result.key.id,
        lockDeviceId: result.key.lockDeviceId,
        bookingId: booking.id,
        eventType: 'manual_reissue',
        result: result.status === 'issued' ? 'success' : 'failure',
        requestKey: result.key.idempotencyKey,
        attemptNo: 1,
        details: { reason },
        staffId: actor.staffId,
        at: deps.clock.now(),
      })
    }
    if (result.status === 'issued' && result.key && input.notify) {
      await operations.notifyRoomAssigned(booking, store, result.key)
    }
    if (result.status !== 'issued')
      throw new DomainError('key_issue_failed', 'the code could not be issued')
    return result
  }

  /** A-09: send the current code to the customer again. */
  async function resendKeyNotice(actor: StaffActor, bookingCode: string) {
    const booking = await bookingFor(actor, bookingCode, 'keys.manage')
    const store = await operations.requireStore(booking.storeId)
    const { live } = await keyOps.liveKey(booking.id)
    if (!live || !isIssued(live)) throw new DomainError('key_not_issued', 'no code issued')
    if (!booking.assignment) throw new DomainError('room_not_assigned', 'no room assigned')
    const result = await operations.notifyRoomAssigned(booking, store, live, true)
    await deps.audit.record({
      actor: { type: 'staff', staffId: actor.staffId },
      action: 'access_key.resend_notice',
      targetType: 'booking',
      targetId: booking.id,
      targetCode: booking.bookingCode,
      storeId: booking.storeId,
      after: { result: result?.status ?? 'not_sent' },
    })
    return result
  }

  /** A-09: staff opened the door by other means (記録のみ). */
  async function recordManualUnlock(
    actor: StaffActor,
    input: { readonly bookingCode: string; readonly note: string },
  ) {
    const note = input.note.trim()
    if (!note) throw new DomainError('reason_required', 'enter a note')
    const booking = await bookingFor(actor, input.bookingCode, 'keys.manage')
    const device = await deps.devices.activeForStore(booking.storeId)
    if (!device) throw new DomainError('lock_device_missing', 'no lock device')
    const { live } = await keyOps.liveKey(booking.id)
    await deps.keys.recordEvent({
      accessKeyId: live?.id ?? null,
      lockDeviceId: device.id,
      bookingId: booking.id,
      eventType: 'manual_unlock',
      result: 'success',
      requestKey: null,
      attemptNo: 1,
      details: { note: note.slice(0, 500) },
      staffId: actor.staffId,
      at: deps.clock.now(),
    })
    await deps.audit.record({
      actor: { type: 'staff', staffId: actor.staffId },
      action: 'access_key.manual_unlock',
      targetType: 'booking',
      targetId: booking.id,
      targetCode: booking.bookingCode,
      storeId: booking.storeId,
      reason: note,
    })
  }

  // ---------------------------------------------------------------- A-20 lock devices

  async function listLockDevices(actor: StaffActor, storeIds: readonly number[] | null) {
    assertCan(actor.access, 'stores.manage')
    return deps.devices.list(storeIds)
  }

  async function getLockDevice(actor: StaffActor, id: number) {
    const device = await deps.devices.find(id)
    if (!device) throw new DomainError('lock_device_not_found', 'device not found')
    assertCan(actor.access, 'stores.manage', device.storeId)
    return device
  }

  function cleanDeviceInput(input: LockDeviceInput): LockDeviceInput {
    const name = input.name.trim()
    const externalDeviceId = input.externalDeviceId.trim()
    const providerAccountId = input.providerAccountId.trim()
    if (!name || !externalDeviceId || !providerAccountId) {
      throw new DomainError('lock_device_invalid', 'name, account and device id are required')
    }
    if (!/^[\x20-\x7e]+$/.test(name + externalDeviceId + providerAccountId)) {
      throw new DomainError('lock_device_invalid', 'use ASCII characters')
    }
    return {
      ...input,
      name,
      externalDeviceId,
      providerAccountId,
      provider: input.provider.trim() || 'smartrooming',
      secretReference: input.secretReference?.trim() || null,
    }
  }

  /** A-20: register or update a device. One active entrance lock per store (tracker #10). */
  async function saveLockDevice(actor: StaffActor, id: number | null, raw: LockDeviceInput) {
    const input = cleanDeviceInput(raw)
    assertCan(actor.access, 'stores.manage', input.storeId)
    const before = id === null ? null : await getLockDevice(actor, id)
    if (input.isActive) {
      const active = await deps.devices.activeForStore(input.storeId)
      if (active && active.id !== id)
        throw new DomainError('lock_device_exists', 'store already has an active lock')
    }
    let savedId = id
    if (id === null) savedId = await deps.devices.create(input)
    else await deps.devices.update(id, input)
    const { secretReference: _ignored, ...auditable } = input
    await deps.audit.record({
      actor: { type: 'staff', staffId: actor.staffId },
      action: id === null ? 'lock_device.create' : 'lock_device.update',
      targetType: 'lock_device',
      targetId: savedId,
      targetCode: input.name,
      storeId: input.storeId,
      before: before
        ? {
            name: before.name,
            provider: before.provider,
            externalDeviceId: before.externalDeviceId,
            isActive: before.isActive,
          }
        : null,
      after: auditable,
    })
    return savedId as number
  }

  /** A-20 疎通テスト (F-KEY-08): asks the provider and stores communication/battery. */
  async function testLockDevice(actor: StaffActor, id: number) {
    const device = await getLockDevice(actor, id)
    const now = deps.clock.now()
    try {
      const status = await deps.provider.status(device)
      await deps.devices.recordStatus(device.id, { ...status, at: now })
      await deps.keys.recordEvent({
        accessKeyId: null,
        lockDeviceId: device.id,
        bookingId: null,
        eventType: 'status_check',
        result: status.communication === 'online' ? 'success' : 'failure',
        requestKey: null,
        attemptNo: 1,
        details: {
          communication: status.communication,
          batteryPercent: status.batteryPercent,
          detail: status.detail,
        },
        staffId: actor.staffId,
        at: now,
      })
      return status
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
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
        details: { message },
        staffId: actor.staffId,
        at: now,
      })
      return { communication: 'offline' as const, batteryPercent: null, detail: message }
    }
  }

  async function testLockDevices(actor: StaffActor, storeIds: readonly number[] | null) {
    const devices = (await listLockDevices(actor, storeIds)).filter((d) => d.isActive)
    const results: { device: LockDevice; communication: string }[] = []
    for (const device of devices) {
      results.push({
        device,
        communication: (await testLockDevice(actor, device.id)).communication,
      })
    }
    return results
  }

  /** Manual run of the day-before batch for one store (A-25 recovery); same run key as the cron. */
  async function runDayBeforeBatchNow(actor: StaffActor, storeId: number) {
    assertCan(actor.access, 'bookings.manage', storeId)
    return operations.runDayBeforeBatch({ storeId, triggeredBy: actor.staffId })
  }

  return {
    getAssignmentOptions,
    reassignRoom,
    listKeys,
    getKeyDetail,
    reissueKey,
    resendKeyNotice,
    recordManualUnlock,
    listLockDevices,
    getLockDevice,
    saveLockDevice,
    testLockDevice,
    testLockDevices,
    runDayBeforeBatchNow,
  }
}

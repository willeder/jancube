import { DomainError, type PlannedCleaningTask, type StaffAccess } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import type { BookingStatus, LockedBookingTx } from '../ports/booking-repository'
import type { PaymentGateway } from '../ports/checkout'
import {
  type AccessKeyProvider,
  AccessKeyProviderError,
  type AccessKeyRecord,
  type CleaningTask,
  type LockDevice,
  type OpsBooking,
  type OpsStore,
} from '../ports/operations'
import type { OutboxEvent, SecretBox } from '../ports/ops'
import { makeAdminOperations } from './admin-operations'
import { makeCleaningWork } from './cleaning-work'
import { makeExpireHolds } from './expire-holds'
import { makeOperations, type OperationsDeps } from './preparation'

/** `jst('2026-11-10', 14)` = 14:00 JST that day. */
const jst = (date: string, hour: number, minute = 0) =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`)
const D = '2026-11-10'

const sealed: string[] = []
const box: SecretBox = {
  encrypt: async (s) => Uint8Array.of(sealed.push(s) - 1),
  decrypt: async (b) => sealed[b[0] as number] as string,
}

interface Bk {
  id: number
  status: BookingStatus
  requestedRoomId: number | null
  businessDate: string
  start: Date
  end: Date
}
interface Asg {
  id: number
  bookingId: number
  roomId: number
  status: 'provisional' | 'final'
  source: 'batch' | 'manual' | 'named'
  released: boolean
}
type Task = PlannedCleaningTask & { id: number; status: CleaningTask['status']; date: string }

function world(now: Date, bookings: Bk[], options: { dirty?: number[] } = {}) {
  let clock = now
  const store: OpsStore = {
    id: 1,
    code: 'JC001',
    name: '本町店',
    timezone: 'Asia/Tokyo',
    cleaningBufferMinutes: 15,
    keyBeforeMinutes: 15,
    keyAfterMinutes: 15,
    roomFinalizeMinutes: null,
  }
  const rooms = [1, 2, 3].map((id) => ({
    roomId: id,
    code: `Room${id}`,
    name: `Room${id}`,
    sortOrder: id,
    cleaningStatus: (options.dirty?.includes(id) ? 'dirty' : 'clean') as 'clean' | 'dirty',
  }))
  const assignments: Asg[] = []
  const tasks: Task[] = []
  const keys: ({ -readonly [K in keyof AccessKeyRecord]: AccessKeyRecord[K] } & {
    attemptsIssue: number
    attemptsRevoke: number
  })[] = []
  const events: {
    keyId: number | null
    type: string
    result: string
    at: Date
    details: unknown
  }[] = []
  const alerts: string[] = []
  const resolved: string[] = []
  const notices: {
    bookingId: number
    event: string
    values?: Record<string, string>
    secret?: string[]
    dedup?: string
  }[] = []
  const audits: string[] = []
  const runs = new Set<string>()
  const provider = { fail: 0, hardFail: false, issued: 0, revoked: [] as string[] }
  const device: LockDevice = {
    id: 7,
    storeId: 1,
    storeCode: 'JC001',
    name: 'ENTRANCE-JC001',
    provider: 'test',
    providerAccountId: 'acct',
    externalDeviceId: 'door-1',
    secretReference: null,
    batteryPercent: null,
    communicationStatus: 'unknown',
    lastResponseAt: null,
    isActive: true,
  }

  const active = (bookingId: number) =>
    assignments.find((a) => a.bookingId === bookingId && !a.released)
  const view = (b: Bk): OpsBooking => {
    const a = active(b.id)
    return {
      id: b.id,
      bookingCode: `JC-2026-${String(b.id).padStart(6, '0')}`,
      status: b.status,
      storeId: 1,
      roomGroupId: 10,
      roomGroupName: '4麻ルーム',
      requestedRoomId: b.requestedRoomId,
      businessDate: b.businessDate,
      start: b.start,
      end: b.end,
      guestCount: 4,
      memberId: 5,
      contactName: '山田 太郎',
      assignment: a
        ? {
            id: a.id,
            roomId: a.roomId,
            roomCode: `Room${a.roomId}`,
            roomName: `Room${a.roomId}`,
            status: a.status,
            source: a.source,
            assignedAt: clock,
          }
        : null,
    }
  }
  const keyView = (k: (typeof keys)[number]): AccessKeyRecord => ({
    ...k,
    attempts: k.status === 'revoke_pending' ? k.attemptsRevoke : k.attemptsIssue,
  })

  const tx = {
    assignmentContext: async () => ({
      bufferMinutes: 15,
      timezone: 'Asia/Tokyo',
      rooms: rooms.map((r) => ({ ...r, usageMinutes: 0, blocks: [] })),
      bookings: bookings
        .filter((b) => b.status === 'confirmed')
        .map((b) => ({
          bookingId: b.id,
          status: b.status,
          businessDate: b.businessDate,
          range: { start: b.start, end: b.end },
          requestedRoomId: b.requestedRoomId,
          assignedRoomId: active(b.id)?.roomId ?? null,
        })),
    }),
    assignRoom: async (input: {
      bookingId: number
      roomId: number
      status: Asg['status']
      source: Asg['source']
    }) => {
      if (active(input.bookingId)) throw new Error('duplicate active assignment')
      assignments.push({ id: assignments.length + 1, ...input, released: false })
      return assignments.length
    },
    releaseAssignment: async (bookingId: number) => {
      const a = active(bookingId)
      if (a) a.released = true
    },
  }

  const providerImpl: AccessKeyProvider = {
    name: 'test',
    issue: async (_d, input) => {
      if (provider.hardFail) throw new AccessKeyProviderError('not_found', 'door not found', false)
      if (provider.fail > 0) {
        provider.fail--
        throw new AccessKeyProviderError('timeout', 'timeout')
      }
      provider.issued++
      return { providerKeyId: `pc-${input.requestKey}`, code: String(100000 + provider.issued) }
    },
    revoke: async (_d, id) => {
      provider.revoked.push(id)
    },
    status: async () => ({ communication: 'online', batteryPercent: null, detail: null }),
  }

  const deps: OperationsDeps = {
    clock: { now: () => clock },
    secrets: box,
    provider: providerImpl,
    alerts: {
      raise: async (a) => {
        if (!alerts.includes(a.alertKey)) alerts.push(a.alertKey)
      },
      resolve: async (key) => {
        resolved.push(key)
      },
    },
    audit: {
      record: async (e) => {
        audits.push(e.action)
      },
    },
    batchRuns: {
      start: async (run) => {
        if (runs.has(run.runKey)) return null
        runs.add(run.runKey)
        return runs.size
      },
      finish: async () => {},
    },
    notifyBooking: async (bookingId, event, extra = {}) => {
      notices.push({
        bookingId,
        event,
        values: extra.values,
        secret: extra.secretValueNames,
        dedup: extra.dedupSuffix,
      })
      return { status: 'queued', channel: 'email' }
    },
    stores: {
      weeklyHours: async () =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          opensMinute: 600,
          closesMinute: 1440,
          isClosed: false,
        })),
      calendarOverrides: async () => [],
    },
    bookings: {
      withInventoryLock: async (_g, _d, fn) => fn(tx as unknown as LockedBookingTx),
    },
    ops: {
      activeStores: async () => [store],
      store: async () => store,
      booking: async (id) => {
        const b = bookings.find((x) => x.id === id)
        return b ? view(b) : null
      },
      bookingByCode: async (code) => {
        const b = bookings.find((x) => view(x).bookingCode === code)
        return b ? view(b) : null
      },
      bookingsOn: async (_s, date, statuses) =>
        bookings.filter((b) => b.businessDate === date && statuses.includes(b.status)).map(view),
      bookingsWithoutKey: async (from, to) =>
        bookings
          .filter((b) => b.status === 'confirmed' && b.end > from && b.start < to)
          .filter((b) => !keys.some((k) => k.bookingId === b.id))
          .map((b) => b.id),
      provisionalAssignments: async (until) =>
        assignments
          .filter((a) => !a.released && a.status === 'provisional')
          .map((a) => ({ a, b: bookings.find((x) => x.id === a.bookingId) as Bk }))
          .filter(({ b }) => b.start < until)
          .map(({ a, b }) => ({ assignmentId: a.id, start: b.start, finalizeMinutes: null })),
      finalizeAssignments: async (ids) => {
        for (const a of assignments) if (ids.includes(a.id)) a.status = 'final'
        return ids.length
      },
      cancellation: async () => ({ fee: 1000, refund: 4300 }),
      markUsedRoomsDirty: async () => 0,
    },
    cleaning: {
      rooms: async () =>
        rooms.map((r) => ({
          ...r,
          roomTypeName: '4麻',
          operatingStatus: 'active' as const,
          lastCleanedAt: null,
        })),
      roomUses: async () =>
        bookings
          .filter((b) => b.status === 'confirmed')
          .flatMap((b) => {
            const roomId = active(b.id)?.roomId ?? b.requestedRoomId
            return roomId === null
              ? []
              : [
                  {
                    bookingId: b.id,
                    roomId,
                    businessDate: b.businessDate,
                    start: b.start,
                    end: b.end,
                  },
                ]
          }),
      tasks: async (_s, date) =>
        tasks
          .filter((t) => t.date === date)
          .map((t) => ({
            id: t.id,
            storeId: 1,
            roomId: t.roomId,
            roomCode: `Room${t.roomId}`,
            roomName: `Room${t.roomId}`,
            bookingId: t.bookingId,
            bookingStart: null,
            businessDate: date,
            taskType: t.taskType,
            status: t.status,
            urgent: t.urgent,
            plannedStartAt: t.plannedStartAt,
            dueAt: t.dueAt,
            assignedStaffName: null,
            startedAt: null,
            generationKey: t.generationKey,
          })),
      task: async (id) => {
        const t = tasks.find((x) => x.id === id)
        return t
          ? ({
              ...t,
              storeId: 1,
              roomCode: `Room${t.roomId}`,
              roomName: `Room${t.roomId}`,
            } as unknown as CleaningTask)
          : null
      },
      syncTasks: async (_s, date, planned) => {
        let created = 0
        let canceled = 0
        for (const p of planned) {
          const existing = tasks.find((t) => t.generationKey === p.generationKey)
          if (!existing) {
            tasks.push({ ...p, id: tasks.length + 1, status: 'pending', date })
            created++
          } else if (existing.status === 'canceled') existing.status = 'pending'
        }
        for (const t of tasks) {
          if (
            t.date === date &&
            t.status === 'pending' &&
            !planned.some((p) => p.generationKey === t.generationKey)
          ) {
            t.status = 'canceled'
            canceled++
          }
        }
        return { created, canceled }
      },
      startTask: async () => true,
      completeTask: async (id) => {
        const t = tasks.find((x) => x.id === id)
        if (!t || t.status === 'done' || t.status === 'canceled') return false
        t.status = 'done'
        const room = rooms.find((r) => r.roomId === t.roomId)
        if (room) room.cleaningStatus = 'clean'
        return true
      },
      logs: async () => [],
      addActivity: async () => {},
      activities: async () => [],
      staffWithRoles: async () => [{ id: 30, name: '清掃担当 川口' }],
    },
    devices: {
      list: async () => [device],
      find: async () => device,
      activeForStore: async () => device,
      create: async () => 8,
      update: async () => {},
      recordStatus: async () => {},
    },
    keys: {
      keysForBookings: async (ids) =>
        keys
          .filter((k) => ids.includes(k.bookingId))
          .sort((a, b) => b.id - a.id)
          .map(keyView),
      key: async (id) => {
        const k = keys.find((x) => x.id === id)
        return k ? keyView(k) : null
      },
      createKey: async (input) => {
        const existing = keys.find((k) => k.idempotencyKey === input.idempotencyKey)
        if (existing) return existing.id
        const live = keys.find(
          (k) =>
            k.bookingId === input.bookingId &&
            ['pending', 'issued', 'active', 'revoke_pending'].includes(k.status),
        )
        if (live) throw new Error('duplicate live key')
        keys.push({
          id: keys.length + 1,
          ...input,
          providerKeyId: null,
          codeCiphertext: null,
          status: 'pending',
          issuedAt: null,
          revokedAt: null,
          createdAt: clock,
          attempts: 0,
          attemptsIssue: 0,
          attemptsRevoke: 0,
          lastAttemptAt: null,
        })
        return keys.length
      },
      markIssued: async (id, input) => {
        const k = keys.find((x) => x.id === id)
        if (!k) return
        Object.assign(k, {
          providerKeyId: input.providerKeyId,
          codeCiphertext: input.codeCiphertext,
          status: 'issued',
          issuedAt: input.at,
        })
      },
      setStatus: async (id, status) => {
        const k = keys.find((x) => x.id === id)
        if (k) k.status = status
      },
      recordEvent: async (e) => {
        events.push({
          keyId: e.accessKeyId,
          type: e.eventType,
          result: e.result,
          at: e.at,
          details: e.details,
        })
        const k = keys.find((x) => x.id === e.accessKeyId)
        if (k && e.eventType === 'issue') {
          k.attemptsIssue++
          k.lastAttemptAt = e.at
        }
        if (k && e.eventType === 'revoke') {
          k.attemptsRevoke++
          k.lastAttemptAt = e.at
        }
      },
      events: async () => [],
      pendingWork: async () =>
        keys.filter((k) => k.status === 'pending' || k.status === 'revoke_pending').map(keyView),
      expireKeys: async () => 0,
    },
  }
  const operations = makeOperations(deps)
  return {
    deps,
    operations,
    admin: makeAdminOperations(deps, operations),
    cleaning: makeCleaningWork(deps, operations),
    assignments,
    tasks,
    keys,
    events,
    alerts,
    resolved,
    notices,
    audits,
    provider,
    rooms,
    setNow: (d: Date) => {
      clock = d
    },
  }
}

const booking = (id: number, from: number, to: number, extra: Partial<Bk> = {}): Bk => ({
  id,
  status: 'confirmed',
  requestedRoomId: null,
  businessDate: D,
  start: jst(D, from),
  end: jst(D, to),
  ...extra,
})

const event = (
  eventType: string,
  aggregateId: number,
  payload: Record<string, unknown> = {},
): OutboxEvent => ({
  id: 1,
  eventType,
  aggregateType: 'booking',
  aggregateId,
  payload,
  attemptCount: 0,
})

const ownerAccess: StaffAccess = { staffId: 1, grants: [{ role: 'owner', storeId: null }] }
const owner = { staffId: 1, access: ownerAccess }

describe('day-before batch (F-RM-04 / F-CLN-02 / F-KEY-01 / F-NTF-02)', () => {
  it('assigns rooms, plans cleaning, issues codes and notifies once', async () => {
    const w = world(
      jst('2026-11-09', 20),
      [booking(1, 13, 16), booking(2, 14, 18), booking(3, 18, 20, { requestedRoomId: 3 })],
      {
        dirty: [2],
      },
    )
    const [result] = await w.operations.runDayBeforeBatch()
    expect(result).toMatchObject({ date: D, status: 'completed', processed: 3, failed: 0 })
    // Clean rooms first; the named booking keeps room 3.
    expect(w.assignments.map((a) => [a.bookingId, a.roomId, a.source])).toEqual([
      [3, 3, 'named'],
      [1, 1, 'batch'],
      // Room 3 is taken at 18:00 (buffer), so the dirty room 2 is the only one left.
      [2, 2, 'batch'],
    ])
    expect(w.keys.map((k) => [k.bookingId, k.status, k.validFrom.toISOString()])).toEqual([
      [1, 'issued', jst(D, 12, 45).toISOString()],
      [2, 'issued', jst(D, 13, 45).toISOString()],
      [3, 'issued', jst(D, 17, 45).toISOString()],
    ])
    expect(w.notices).toHaveLength(3)
    expect(w.notices[0]).toMatchObject({
      event: 'room_assigned',
      secret: ['entryCode'],
      values: {
        entryCode: '100001',
        codeValidFrom: '11月10日 12:45',
        codeValidTo: '11月10日 16:15',
      },
    })
    // Room 2 is dirty: opening cleaning before the store opens at 10:00.
    expect(w.tasks.map((t) => [t.generationKey, t.dueAt.toISOString()])).toEqual([
      ['opening:2026-11-10:2', jst(D, 10).toISOString()],
    ])
    expect(w.events.every((e) => !JSON.stringify(e.details).includes('100001'))).toBe(true)

    expect((await w.operations.runDayBeforeBatch())[0]).toMatchObject({ status: 'already_ran' })
    expect(w.notices).toHaveLength(3)
  })

  it('retries failed issues with back-off and alerts when they keep failing (F-KEY-07)', async () => {
    const w = world(jst('2026-11-09', 20), [booking(1, 13, 16)])
    w.provider.fail = 1
    const [result] = await w.operations.runDayBeforeBatch()
    expect(result).toMatchObject({ processed: 0, failed: 1 })
    expect(w.alerts).toContain('key_missing:1')
    expect(w.keys[0]?.status).toBe('pending')

    w.setNow(jst('2026-11-09', 20, 0))
    expect((await w.operations.runMinute()).keys.issued).toBe(0) // back-off: 1 minute
    w.setNow(jst('2026-11-09', 20, 1))
    expect((await w.operations.runMinute()).keys.issued).toBe(1)
    expect(w.resolved).toContain('key_missing:1')
    expect(w.notices.map((n) => n.event)).toEqual(['room_assigned'])

    const failing = world(jst('2026-11-09', 20), [booking(1, 13, 16)])
    failing.provider.hardFail = true
    await failing.operations.runDayBeforeBatch()
    expect(failing.keys[0]?.status).toBe('failed')
    expect(failing.alerts).toEqual(expect.arrayContaining(['key_failed:1', 'key_missing:1']))
  })

  it('late bookings are prepared when confirmed; earlier ones wait for the batch', async () => {
    const w = world(jst('2026-11-10', 9), [
      booking(1, 13, 16),
      booking(2, 13, 16, {
        businessDate: '2026-11-12',
        start: jst('2026-11-12', 13),
        end: jst('2026-11-12', 16),
      }),
    ])
    await w.operations.onBookingConfirmed(event('booking.confirmed', 1))
    await w.operations.onBookingConfirmed(event('booking.confirmed', 2))
    expect(w.keys.map((k) => k.bookingId)).toEqual([1])
    expect(w.notices.map((n) => n.bookingId)).toEqual([1])
  })
})

describe('booking events', () => {
  it('booking.canceled revokes the code, frees the room, cancels cleaning and notifies', async () => {
    const bookings = [
      booking(1, 13, 16, { requestedRoomId: 1 }),
      booking(2, 17, 19, { requestedRoomId: 1 }),
    ]
    const w = world(jst('2026-11-09', 20), bookings)
    await w.operations.runDayBeforeBatch()
    expect(w.tasks.map((t) => [t.generationKey, t.status])).toEqual([['spot:1:2', 'pending']])
    ;(bookings[1] as Bk).status = 'canceled'
    await w.operations.onBookingCanceled(event('booking.canceled', 2))
    expect(w.keys.find((k) => k.bookingId === 2)?.status).toBe('revoked')
    expect(w.provider.revoked).toHaveLength(1)
    expect(w.assignments.find((a) => a.bookingId === 2)?.released).toBe(true)
    expect(w.tasks.every((t) => t.status === 'canceled')).toBe(true)
    expect(w.notices.at(-1)).toMatchObject({
      event: 'booking_canceled',
      values: { cancellationFee: '1,000円', refundAmount: '4,300円' },
    })
  })

  it('booking.changed reissues the code for the new time (F-KEY-04)', async () => {
    const bookings = [booking(1, 13, 16)]
    const w = world(jst('2026-11-09', 20), bookings)
    await w.operations.runDayBeforeBatch()
    ;(bookings[0] as Bk).end = jst(D, 17)
    await w.operations.onBookingChanged(event('booking.changed', 1, { previousBusinessDate: D }))
    expect(w.keys.map((k) => [k.status, k.validTo.toISOString()])).toEqual([
      ['revoked', jst(D, 16, 15).toISOString()],
      ['issued', jst(D, 17, 15).toISOString()],
    ])
    expect(w.notices.map((n) => n.dedup)).toEqual(['1:1', '2:1'])
  })
})

describe('A-07 manual reassignment (F-RM-06 / F-RM-07)', () => {
  it('rejects conflicts and moves to a free room with a spot task when not clean', async () => {
    const w = world(jst('2026-11-09', 20), [booking(1, 13, 16), booking(2, 14, 18)], { dirty: [3] })
    await w.operations.runDayBeforeBatch()
    w.setNow(jst(D, 10))
    const options = await w.admin.getAssignmentOptions(owner, 'JC-2026-000001')
    expect(options.options.map((o) => [o.code, o.available])).toEqual([
      ['Room1', false],
      ['Room2', false],
      ['Room3', true],
    ])
    expect(options.options[1]?.problem).toBe('14:00-18:00に既存予約があるため変更できません')
    await expect(
      w.admin.reassignRoom(owner, {
        bookingCode: 'JC-2026-000001',
        roomId: 2,
        finalize: true,
        notifyCustomer: true,
        reason: '設備不具合',
      }),
    ).rejects.toThrow(DomainError)
    const after = await w.admin.reassignRoom(owner, {
      bookingCode: 'JC-2026-000001',
      roomId: 3,
      finalize: true,
      notifyCustomer: true,
      reason: '設備不具合',
    })
    expect(after.assignment).toMatchObject({ roomId: 3, status: 'final', source: 'manual' })
    expect(w.audits).toContain('booking.reassign')
    expect(w.tasks.find((t) => t.generationKey === 'spot:3:1')).toMatchObject({
      urgent: true,
      status: 'pending',
    })
    expect(w.notices.at(-1)).toMatchObject({ event: 'room_assigned', dedup: '1:3' })
  })

  it('finalizes provisional rooms 30 minutes before the start (F-RM-05)', async () => {
    const w = world(jst('2026-11-09', 20), [booking(1, 13, 16)])
    await w.operations.runDayBeforeBatch()
    w.setNow(jst(D, 12, 29))
    expect(await w.operations.finalizeAssignments()).toBe(0)
    w.setNow(jst(D, 12, 30))
    expect(await w.operations.finalizeAssignments()).toBe(1)
    expect(w.assignments[0]?.status).toBe('final')
  })
})

describe('cleaning work (K-02 / A-10)', () => {
  it('completes a task for a worker of the store and marks the room clean', async () => {
    const w = world(jst('2026-11-09', 20), [booking(1, 13, 16)], { dirty: [1, 2, 3] })
    await w.operations.runDayBeforeBatch()
    w.setNow(jst(D, 9, 40))
    const today = await w.cleaning.getTodayTasks(owner, 1)
    expect(today.openingOpen.map((t) => t.roomCode)).toEqual(['Room1'])
    const taskId = today.openingOpen[0]?.id as number
    await expect(
      w.cleaning.completeCleaningTask(owner, { taskId, workerId: 99, source: 'cleaning' }),
    ).rejects.toThrow('unknown worker')
    await w.cleaning.completeCleaningTask(owner, { taskId, workerId: 30, source: 'cleaning' })
    expect(w.rooms[0]?.cleaningStatus).toBe('clean')
    expect(w.audits).toContain('cleaning_task.complete')
    await expect(
      w.cleaning.completeCleaningTask(
        { staffId: 2, access: { staffId: 2, grants: [{ role: 'cleaning', storeId: 9 }] } },
        {
          taskId,
          workerId: 30,
          source: 'cleaning',
        },
      ),
    ).rejects.toThrow('missing permission')
  })
})

describe('expireHolds', () => {
  it('expires holds and leaves paid checkouts to the webhook', async () => {
    const expired: number[] = []
    const gateway = {
      expireCheckout: async (id: string) => {
        if (id === 'cs_paid') throw new Error('already complete')
      },
      getCheckout: async () => ({
        status: 'complete',
        paid: true,
        externalPaymentId: 'pi',
        amount: 1,
      }),
    } as unknown as PaymentGateway
    const result = await makeExpireHolds({
      gateway,
      clock: { now: () => jst(D, 12) },
      holds: {
        expiredHolds: async () => [
          { bookingId: 1, checkoutIds: ['cs_open'] },
          { bookingId: 2, checkoutIds: ['cs_paid'] },
          { bookingId: 3, checkoutIds: [] },
        ],
        expireHold: async (id) => {
          expired.push(id)
          return true
        },
      },
    })()
    expect(result).toEqual({ expired: 2, skipped: 1 })
    expect(expired).toEqual([1, 3])
  })
})

import {
  addDays,
  assertCan,
  can,
  DomainError,
  type LocalDate,
  localDateOf,
  localToUtc,
  parseLocalDate,
  ROLE_PERMISSIONS,
  ROLES,
} from '@jancube/domain'
import type { StaffActor } from '../admin/admin-actor'
import type { CleaningTask } from '../ports/operations'
import type { Operations, OperationsDeps } from './preparation'

/** K-02 shows spot tasks marked urgent, and any spot task due within this many minutes. */
export const URGENT_SPOT_MINUTES = 60
const MEMO_MAX = 500

const CLEANING_ROLES = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('cleaning.work'))

export const isUrgentSpot = (task: CleaningTask, now: Date) =>
  task.taskType === 'spot' &&
  (task.status === 'pending' || task.status === 'in_progress') &&
  (task.urgent || task.dueAt.getTime() - now.getTime() <= URGENT_SPOT_MINUTES * 60_000)

/**
 * Cleaning (F-CLN-03〜): A-10 清掃状況 for staff, K-01〜K-03 for cleaning staff.
 * The signed-in account is the one who records (入力者); the worker (作業担当者) is chosen separately
 * (K-01) and stored in cleaning_logs.staff_id.
 */
export function makeCleaningWork(deps: OperationsDeps, operations: Operations) {
  async function storeFor(
    actor: StaffActor,
    storeId: number,
    permission: 'cleaning.view' | 'cleaning.work',
  ) {
    assertCan(actor.access, permission, storeId)
    return operations.requireStore(storeId)
  }

  function dayRange(from: LocalDate, toInclusive: LocalDate, timeZone: string) {
    return {
      from: localToUtc(from, 0, timeZone),
      to: localToUtc(addDays(toInclusive, 1), 0, timeZone),
    }
  }

  /** A-10: rooms, tasks of the date, and the date's log. */
  async function getCleaningBoard(actor: StaffActor, storeId: number, date?: LocalDate) {
    const store = await storeFor(actor, storeId, 'cleaning.view')
    const now = deps.clock.now()
    const day = date ?? localDateOf(now, store.timezone)
    parseLocalDate(day)
    const range = dayRange(day, day, store.timezone)
    const [rooms, tasks, logs, activities] = await Promise.all([
      deps.cleaning.rooms(storeId),
      deps.cleaning.tasks(storeId, day),
      deps.cleaning.logs(storeId, range.from, range.to),
      deps.cleaning.activities(storeId, range.from, range.to),
    ])
    const open = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress')
    const openingOpen = open.filter((t) => t.taskType === 'opening')
    return {
      store,
      date: day,
      now,
      rooms,
      tasks,
      logs,
      activities,
      stats: {
        openingRemaining: openingOpen.length,
        urgentSpots: open.filter((t) => isUrgentSpot(t, now)).length,
        roomsInService: rooms.filter((r) => r.operatingStatus === 'active').length,
        openingDue:
          openingOpen.map((t) => t.dueAt).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      },
      canWork: can(actor.access, 'cleaning.work', storeId),
    }
  }

  /** K-01: who can be chosen as the worker for a store. */
  async function cleaningAssignees(actor: StaffActor, storeId: number) {
    await storeFor(actor, storeId, 'cleaning.work')
    return deps.cleaning.staffWithRoles(storeId, CLEANING_ROLES)
  }

  /** K-02: today's open tasks — opening cleaning, and urgent spot cleaning. */
  async function getTodayTasks(actor: StaffActor, storeId: number) {
    const store = await storeFor(actor, storeId, 'cleaning.work')
    const now = deps.clock.now()
    const today = localDateOf(now, store.timezone)
    const [tasks, rooms] = await Promise.all([
      deps.cleaning.tasks(storeId, today),
      deps.cleaning.rooms(storeId),
    ])
    const opening = tasks.filter((t) => t.taskType === 'opening' && t.status !== 'canceled')
    return {
      store,
      date: today,
      now,
      openingOpen: opening.filter((t) => t.status !== 'done'),
      openingDone: opening.filter((t) => t.status === 'done').length,
      urgentSpots: tasks.filter((t) => isUrgentSpot(t, now)),
      roomsInService: rooms.filter((r) => r.operatingStatus === 'active').length,
      rooms,
    }
  }

  async function taskFor(actor: StaffActor, taskId: number) {
    const task = await deps.cleaning.task(taskId)
    if (!task) throw new DomainError('cleaning_task_not_found', 'task not found')
    assertCan(actor.access, 'cleaning.work', task.storeId)
    return task
  }

  async function assertWorker(storeId: number, workerId: number) {
    const workers = await deps.cleaning.staffWithRoles(storeId, CLEANING_ROLES)
    if (!workers.some((w) => w.id === workerId))
      throw new DomainError('cleaning_worker_invalid', 'unknown worker')
  }

  async function startCleaningTask(
    actor: StaffActor,
    input: {
      readonly taskId: number
      readonly workerId: number
      readonly source: 'cleaning' | 'admin'
    },
  ) {
    const task = await taskFor(actor, input.taskId)
    await assertWorker(task.storeId, input.workerId)
    const started = await deps.cleaning.startTask(task.id, {
      workerId: input.workerId,
      loggedBy: actor.staffId,
      source: input.source,
      at: deps.clock.now(),
    })
    if (!started) throw new DomainError('cleaning_task_closed', 'task is not pending')
    await deps.audit.record({
      actor: { type: 'staff', staffId: actor.staffId },
      action: 'cleaning_task.start',
      targetType: 'cleaning_task',
      targetId: task.id,
      targetCode: task.roomCode,
      storeId: task.storeId,
      after: { workerId: input.workerId },
    })
  }

  /** K-02 / A-10: cleaning done (on behalf of a worker when entered from the admin screen). */
  async function completeCleaningTask(
    actor: StaffActor,
    input: {
      readonly taskId: number
      readonly workerId: number
      readonly notes?: string | null
      readonly source: 'cleaning' | 'admin'
    },
  ) {
    const task = await taskFor(actor, input.taskId)
    await assertWorker(task.storeId, input.workerId)
    const notes = input.notes?.trim().slice(0, MEMO_MAX) || null
    const done = await deps.cleaning.completeTask(task.id, {
      workerId: input.workerId,
      loggedBy: actor.staffId,
      source: input.source,
      notes,
      at: deps.clock.now(),
    })
    if (!done) throw new DomainError('cleaning_task_closed', 'task is already closed')
    await deps.audit.record({
      actor: { type: 'staff', staffId: actor.staffId },
      action: 'cleaning_task.complete',
      targetType: 'cleaning_task',
      targetId: task.id,
      targetCode: task.roomCode,
      storeId: task.storeId,
      before: { status: task.status },
      after: { status: 'done', workerId: input.workerId },
    })
  }

  /** K-02 / A-10 活動メモ (tracker #31/#32): linked to the room and the signed-in account. */
  async function addRoomMemo(
    actor: StaffActor,
    input: {
      readonly storeId: number
      readonly roomId: number
      readonly taskId?: number | null
      readonly body: string
      readonly source: 'cleaning' | 'admin'
    },
  ) {
    assertCan(actor.access, 'cleaning.work', input.storeId)
    const body = input.body.trim()
    if (!body) throw new DomainError('memo_required', 'enter a memo')
    if (body.length > MEMO_MAX) throw new DomainError('memo_too_long', 'memo is too long')
    const rooms = await deps.cleaning.rooms(input.storeId)
    if (!rooms.some((r) => r.roomId === input.roomId))
      throw new DomainError('room_not_found', 'room not found')
    let taskId: number | null = null
    if (input.taskId) {
      const task = await taskFor(actor, input.taskId)
      if (task.roomId !== input.roomId)
        throw new DomainError('cleaning_task_not_found', 'task of another room')
      taskId = task.id
    }
    await deps.cleaning.addActivity({
      roomId: input.roomId,
      taskId,
      staffId: actor.staffId,
      source: input.source,
      action: 'memo',
      body,
      at: deps.clock.now(),
    })
  }

  /** K-03: completed cleaning of today / this week / this month. */
  async function getCleaningLog(
    actor: StaffActor,
    storeId: number,
    period: 'day' | 'week' | 'month' = 'day',
  ) {
    const store = await storeFor(actor, storeId, 'cleaning.work')
    const now = deps.clock.now()
    const today = localDateOf(now, store.timezone)
    const from =
      period === 'month'
        ? `${today.slice(0, 8)}01`
        : period === 'week'
          ? addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
          : today
    const range = dayRange(from, today, store.timezone)
    const [logs, activities] = await Promise.all([
      deps.cleaning.logs(storeId, range.from, range.to),
      deps.cleaning.activities(storeId, range.from, range.to),
    ])
    return {
      store,
      period,
      from,
      to: today,
      logs,
      activities,
      counts: {
        total: logs.length,
        opening: logs.filter((l) => l.taskType === 'opening').length,
        spot: logs.filter((l) => l.taskType === 'spot').length,
        overdue: logs.filter((l) => l.wasOverdue).length,
      },
    }
  }

  return {
    getCleaningBoard,
    cleaningAssignees,
    getTodayTasks,
    startCleaningTask,
    completeCleaningTask,
    addRoomMemo,
    getCleaningLog,
  }
}

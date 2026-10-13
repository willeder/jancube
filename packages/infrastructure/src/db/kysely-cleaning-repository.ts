import type {
  CleaningLogEntry,
  CleaningRepository,
  CleaningRoom,
  CleaningTask,
  RoomActivity,
} from '@jancube/application'
import type {
  CleaningTaskStatus,
  CleaningTaskType,
  LocalDate,
  PlannedCleaningTask,
} from '@jancube/domain'
import { sql } from 'kysely'
import type { Database } from './create-db'
import { toLocalDate } from './sql-values'

const dateValue = (date: LocalDate) => new Date(`${date}T00:00:00Z`)

function taskQuery(db: Database) {
  return db
    .selectFrom('cleaning_tasks as t')
    .innerJoin('rooms as r', 'r.id', 't.room_id')
    .leftJoin('bookings as b', 'b.id', 't.booking_id')
    .leftJoin('staff as s', 's.id', 't.assigned_staff_id')
    .select([
      't.id',
      'r.store_id',
      't.room_id',
      'r.code as room_code',
      'r.name as room_name',
      't.booking_id',
      'b.starts_at as booking_start',
      't.business_date',
      't.task_type',
      't.status',
      't.is_urgent',
      't.planned_start_at',
      't.due_at',
      's.name as staff_name',
      't.generation_key',
    ])
    .select((eb) =>
      eb
        .selectFrom('room_activity_logs as l')
        .select((e) => e.fn.max('l.occurred_at').as('at'))
        .whereRef('l.task_id', '=', 't.id')
        .where('l.action', '=', 'cleaning_started')
        .as('started_at'),
    )
}

type TaskRow = Awaited<ReturnType<ReturnType<typeof taskQuery>['execute']>>[number]

const toTask = (row: TaskRow): CleaningTask => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  roomId: Number(row.room_id),
  roomCode: row.room_code,
  roomName: row.room_name,
  bookingId: row.booking_id === null ? null : Number(row.booking_id),
  bookingStart: row.booking_start,
  businessDate: toLocalDate(row.business_date),
  taskType: row.task_type as CleaningTaskType,
  status: row.status as CleaningTaskStatus,
  urgent: row.is_urgent === 1,
  plannedStartAt: row.planned_start_at,
  dueAt: row.due_at,
  assignedStaffName: row.staff_name,
  startedAt: row.started_at ? new Date(row.started_at as unknown as string | Date) : null,
  generationKey: row.generation_key,
})

/** Cleaning plan, results and room activity notes (A-10, K-01〜K-03). */
export class KyselyCleaningRepository implements CleaningRepository {
  constructor(private readonly db: Database) {}

  async rooms(storeId: number): Promise<CleaningRoom[]> {
    const rows = await this.db
      .selectFrom('rooms as r')
      .innerJoin('room_types as t', 't.id', 'r.room_type_id')
      .select([
        'r.id',
        'r.code',
        'r.name',
        't.name as type_name',
        'r.operating_status',
        'r.cleaning_status',
        'r.last_cleaned_at',
        'r.sort_order',
      ])
      .where('r.store_id', '=', storeId)
      .orderBy('r.sort_order')
      .orderBy('r.id')
      .execute()
    return rows.map((r) => ({
      roomId: Number(r.id),
      code: r.code,
      name: r.name,
      roomTypeName: r.type_name,
      operatingStatus: r.operating_status as CleaningRoom['operatingStatus'],
      cleaningStatus: r.cleaning_status === 'clean' ? 'clean' : 'dirty',
      lastCleanedAt: r.last_cleaned_at,
      sortOrder: r.sort_order,
    }))
  }

  async roomUses(storeId: number, from: Date, to: Date) {
    const rows = await this.db
      .selectFrom('bookings as b')
      .leftJoin('booking_assignments as a', (join) =>
        join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
      )
      .select([
        'b.id',
        'b.business_date',
        'b.starts_at',
        'b.ends_at',
        'b.requested_room_id',
        'a.room_id',
      ])
      .where('b.store_id', '=', storeId)
      .where('b.status', 'in', ['confirmed', 'completed'])
      .where('b.starts_at', '<', to)
      .where('b.ends_at', '>', from)
      .execute()
    return rows.flatMap((b) => {
      const roomId = b.room_id ?? b.requested_room_id
      return roomId === null
        ? []
        : [
            {
              bookingId: Number(b.id),
              roomId: Number(roomId),
              businessDate: toLocalDate(b.business_date),
              start: b.starts_at,
              end: b.ends_at,
            },
          ]
    })
  }

  async tasks(storeId: number, date: LocalDate) {
    const rows = await taskQuery(this.db)
      .where('r.store_id', '=', storeId)
      .where('t.business_date', '=', dateValue(date))
      .orderBy('t.due_at')
      .orderBy('r.sort_order')
      .execute()
    return rows.map(toTask)
  }

  async task(taskId: number) {
    const row = await taskQuery(this.db).where('t.id', '=', taskId).executeTakeFirst()
    return row ? toTask(row) : null
  }

  async syncTasks(
    storeId: number,
    date: LocalDate,
    planned: readonly PlannedCleaningTask[],
    at: Date,
  ) {
    return this.db.transaction().execute(async (trx) => {
      let created = 0
      for (const task of planned) {
        const result = await trx
          .insertInto('cleaning_tasks')
          .values({
            room_id: task.roomId,
            booking_id: task.bookingId,
            business_date: dateValue(date),
            task_type: task.taskType,
            status: 'pending',
            is_urgent: task.urgent ? 1 : 0,
            planned_start_at: task.plannedStartAt,
            due_at: task.dueAt,
            generation_key: task.generationKey,
            reason: task.reason,
          })
          .onDuplicateKeyUpdate({
            // Wanted again after a cancellation → back to pending; started/done tasks are kept.
            status: sql`IF(status = 'canceled', 'pending', status)`,
            planned_start_at: sql`IF(status IN ('pending', 'canceled'), VALUES(planned_start_at), planned_start_at)`,
            due_at: sql`IF(status IN ('pending', 'canceled'), VALUES(due_at), due_at)`,
          })
          .executeTakeFirst()
        if (Number(result.numInsertedOrUpdatedRows ?? 0n) === 1) created++
      }
      const keys = planned.map((t) => t.generationKey)
      let query = trx
        .updateTable('cleaning_tasks')
        .set({ status: 'canceled', updated_at: at })
        .where('business_date', '=', dateValue(date))
        .where('status', '=', 'pending')
        .where('room_id', 'in', (eb) =>
          eb.selectFrom('rooms').select('id').where('store_id', '=', storeId),
        )
      if (keys.length > 0) query = query.where('generation_key', 'not in', keys)
      const canceled = await query.executeTakeFirst()
      return { created, canceled: Number(canceled.numUpdatedRows) }
    })
  }

  async startTask(
    taskId: number,
    input: Parameters<CleaningRepository['startTask']>[1],
  ): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('cleaning_tasks')
        .set({ status: 'in_progress', assigned_staff_id: input.workerId })
        .where('id', '=', taskId)
        .where('status', '=', 'pending')
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1) return false
      const task = await trx
        .selectFrom('cleaning_tasks')
        .select('room_id')
        .where('id', '=', taskId)
        .executeTakeFirstOrThrow()
      await trx
        .insertInto('room_activity_logs')
        .values({
          room_id: task.room_id,
          task_id: taskId,
          staff_id: input.loggedBy,
          source: input.source,
          action: 'cleaning_started',
          body: '清掃開始',
          occurred_at: input.at,
        })
        .execute()
      return true
    })
  }

  async completeTask(
    taskId: number,
    input: Parameters<CleaningRepository['completeTask']>[1],
  ): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const task = await trx
        .selectFrom('cleaning_tasks')
        .select(['room_id', 'status', 'due_at'])
        .where('id', '=', taskId)
        .forUpdate()
        .executeTakeFirst()
      if (!task || task.status === 'done' || task.status === 'canceled') return false
      const started = await trx
        .selectFrom('room_activity_logs')
        .select((eb) => eb.fn.max('occurred_at').as('at'))
        .where('task_id', '=', taskId)
        .where('action', '=', 'cleaning_started')
        .executeTakeFirst()
      const startedAt = started?.at ? new Date(started.at as unknown as string | Date) : null
      await trx
        .insertInto('cleaning_logs')
        .values({
          task_id: taskId,
          staff_id: input.workerId,
          started_at: startedAt && startedAt <= input.at ? startedAt : null,
          completed_at: input.at,
          was_overdue: input.at > task.due_at ? 1 : 0,
          notes: input.notes,
        })
        .execute()
      await trx
        .updateTable('cleaning_tasks')
        .set({ status: 'done', assigned_staff_id: input.workerId })
        .where('id', '=', taskId)
        .execute()
      await trx
        .updateTable('rooms')
        .set({ cleaning_status: 'clean', last_cleaned_at: input.at })
        .where('id', '=', task.room_id)
        .execute()
      await trx
        .insertInto('room_activity_logs')
        .values({
          room_id: task.room_id,
          task_id: taskId,
          staff_id: input.loggedBy,
          source: input.source,
          action: 'cleaning_completed',
          body: input.notes ?? '清掃完了',
          occurred_at: input.at,
        })
        .execute()
      return true
    })
  }

  async logs(storeId: number, from: Date, to: Date): Promise<CleaningLogEntry[]> {
    const rows = await this.db
      .selectFrom('cleaning_logs as l')
      .innerJoin('cleaning_tasks as t', 't.id', 'l.task_id')
      .innerJoin('rooms as r', 'r.id', 't.room_id')
      .innerJoin('staff as s', 's.id', 'l.staff_id')
      .select([
        'l.task_id',
        'r.code',
        'r.name',
        't.task_type',
        's.name as worker',
        'l.started_at',
        'l.completed_at',
        'l.was_overdue',
        'l.notes',
      ])
      .where('r.store_id', '=', storeId)
      .where('l.completed_at', '>=', from)
      .where('l.completed_at', '<', to)
      .orderBy('l.completed_at')
      .execute()
    return rows.map((r) => ({
      taskId: Number(r.task_id),
      roomCode: r.code,
      roomName: r.name,
      taskType: r.task_type as CleaningTaskType,
      workerName: r.worker,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      wasOverdue: r.was_overdue === 1,
      notes: r.notes,
    }))
  }

  async addActivity(entry: Parameters<CleaningRepository['addActivity']>[0]) {
    await this.db
      .insertInto('room_activity_logs')
      .values({
        room_id: entry.roomId,
        task_id: entry.taskId,
        staff_id: entry.staffId,
        source: entry.source,
        action: entry.action,
        body: entry.body,
        occurred_at: entry.at,
      })
      .execute()
  }

  async activities(storeId: number, from: Date, to: Date): Promise<RoomActivity[]> {
    const rows = await this.db
      .selectFrom('room_activity_logs as a')
      .innerJoin('rooms as r', 'r.id', 'a.room_id')
      .innerJoin('staff as s', 's.id', 'a.staff_id')
      .select([
        'a.id',
        'r.code',
        'r.name',
        's.name as staff',
        'a.source',
        'a.action',
        'a.body',
        'a.occurred_at',
      ])
      .where('r.store_id', '=', storeId)
      .where('a.occurred_at', '>=', from)
      .where('a.occurred_at', '<', to)
      .orderBy('a.occurred_at')
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      roomCode: r.code,
      roomName: r.name,
      staffName: r.staff,
      source: r.source === 'admin' ? 'admin' : 'cleaning',
      action: r.action,
      body: r.body,
      occurredAt: r.occurred_at,
    }))
  }

  async staffWithRoles(storeId: number, roles: readonly string[]) {
    if (roles.length === 0) return []
    const rows = await this.db
      .selectFrom('staff as s')
      .innerJoin('staff_role_grants as g', 'g.staff_id', 's.id')
      .innerJoin('roles as r', 'r.id', 'g.role_id')
      .select(['s.id', 's.name'])
      .distinct()
      .where('s.status', '=', 'active')
      .where('r.code', 'in', [...roles])
      .where((eb) => eb.or([eb('g.store_id', 'is', null), eb('g.store_id', '=', storeId)]))
      .orderBy('s.name')
      .execute()
    return rows.map((r) => ({ id: Number(r.id), name: r.name }))
  }
}

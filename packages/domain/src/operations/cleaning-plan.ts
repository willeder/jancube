import { addMinutes } from '../time/time-range'
import type { LocalDate } from '../time/zoned-time'

/**
 * Cleaning plan of one business date (F-CLN-02, A-10 / K-02).
 *
 * - Opening cleaning (開店前清掃): rooms used that day that will not be clean at opening. Created by
 *   the day-before batch, due when the store opens (or the room's first booking, if earlier).
 * - Spot cleaning (スポット清掃): between two bookings in the same room, due 30 minutes before the
 *   next booking starts (never before the previous booking ends). Same-day changes that put a
 *   booking into a room that is not clean also create a spot task, marked urgent.
 *
 * Tasks are identified by a generation key, so planning again is idempotent: tasks still wanted keep
 * their status, tasks no longer wanted (cancellation, reassignment) are cancelled while pending.
 */
export type CleaningTaskType = 'opening' | 'spot'
export type CleaningTaskStatus = 'pending' | 'in_progress' | 'done' | 'canceled'

/** Lead time of spot cleaning before the next booking (A-10: 開始30分前が期限). */
export const SPOT_CLEANING_LEAD_MINUTES = 30
/** Planned start of opening cleaning before it is due (K-02: 目安 9:30開始 / 期限 10:00). */
export const OPENING_CLEANING_MINUTES = 30

export interface RoomUse {
  readonly bookingId: number
  readonly roomId: number
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
}

export interface CleaningRoomState {
  readonly roomId: number
  /** Current rooms.cleaning_status. */
  readonly dirty: boolean
  /** An opening task already exists for this room and date (any status but canceled). */
  readonly hasOpeningTask: boolean
}

export interface PlannedCleaningTask {
  readonly generationKey: string
  readonly roomId: number
  /** The booking that needs the room clean (spot tasks). */
  readonly bookingId: number | null
  readonly taskType: CleaningTaskType
  readonly plannedStartAt: Date | null
  readonly dueAt: Date
  readonly urgent: boolean
  readonly reason: string
}

export interface CleaningPlanInput {
  readonly businessDate: LocalDate
  /** `day_before`: the batch for tomorrow. `same_day`: re-planning on the day (changes). */
  readonly mode: 'day_before' | 'same_day'
  readonly now: Date
  /** Store opening of the business date; null when unknown (falls back to the first booking). */
  readonly opensAt: Date | null
  readonly rooms: readonly CleaningRoomState[]
  /** Room uses from now until the end of the business date (other dates included). */
  readonly uses: readonly RoomUse[]
}

export const openingTaskKey = (date: LocalDate, roomId: number) => `opening:${date}:${roomId}`
export const spotTaskKey = (roomId: number, bookingId: number) => `spot:${roomId}:${bookingId}`

export function planCleaningTasks(input: CleaningPlanInput): PlannedCleaningTask[] {
  const tasks: PlannedCleaningTask[] = []
  for (const room of input.rooms) {
    const uses = input.uses
      .filter((u) => u.roomId === room.roomId)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
    const today = uses.filter((u) => u.businessDate === input.businessDate)
    const first = today[0]
    if (!first) continue
    // Used again before the first booking of the date (e.g. tonight) → not clean at opening.
    const usedBefore = uses.some(
      (u) => u.businessDate !== input.businessDate && u.start < first.start && u.end > input.now,
    )
    const needsCleaning = room.dirty || usedBefore

    if (room.hasOpeningTask || (needsCleaning && input.mode === 'day_before')) {
      const due =
        input.opensAt && input.opensAt.getTime() <= first.start.getTime()
          ? input.opensAt
          : first.start
      tasks.push({
        generationKey: openingTaskKey(input.businessDate, room.roomId),
        roomId: room.roomId,
        bookingId: null,
        taskType: 'opening',
        plannedStartAt: addMinutes(due, -OPENING_CLEANING_MINUTES),
        dueAt: due,
        urgent: false,
        reason: '開店前清掃',
      })
    } else if (needsCleaning) {
      tasks.push(spot(room.roomId, first, null, true))
    }
    for (let i = 1; i < today.length; i++) {
      const next = today[i] as RoomUse
      tasks.push(spot(room.roomId, next, today[i - 1] as RoomUse, input.mode === 'same_day'))
    }
  }
  return tasks
}

function spot(
  roomId: number,
  next: RoomUse,
  previous: RoomUse | null,
  urgent: boolean,
): PlannedCleaningTask {
  const lead = addMinutes(next.start, -SPOT_CLEANING_LEAD_MINUTES)
  const due = previous && previous.end.getTime() >= lead.getTime() ? next.start : lead
  return {
    generationKey: spotTaskKey(roomId, next.bookingId),
    roomId,
    bookingId: next.bookingId,
    taskType: 'spot',
    plannedStartAt: previous ? previous.end : null,
    dueAt: due,
    urgent,
    reason: previous ? '予約間の清掃' : '割当変更により清掃が必要',
  }
}

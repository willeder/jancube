import { type LocalDate, minuteOfBusinessDay, slotStates } from '@jancube/domain'
import {
  type BookingDeps,
  bookingRules,
  laneLoad,
  lanePricing,
  loadDayContext,
} from './booking-context'

export interface AvailabilityLane {
  readonly key: string
  readonly kind: 'group' | 'room'
  readonly label: string
  readonly groupName: string
  /** Rooms in service for this lane (shown as 「全N室」 for group lanes). */
  readonly roomCount: number
  readonly description: string | null
  readonly hourlyRate: number
  readonly minimumMinutes: number
  readonly slots: readonly {
    readonly start: string
    readonly minuteOfDay: number
    readonly available: boolean
  }[]
}

export interface DayAvailability {
  readonly store: { readonly code: string; readonly name: string }
  readonly date: LocalDate
  readonly opensMinute: number
  readonly closesMinute: number
  readonly lanes: readonly AvailabilityLane[]
}

/** C-03 空き表: 30-minute availability per room type (group) or per named room. */
export function makeGetDayAvailability(deps: BookingDeps) {
  return async function getDayAvailability(
    storeCode: string,
    date: LocalDate,
  ): Promise<DayAvailability> {
    const ctx = await loadDayContext(deps, storeCode, date)
    const buffer = ctx.store.booking.cleaningBufferMinutes

    const lanes = await Promise.all(
      ctx.lanes.map(async (lane): Promise<AvailabilityLane> => {
        const priced = await lanePricing(deps, lane, ctx.window.opensAt)
        const slots = slotStates(
          ctx.window,
          laneLoad(ctx.inventory, lane, buffer),
          ctx.now,
          bookingRules(priced),
        )
        return {
          key: lane.key,
          kind: lane.kind,
          label: lane.room ? lane.room.name : lane.group.name,
          groupName: lane.group.name,
          roomCount: lane.rooms.length,
          description: lane.room?.description ?? null,
          hourlyRate: priced.profile.hourlyRate,
          minimumMinutes: priced.minimumMinutes,
          slots: slots.map((s) => ({
            start: s.start.toISOString(),
            minuteOfDay: minuteOfBusinessDay(date, s.start, ctx.store.timezone),
            available: s.available,
          })),
        }
      }),
    )

    return {
      store: { code: ctx.store.code, name: ctx.store.name },
      date,
      opensMinute: ctx.window.opensMinute,
      closesMinute: ctx.window.closesMinute,
      lanes,
    }
  }
}

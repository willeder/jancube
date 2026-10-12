import {
  calculatePrice,
  DomainError,
  endOptions,
  type LocalDate,
  minuteOfBusinessDay,
  type PriceQuote,
} from '@jancube/domain'
import {
  type BookingDeps,
  bookingRules,
  findLane,
  laneLoad,
  lanePricing,
  loadDayContext,
} from './booking-context'

export interface EndOption {
  readonly end: string
  readonly endMinuteOfDay: number
  readonly durationMinutes: number
  readonly quote: PriceQuote
}

/**
 * C-03: after the customer taps a start time, the end times they can choose, each with its price
 * (終了時刻別料金比較, F-PRC-06).
 */
export function makeGetEndOptions(deps: BookingDeps) {
  return async function getEndOptions(input: {
    storeCode: string
    date: LocalDate
    laneKey: string
    start: string
  }): Promise<EndOption[]> {
    const ctx = await loadDayContext(deps, input.storeCode, input.date)
    const lane = findLane(ctx, input.laneKey)
    const start = new Date(input.start)
    if (Number.isNaN(start.getTime())) throw new DomainError('invalid_time', 'invalid start time')

    const priced = await lanePricing(deps, lane, start)
    const load = laneLoad(ctx.inventory, lane, ctx.store.booking.cleaningBufferMinutes)
    return endOptions(ctx.window, load, start, ctx.now, bookingRules(priced)).map((end) => {
      const durationMinutes = (end.getTime() - start.getTime()) / 60_000
      return {
        end: end.toISOString(),
        endMinuteOfDay: minuteOfBusinessDay(input.date, end, ctx.store.timezone),
        durationMinutes,
        quote: calculatePrice(durationMinutes, priced.profile),
      }
    })
  }
}

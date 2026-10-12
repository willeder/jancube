import {
  addDays,
  addMinutes,
  type LocalDate,
  type OccupancyLevel,
  type OpeningWindow,
  occupancyLevel,
  openingWindow,
} from '@jancube/domain'
import {
  BOOKING_LEAD_MINUTES,
  type BookingDeps,
  bookableDateRange,
  rangeMinutes,
  requireStore,
} from './booking-context'

export type CalendarDayStatus = OccupancyLevel | 'closed' | 'not_bookable'

export interface BookingCalendar {
  readonly store: { readonly code: string; readonly name: string }
  readonly today: LocalDate
  readonly firstBookable: LocalDate
  readonly lastBookable: LocalDate
  readonly days: readonly { readonly date: LocalDate; readonly status: CalendarDayStatus }[]
}

/** C-02 日付選択: bookable dates with a ○/△/✕ indicator. */
export function makeGetBookingCalendar(deps: BookingDeps) {
  return async function getBookingCalendar(storeCode: string): Promise<BookingCalendar> {
    const store = await requireStore(deps, storeCode)
    const now = deps.clock.now()
    const { today, first, last } = bookableDateRange(store, now)
    const [weekly, overrides] = await Promise.all([
      deps.stores.weeklyHours(store.id),
      deps.stores.calendarOverrides(store.id, today, last),
    ])

    const windows = new Map<LocalDate, OpeningWindow | null>()
    for (let d = today; d <= last; d = addDays(d, 1)) {
      windows.set(
        d,
        openingWindow(
          d,
          store.timezone,
          weekly,
          overrides.find((o) => o.date === d),
        ),
      )
    }
    const open = [...windows.values()].filter((w): w is OpeningWindow => w !== null)
    const firstOpen = open[0]
    const lastOpen = open.at(-1)
    const inventory =
      firstOpen && lastOpen
        ? await deps.inventory.load(store.id, firstOpen.opensAt, lastOpen.closesAt, now)
        : { groups: [], rooms: [], bookings: [], blocks: [] }

    const earliestStart = addMinutes(now, BOOKING_LEAD_MINUTES)
    const days = [...windows.entries()].map(([date, window]) => {
      if (date < first) return { date, status: 'not_bookable' as const }
      if (!window) return { date, status: 'closed' as const }
      const from = window.opensAt > earliestStart ? window.opensAt : earliestStart
      if (from >= window.closesAt) return { date, status: 'full' as const }
      const capacity =
        inventory.rooms.length *
        rangeMinutes({ start: from, end: window.closesAt }, from, window.closesAt)
      const used =
        inventory.bookings.reduce(
          (sum, b) => sum + rangeMinutes(b.range, from, window.closesAt),
          0,
        ) +
        inventory.blocks.reduce((sum, b) => sum + rangeMinutes(b.range, from, window.closesAt), 0)
      return { date, status: occupancyLevel(capacity, used) }
    })

    return {
      store: { code: store.code, name: store.name },
      today,
      firstBookable: first,
      lastBookable: last,
      days,
    }
  }
}

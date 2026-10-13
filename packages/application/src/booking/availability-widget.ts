import {
  addDays,
  addMinutes,
  DomainError,
  type LocalDate,
  minuteOfBusinessDay,
  slotStates,
} from '@jancube/domain'
import {
  type BookingDeps,
  bookableDateRange,
  bookingRules,
  type DayContext,
  laneLoad,
  lanePricing,
  loadDayContext,
  requireStore,
} from './booking-context'

/** One column of the widget: two hours. */
export const WIDGET_BLOCK_MINUTES = 120

/** ◯ mostly free / △ few left / ✕ full / – past or outside opening hours / 休 closed day. */
export type WidgetCell = 'available' | 'few' | 'full' | 'past' | 'closed'

export interface AvailabilityWidget {
  readonly store: { readonly code: string; readonly name: string }
  readonly generatedAt: Date
  readonly dates: readonly LocalDate[]
  /** Start minute (from local midnight) of each two-hour column. */
  readonly blocks: readonly number[]
  readonly roomTypes: readonly {
    readonly code: string
    readonly name: string
    readonly rows: readonly { readonly date: LocalDate; readonly cells: readonly WidgetCell[] }[]
  }[]
}

/** Share of free 30-minute cells below which a block shows △. */
const FEW_THRESHOLD = 0.5

/**
 * C-23 空き状況ウィジェット (WordPress embed, Q-01): today and the next days per room type, in
 * two-hour blocks. A hint only; the exact time is chosen in the booking flow (C-02/C-03).
 */
export function makeGetAvailabilityWidget(deps: BookingDeps) {
  return async function getAvailabilityWidget(
    storeCode: string,
    days = 3,
  ): Promise<AvailabilityWidget> {
    const store = await requireStore(deps, storeCode)
    const now = deps.clock.now()
    const { first, last } = bookableDateRange(store, now)
    const count = Math.max(1, Math.min(days, 7))
    const dates = Array.from({ length: count }, (_, i) => addDays(first, i))

    const contexts = await Promise.all(
      dates.map(async (date) => {
        if (date > last) return null
        try {
          return await loadDayContext(deps, storeCode, date)
        } catch (error) {
          if (error instanceof DomainError) return null
          throw error
        }
      }),
    )
    const open = contexts.filter((c): c is DayContext => c !== null)
    const opens = Math.min(...open.map((c) => c.window.opensMinute))
    const closes = Math.max(...open.map((c) => c.window.closesMinute))
    const blocks: number[] = []
    for (let m = opens; open.length > 0 && m < closes; m += WIDGET_BLOCK_MINUTES) blocks.push(m)

    // Room types in display order, from any open day.
    const types = new Map<number, { code: string; name: string }>()
    for (const ctx of open) {
      for (const lane of ctx.lanes) {
        if (!types.has(lane.group.id)) {
          types.set(lane.group.id, { code: lane.group.code, name: lane.group.name })
        }
      }
    }

    // Per date and room type: [free, future] 30-minute cells for each block.
    const counts = new Map<string, number[][]>()
    for (const [i, ctx] of contexts.entries()) {
      if (!ctx) continue
      const date = dates[i] as LocalDate
      for (const lane of ctx.lanes) {
        const priced = await lanePricing(deps, lane, ctx.window.opensAt)
        const slots = slotStates(
          ctx.window,
          laneLoad(ctx.inventory, lane, ctx.store.booking.cleaningBufferMinutes),
          now,
          bookingRules(priced),
        )
        const key = `${date}:${lane.group.id}`
        const tally = counts.get(key) ?? blocks.map(() => [0, 0, 0])
        for (const slot of slots) {
          const minute = minuteOfBusinessDay(date, slot.start, ctx.store.timezone)
          const b = Math.floor((minute - opens) / WIDGET_BLOCK_MINUTES)
          const cell = tally[b]
          if (!cell) continue
          cell[2] = (cell[2] ?? 0) + 1
          if (addMinutes(slot.start, 30) <= now) continue
          cell[1] = (cell[1] ?? 0) + 1
          if (slot.available) cell[0] = (cell[0] ?? 0) + 1
        }
        counts.set(key, tally)
      }
    }

    return {
      store: { code: store.code, name: store.name },
      generatedAt: now,
      dates,
      blocks,
      roomTypes: [...types.entries()].map(([groupId, type]) => ({
        ...type,
        rows: dates.map((date, i) => ({
          date,
          cells: blocks.map((_, b): WidgetCell => {
            if (!contexts[i]) return 'closed'
            const [free = 0, future = 0, total = 0] = counts.get(`${date}:${groupId}`)?.[b] ?? []
            if (total === 0) return 'closed'
            if (future === 0) return 'past'
            if (free === 0) return 'full'
            return free / future < FEW_THRESHOLD ? 'few' : 'available'
          }),
        })),
      })),
    }
  }
}

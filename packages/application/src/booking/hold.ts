import {
  addMinutes,
  assertBookable,
  calculatePrice,
  createTimeRange,
  DomainError,
  durationMinutes,
  type LocalDate,
} from '@jancube/domain'
import type { BookingRepository, BookingSummary, DraftContact } from '../ports/booking-repository'
import {
  type BookingDeps,
  bookingRules,
  findLane,
  laneLoad,
  lanePricing,
  loadDayContext,
} from './booking-context'

export interface HoldDeps extends BookingDeps {
  readonly bookings: BookingRepository
  /** Random, unguessable key generator (crypto.randomUUID in production). */
  readonly newRequestKey: () => string
}

export interface CreateHoldInput {
  readonly storeCode: string
  readonly date: LocalDate
  readonly laneKey: string
  readonly start: string
  readonly end: string
  readonly source: 'web' | 'liff' | 'proxy'
  /**
   * Phone booking taken by staff (A-06, source = proxy): held for the store's proxy hold time while the
   * customer pays through the payment link.
   */
  readonly proxy?: {
    readonly staffId: number
    readonly guestCount: number
    readonly contact: DraftContact
  }
  /** Hold the customer already has (replaced by the new one). */
  readonly previousRequestKey?: string | null
  readonly acquisition?: Partial<{
    source: string
    utmSource: string
    utmMedium: string
    utmCampaign: string
    utmContent: string
  }>
}

/**
 * C-03 → C-04: place a time-limited hold (draft booking) on the selected time (F-BK-08).
 * Availability is re-checked inside the inventory lock, so two customers cannot both take the last room.
 */
export function makeCreateHold(deps: HoldDeps) {
  return async function createHold(
    input: CreateHoldInput,
  ): Promise<{ requestKey: string; bookingCode: string }> {
    if ((input.source === 'proxy') !== (input.proxy !== undefined)) {
      throw new Error('proxy bookings need the staff member and customer (and only they do)')
    }
    const ctx = await loadDayContext(deps, input.storeCode, input.date)
    const lane = findLane(ctx, input.laneKey)
    const guestCount = input.proxy?.guestCount ?? lane.group.capacity
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > lane.group.capacity) {
      throw new DomainError(
        'invalid_guest_count',
        `guests must be between 1 and ${lane.group.capacity}`,
      )
    }
    const holdMinutes = input.proxy
      ? ctx.store.booking.proxyHoldMinutes
      : ctx.store.booking.holdMinutes
    const range = createTimeRange(new Date(input.start), new Date(input.end))
    const priced = await lanePricing(deps, lane, range.start)
    const rules = bookingRules(priced)

    if (input.previousRequestKey) await deps.bookings.expireDraft(input.previousRequestKey, ctx.now)

    const requestKey = deps.newRequestKey()
    const quote = calculatePrice(durationMinutes(range), priced.profile)
    const created = await deps.bookings.withInventoryLock(lane.group.id, input.date, async (tx) => {
      const inventory = await tx.loadInventory(
        ctx.store.id,
        ctx.window.opensAt,
        ctx.window.closesAt,
        ctx.now,
      )
      const lockedLane = {
        ...lane,
        rooms: lane.rooms.filter((r) => inventory.rooms.some((x) => x.id === r.id)),
      }
      assertBookable(
        ctx.window,
        laneLoad(inventory, lockedLane, ctx.store.booking.cleaningBufferMinutes),
        range,
        ctx.now,
        rules,
      )
      return tx.createDraft({
        storeId: ctx.store.id,
        roomGroupId: lane.group.id,
        requestedRoomId: lane.room?.id ?? null,
        businessDate: input.date,
        start: range.start,
        end: range.end,
        guestCount,
        source: input.source,
        createdByStaffId: input.proxy?.staffId ?? null,
        contact: input.proxy?.contact ?? null,
        requestKey,
        holdExpiresAt: addMinutes(ctx.now, holdMinutes),
        priceVersionId: priced.priceVersionId,
        taxRatePercent: priced.taxRatePercent,
        quote,
        acquisition: {
          source: input.acquisition?.source ?? null,
          utmSource: input.acquisition?.utmSource ?? null,
          utmMedium: input.acquisition?.utmMedium ?? null,
          utmCampaign: input.acquisition?.utmCampaign ?? null,
          utmContent: input.acquisition?.utmContent ?? null,
        },
      })
    })
    return { requestKey, bookingCode: created.bookingCode }
  }
}

/** The customer's current hold, or an error if it is missing or has expired (C-04 onward). */
export function makeGetActiveHold(deps: Pick<HoldDeps, 'bookings' | 'clock'>) {
  return async function getActiveHold(
    requestKey: string | null | undefined,
  ): Promise<BookingSummary> {
    const booking = requestKey ? await deps.bookings.findByRequestKey(requestKey) : null
    if (!booking) throw new DomainError('hold_not_found', 'no booking in progress')
    if (booking.status !== 'draft')
      throw new DomainError('hold_not_active', 'this booking is no longer in progress')
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= deps.clock.now()) {
      throw new DomainError('hold_expired', 'the hold has expired')
    }
    return booking
  }
}

/** C-04: number of guests (ご利用人数), 1 … room capacity. */
export function makeSetGuestCount(deps: Pick<HoldDeps, 'bookings' | 'clock'>) {
  const getActiveHold = makeGetActiveHold(deps)
  return async function setGuestCount(requestKey: string, guestCount: number): Promise<void> {
    const hold = await getActiveHold(requestKey)
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > hold.capacity) {
      throw new DomainError('invalid_guest_count', `guests must be between 1 and ${hold.capacity}`)
    }
    await deps.bookings.setGuestCount(requestKey, guestCount)
  }
}

/** Customer abandons or changes the selection: free the inventory immediately. */
export function makeReleaseHold(deps: Pick<HoldDeps, 'bookings' | 'clock'>) {
  return async function releaseHold(requestKey: string): Promise<void> {
    await deps.bookings.expireDraft(requestKey, deps.clock.now())
  }
}

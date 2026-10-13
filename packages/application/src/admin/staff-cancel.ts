import { DomainError, type StaffAccess } from '@jancube/domain'
import {
  type CancelDeps,
  makeCancelBooking,
  makeQuoteCancellation,
} from '../booking/cancel-booking'
import { assertStoreAccess, staffActor } from './access'

async function requireCancellable(deps: CancelDeps, access: StaffAccess, bookingCode: string) {
  const booking = await deps.bookings.findByCode(bookingCode)
  if (!booking) throw new DomainError('booking_not_found', 'booking not found')
  assertStoreAccess(access, 'bookings.cancel', booking.storeId)
  return booking
}

/** A-08: fee and refund preview for staff (same rules as C-15). */
export function makeStaffQuoteCancellation(deps: CancelDeps) {
  const quote = makeQuoteCancellation(deps)
  return async function staffQuoteCancellation(access: StaffAccess, bookingCode: string) {
    await requireCancellable(deps, access, bookingCode)
    return quote(bookingCode)
  }
}

/**
 * A-08 管理側キャンセル・返金: cancel with the automatic fee, or with a fee rate entered by staff (reason
 * required, recorded on the cancellation and in the audit log). Refund failures are left as failed
 * refunds to retry on A-26.
 */
export function makeStaffCancelBooking(deps: CancelDeps) {
  const cancel = makeCancelBooking(deps)
  return async function staffCancelBooking(
    access: StaffAccess,
    input: {
      readonly bookingCode: string
      readonly overrideFeeRate: number | null
      readonly reason: string | null
    },
  ) {
    await requireCancellable(deps, access, input.bookingCode)
    return cancel({
      bookingCode: input.bookingCode,
      actor: staffActor(access),
      overrideFeeRate: input.overrideFeeRate,
      reason: input.reason,
    })
  }
}

import 'server-only'
import {
  makeAttachMemberToHold,
  makeCancelBooking,
  makeClaimCouponCode,
  makeConfirmCheckout,
  makeCreateHold,
  makeFailCheckout,
  makeGetActiveHold,
  makeGetBookingCalendar,
  makeGetCompletedBooking,
  makeGetDayAvailability,
  makeGetEndOptions,
  makeGetPaymentOptions,
  makeGetSignInChallenge,
  makeHandlePaymentWebhook,
  makeListStores,
  makeQuoteCancellation,
  makeRegisterMember,
  makeReleaseHold,
  makeResendSignInCode,
  makeSendSignInCode,
  makeSetGuestCount,
  makeStartCheckout,
  makeSyncCheckout,
  makeVerifySignInCode,
} from '@jancube/application'
import type { Deps } from '../deps'

/** C-01〜C-11 booking flow, sign-in, payment, and cancellation (shared with A-08). */
export function customerBookingFeatures(deps: Deps) {
  const { booking, hold, signIn, checkout, members } = deps
  const confirmCheckout = makeConfirmCheckout(checkout)
  const failCheckout = makeFailCheckout(checkout)
  const cancelDeps = {
    bookings: deps.bookings,
    checkouts: checkout.checkouts,
    gateway: checkout.gateway,
    legalDocuments: deps.legalDocuments,
    audit: deps.audit,
    clock: deps.clock,
  }
  return {
    listStores: makeListStores({ stores: deps.stores }),
    getBookingCalendar: makeGetBookingCalendar(booking),
    getDayAvailability: makeGetDayAvailability(booking),
    getEndOptions: makeGetEndOptions(booking),
    createHold: makeCreateHold(hold),
    getActiveHold: makeGetActiveHold(hold),
    setGuestCount: makeSetGuestCount(hold),
    releaseHold: makeReleaseHold(hold),
    sendSignInCode: makeSendSignInCode(signIn),
    resendSignInCode: makeResendSignInCode(signIn),
    getSignInChallenge: makeGetSignInChallenge(signIn),
    verifySignInCode: makeVerifySignInCode(signIn),
    registerMember: makeRegisterMember(signIn),
    attachMemberToHold: makeAttachMemberToHold({
      bookings: deps.bookings,
      members,
      clock: deps.clock,
    }),
    findMember: (id: number) => members.findById(id),
    getPaymentOptions: makeGetPaymentOptions(checkout),
    claimCouponCode: makeClaimCouponCode(checkout),
    startCheckout: makeStartCheckout(checkout),
    syncCheckout: makeSyncCheckout(checkout),
    handlePaymentWebhook: makeHandlePaymentWebhook(checkout),
    getCompletedBooking: makeGetCompletedBooking(checkout),
    quoteCancellation: makeQuoteCancellation(cancelDeps),
    cancelBooking: makeCancelBooking(cancelDeps),
    /** Development only: the local checkout page reports success or cancellation. */
    completeDevCheckout: async (checkoutId: string, outcome: 'paid' | 'canceled') => {
      if (checkout.gateway.provider !== 'dev') throw new Error('dev checkout is disabled')
      if (outcome === 'canceled') return failCheckout(checkoutId, 'canceled on dev checkout')
      const record = await checkout.checkouts.findByCheckout(checkoutId)
      if (!record) throw new Error('unknown checkout')
      return confirmCheckout(checkoutId, {
        externalPaymentId: `dev_pi_${record.paymentId}`,
        amount: record.amount,
      })
    },
  }
}

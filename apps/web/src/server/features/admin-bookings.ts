import 'server-only'
import {
  type CancelDeps,
  makeAssignAlert,
  makeCreateProxyBooking,
  makeCreateRoomBlock,
  makeGetBookingDetail,
  makeGetDashboard,
  makeGetDayAvailability,
  makeGetEndOptions,
  makeGetPaymentLink,
  makeGetTimeline,
  makeListAlerts,
  makeListBlockRooms,
  makeListPaymentHistory,
  makeListPaymentLinks,
  makeListRoomBlocks,
  makeLookupMemberByPhone,
  makeOpenPaymentLink,
  makeReleaseRoomBlock,
  makeResendNotification,
  makeResolveAlert,
  makeRetryRefund,
  makeSearchBookings,
  makeStaffCancelBooking,
  makeStaffQuoteCancellation,
} from '@jancube/application'
import {
  KyselyAdminBookingQueries,
  KyselyAlertWorkRepository,
  KyselyNotificationResendRepository,
  KyselyPaymentHistoryRepository,
  KyselyPaymentLinkRepository,
  KyselyRoomBlockRepository,
} from '@jancube/infrastructure'
import type { Deps } from '../deps'

/**
 * Admin booking operations: A-02 dashboard, A-03 timeline, A-04/A-05 bookings, A-06 proxy booking
 * with payment link (and its C-18 landing page), A-08 cancellation, A-22 blocks, A-25 alerts,
 * A-26 payments. Every use case checks the staff member's permission and store scope itself.
 */
export function adminBookingFeatures(deps: Deps) {
  const queries = new KyselyAdminBookingQueries(deps.db)
  const alerts = new KyselyAlertWorkRepository(deps.db)
  const paymentLinks = new KyselyPaymentLinkRepository(deps.db)
  const blockDeps = {
    blocks: new KyselyRoomBlockRepository(deps.db),
    stores: deps.stores,
    audit: deps.audit,
    clock: deps.clock,
  }
  const alertDeps = { alerts, audit: deps.audit, clock: deps.clock }
  const cancelDeps: CancelDeps = {
    bookings: deps.bookings,
    checkouts: deps.checkout.checkouts,
    gateway: deps.checkout.gateway,
    legalDocuments: deps.legalDocuments,
    audit: deps.audit,
    clock: deps.clock,
  }
  const proxyDeps = {
    ...deps.hold,
    members: deps.members,
    paymentLinks,
    hasher: deps.hasher,
    random: deps.random,
    notify: deps.notify,
    audit: deps.audit,
    appUrl: deps.config.appUrl,
  }
  const landingDeps = {
    paymentLinks,
    hasher: deps.hasher,
    bookings: deps.bookings,
    members: deps.members,
    clock: deps.clock,
  }
  const paymentDeps = {
    history: new KyselyPaymentHistoryRepository(deps.db),
    checkouts: deps.checkout.checkouts,
    gateway: deps.checkout.gateway,
    alerts: deps.alerts,
    audit: deps.audit,
    clock: deps.clock,
  }
  return {
    getDashboard: makeGetDashboard({ queries, alerts, stores: deps.stores, clock: deps.clock }),
    getTimeline: makeGetTimeline({ queries, stores: deps.stores, clock: deps.clock }),
    searchBookings: makeSearchBookings({ queries }),
    getBookingDetail: makeGetBookingDetail({ queries }),
    resendNotification: makeResendNotification({
      deliveries: new KyselyNotificationResendRepository(deps.db),
      audit: deps.audit,
      clock: deps.clock,
    }),
    /** A-06 availability uses the same rules as C-03. */
    adminDayAvailability: makeGetDayAvailability(deps.booking),
    adminEndOptions: makeGetEndOptions(deps.booking),
    lookupMemberByPhone: makeLookupMemberByPhone(proxyDeps),
    createProxyBooking: makeCreateProxyBooking(proxyDeps),
    listPaymentLinks: makeListPaymentLinks(proxyDeps),
    getPaymentLink: makeGetPaymentLink(landingDeps),
    openPaymentLink: makeOpenPaymentLink(landingDeps),
    staffQuoteCancellation: makeStaffQuoteCancellation(cancelDeps),
    staffCancelBooking: makeStaffCancelBooking(cancelDeps),
    listRoomBlocks: makeListRoomBlocks(blockDeps),
    listBlockRooms: makeListBlockRooms(blockDeps),
    createRoomBlock: makeCreateRoomBlock(blockDeps),
    releaseRoomBlock: makeReleaseRoomBlock(blockDeps),
    listAlerts: makeListAlerts(alertDeps),
    assignAlert: makeAssignAlert(alertDeps),
    resolveAlert: makeResolveAlert(alertDeps),
    listPaymentHistory: makeListPaymentHistory(paymentDeps),
    retryRefund: makeRetryRefund(paymentDeps),
  }
}

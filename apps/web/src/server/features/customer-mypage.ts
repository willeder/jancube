import 'server-only'
import {
  type ChangeDeps,
  type MyPageDeps,
  makeChangeBooking,
  makeGetAvailabilityWidget,
  makeGetChangeAvailability,
  makeGetChangeableBooking,
  makeGetChangeEndOptions,
  makeGetLegalDocument,
  makeGetMyAccount,
  makeGetMyBookingDetail,
  makeGetMyPage,
  makeGetMyReceipt,
  makeIssueMyReceipt,
  makeListMyCoupons,
  makeQuoteBookingChange,
  makeQuoteMyCancellation,
  makeUpdateMyEmail,
  makeUpdateMyNotificationChannel,
  makeWithdrawMember,
  type ReceiptIssuer,
} from '@jancube/application'
import {
  KyselyBookingChangeRepository,
  KyselyLegalTextRepository,
  KyselyMyPageRepository,
  KyselyReceiptRepository,
} from '@jancube/infrastructure'
import type { Deps } from '../deps'

/**
 * Issuer printed on receipts (C-19). PLACEHOLDER values until the client provides the company name,
 * address and qualified-invoice registration number (適格請求書発行事業者登録番号).
 */
export const RECEIPT_ISSUER = {
  companyName: '株式会社アクトプロ',
  address: '（住所はクライアント確認中）',
  invoiceRegistrationNo: 'T0000000000000',
} as const

const receiptIssuer = (storeName: string): ReceiptIssuer => ({
  name: `${RECEIPT_ISSUER.companyName} 雀CUBE ${storeName}`,
  address: RECEIPT_ISSUER.address,
  invoiceRegistrationNo: RECEIPT_ISSUER.invoiceRegistrationNo,
})

/** C-12〜C-17, C-19, C-20, C-23: member's page, booking change, receipts, legal texts, widget. */
export function customerMyPageFeatures(deps: Deps) {
  const myPage: MyPageDeps = {
    myPage: new KyselyMyPageRepository(deps.db),
    secrets: deps.secrets,
    audit: deps.audit,
    clock: deps.clock,
  }
  const change: ChangeDeps = {
    ...deps.booking,
    changes: new KyselyBookingChangeRepository(deps.db),
    members: deps.members,
    coupons: deps.coupons,
    checkouts: deps.checkout.checkouts,
    gateway: deps.checkout.gateway,
    legalDocuments: deps.legalDocuments,
    audit: deps.audit,
  }
  const receipts = {
    receipts: new KyselyReceiptRepository(deps.db),
    issuer: receiptIssuer,
    audit: deps.audit,
    clock: deps.clock,
  }
  return {
    getMyPage: makeGetMyPage(myPage),
    getMyBookingDetail: makeGetMyBookingDetail(myPage),
    quoteMyCancellation: makeQuoteMyCancellation({
      bookings: deps.bookings,
      checkouts: deps.checkout.checkouts,
      gateway: deps.checkout.gateway,
      legalDocuments: deps.legalDocuments,
      audit: deps.audit,
      clock: deps.clock,
    }),
    listMyCoupons: makeListMyCoupons(myPage),
    getMyAccount: makeGetMyAccount(myPage),
    updateMyEmail: makeUpdateMyEmail(myPage),
    updateMyNotificationChannel: makeUpdateMyNotificationChannel(myPage),
    withdrawMember: makeWithdrawMember(myPage),
    getChangeableBooking: makeGetChangeableBooking(change),
    getChangeAvailability: makeGetChangeAvailability(change),
    getChangeEndOptions: makeGetChangeEndOptions(change),
    quoteBookingChange: makeQuoteBookingChange(change),
    changeBooking: makeChangeBooking(change),
    getMyReceipt: makeGetMyReceipt(receipts),
    issueMyReceipt: makeIssueMyReceipt(receipts),
    getLegalDocument: makeGetLegalDocument({
      legalTexts: new KyselyLegalTextRepository(deps.db),
      clock: deps.clock,
    }),
    getAvailabilityWidget: makeGetAvailabilityWidget(deps.booking),
  }
}

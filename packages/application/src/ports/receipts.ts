import type { TaxLine } from '@jancube/domain'
import type { BookingStatus } from './booking-repository'
import type { PaymentMethod } from './checkout'

/** What a receipt is issued for (C-19). */
export interface ReceiptSource {
  readonly bookingId: number
  readonly bookingCode: string
  readonly memberId: number | null
  readonly status: BookingStatus
  readonly end: Date
  readonly storeName: string
  /** The booking's first succeeded payment (receipts.payment_id); null when nothing was paid. */
  readonly paymentId: number | null
  readonly method: PaymentMethod | 'other' | null
  readonly paidAt: Date | null
  /** Sum of succeeded payments. */
  readonly paid: number
  /** Sum of refunds requested, in progress or done. */
  readonly refunded: number
  readonly taxRatePercent: number
}

/** Issuer shown on receipts (company name, address, invoice registration number). */
export interface ReceiptIssuer {
  readonly name: string
  readonly address: string
  readonly invoiceRegistrationNo: string | null
}

export interface IssuedReceipt {
  readonly id: number
  readonly receiptNumber: string
  readonly sequence: number
  readonly recipientName: string
  readonly issuerName: string
  readonly issuerAddress: string
  readonly invoiceRegistrationNo: string | null
  readonly total: number
  readonly tax: number
  readonly issuedAt: Date
  readonly lines: readonly TaxLine[]
}

export interface ReceiptRepository {
  source(bookingCode: string): Promise<ReceiptSource | null>
  /** The receipt currently valid for the booking (earlier issues are void). */
  current(bookingId: number): Promise<IssuedReceipt | null>
  /**
   * One transaction: next issue sequence for the booking, earlier receipts voided, receipt and tax
   * lines stored. The printable page is rendered from these rows (no PDF file yet).
   */
  issue(input: {
    readonly bookingId: number
    readonly bookingCode: string
    readonly paymentId: number
    readonly recipientName: string
    readonly issuer: ReceiptIssuer
    readonly lines: readonly TaxLine[]
    readonly issuedAt: Date
  }): Promise<IssuedReceipt>
}

import type {
  BookingStatus,
  IssuedReceipt,
  PaymentMethod,
  ReceiptRepository,
  ReceiptSource,
} from '@jancube/application'
import { receiptNumber } from '@jancube/domain'
import type { Database } from './create-db'
import { toNumber } from './sql-values'

async function sha256(text: string): Promise<Buffer> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** C-19 / A-26 領収書. */
export class KyselyReceiptRepository implements ReceiptRepository {
  constructor(private readonly db: Database) {}

  async source(bookingCode: string): Promise<ReceiptSource | null> {
    const b = await this.db
      .selectFrom('bookings as b')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .select(['b.id', 'b.booking_code', 'b.member_id', 'b.status', 'b.ends_at', 's.name'])
      .select((eb) =>
        eb
          .selectFrom('price_calculations as pc')
          .select('pc.tax_rate')
          .whereRef('pc.booking_id', '=', 'b.id')
          .orderBy('pc.revision_no', 'desc')
          .limit(1)
          .as('tax_rate'),
      )
      .where('b.booking_code', '=', bookingCode)
      .executeTakeFirst()
    if (!b) return null
    const bookingId = Number(b.id)
    const [payments, refunded] = await Promise.all([
      this.db
        .selectFrom('payments')
        .select(['id', 'method', 'amount', 'paid_at'])
        .where('booking_id', '=', bookingId)
        .where('status', '=', 'succeeded')
        .orderBy('paid_at')
        .orderBy('id')
        .execute(),
      this.db
        .selectFrom('refunds')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('amount'), eb.lit(0)).as('n'))
        .where('booking_id', '=', bookingId)
        .where('status', 'in', ['requested', 'processing', 'succeeded'])
        .executeTakeFirstOrThrow(),
    ])
    const first = payments[0]
    return {
      bookingId,
      bookingCode: b.booking_code,
      memberId: b.member_id === null ? null : Number(b.member_id),
      status: b.status as BookingStatus,
      end: b.ends_at,
      storeName: b.name,
      paymentId: first ? Number(first.id) : null,
      method: first ? (first.method as PaymentMethod | 'other') : null,
      paidAt: first?.paid_at ?? null,
      paid: payments.reduce((sum, p) => sum + Number(p.amount), 0),
      refunded: Number(refunded.n),
      taxRatePercent: b.tax_rate === null ? 10 : toNumber(b.tax_rate),
    }
  }

  async current(bookingId: number): Promise<IssuedReceipt | null> {
    const row = await this.db
      .selectFrom('receipts')
      .selectAll()
      .where('booking_id', '=', bookingId)
      .where('status', '=', 'issued')
      .where('document_type', '=', 'receipt')
      .orderBy('issue_sequence', 'desc')
      .limit(1)
      .executeTakeFirst()
    if (!row) return null
    const lines = await this.db
      .selectFrom('receipt_tax_lines')
      .select(['tax_rate', 'taxable_amount', 'tax_amount', 'gross_amount'])
      .where('receipt_id', '=', row.id)
      .orderBy('tax_rate', 'desc')
      .execute()
    return {
      id: Number(row.id),
      receiptNumber: row.receipt_number,
      sequence: row.issue_sequence,
      recipientName: row.recipient_name,
      issuerName: row.issuer_name,
      issuerAddress: row.issuer_address,
      invoiceRegistrationNo: row.invoice_registration_no,
      total: Number(row.total_amount),
      tax: Number(row.tax_amount),
      issuedAt: row.issued_at,
      lines: lines.map((l) => ({
        ratePercent: toNumber(l.tax_rate),
        taxable: Number(l.taxable_amount),
        tax: Number(l.tax_amount),
        gross: Number(l.gross_amount),
      })),
    }
  }

  async issue(input: Parameters<ReceiptRepository['issue']>[0]): Promise<IssuedReceipt> {
    const id = await this.db.transaction().execute(async (trx) => {
      // Serializes concurrent issues for the same booking (sequence numbers stay unique).
      await trx
        .selectFrom('bookings')
        .select('id')
        .where('id', '=', input.bookingId)
        .forUpdate()
        .execute()
      const last = await trx
        .selectFrom('receipts')
        .select((eb) => eb.fn.max('issue_sequence').as('n'))
        .where('booking_id', '=', input.bookingId)
        .executeTakeFirst()
      const sequence = Number(last?.n ?? 0) + 1
      const number = receiptNumber(input.bookingCode, sequence)
      const total = input.lines.reduce((sum, l) => sum + l.gross, 0)
      const tax = input.lines.reduce((sum, l) => sum + l.tax, 0)
      await trx
        .updateTable('receipts')
        .set({ status: 'void' })
        .where('booking_id', '=', input.bookingId)
        .where('status', '=', 'issued')
        .execute()
      // No PDF is stored yet: the printable page is rendered from these rows. The hash covers the
      // issued contents so later tampering with the row can be detected.
      const contents = JSON.stringify({
        number,
        recipient: input.recipientName,
        issuer: input.issuer,
        total,
        tax,
        lines: input.lines,
        issuedAt: input.issuedAt.toISOString(),
      })
      const inserted = await trx
        .insertInto('receipts')
        .values({
          payment_id: input.paymentId,
          booking_id: input.bookingId,
          receipt_number: number,
          issue_sequence: sequence,
          document_type: 'receipt',
          recipient_name: input.recipientName,
          issuer_name: input.issuer.name,
          issuer_address: input.issuer.address,
          invoice_registration_no: input.issuer.invoiceRegistrationNo,
          total_amount: total,
          tax_amount: tax,
          issued_at: input.issuedAt,
          pdf_object_key: `html:receipts/${number}`,
          pdf_sha256: await sha256(contents),
          status: 'issued',
        })
        .executeTakeFirstOrThrow()
      const receiptId = Number(inserted.insertId)
      await trx
        .insertInto('receipt_tax_lines')
        .values(
          input.lines.map((l) => ({
            receipt_id: receiptId,
            tax_rate: l.ratePercent,
            taxable_amount: l.taxable,
            tax_amount: l.tax,
            gross_amount: l.gross,
          })),
        )
        .execute()
      return receiptId
    })
    const issued = await this.current(input.bookingId)
    if (!issued || issued.id !== id) throw new Error('receipt was not stored')
    return issued
  }
}

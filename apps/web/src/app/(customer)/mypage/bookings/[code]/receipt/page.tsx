import { Card, Notice, PageHeader } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { localDate, yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { bookingPath, requireMemberPage } from '@/server/member-page'
import { PrintButton, ReceiptForm } from './ReceiptForm'

export const dynamic = 'force-dynamic'

const METHOD_LABEL: Record<string, string> = {
  card: 'クレジットカード',
  paypay: 'PayPay',
  other: 'その他',
}

const NOT_AVAILABLE: Record<string, string> = {
  not_used_yet: '領収書はご利用後に発行できます（ご利用前は発行できません）',
  nothing_paid: 'お支払いがないため、領収書は発行できません',
  not_issuable: 'このご予約の領収書は発行できません',
}

/** 但し書き */
const PURPOSE = '施設利用料として'

/** C-19 領収書 (F-PAY-07): issued after use or for a cancellation fee; printable. */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ issued?: string }>
}) {
  const { code } = await params
  const { issued } = await searchParams
  const back = bookingPath(code)
  const memberId = await requireMemberPage(bookingPath(code, '/receipt'))
  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(code, memberId)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref={back} />
  }
  const { receipt, availability, source, account } = view
  const defaultName = [account.familyName, account.givenName].filter(Boolean).join(' ')

  return (
    <>
      <PageHeader backHref={back} title="領収書" />
      <main className="mx-auto max-w-md space-y-4 px-4 py-4">
        <p className="rounded-lg bg-gold-pale p-3 text-xs print:hidden">
          🧾
          通常のご利用は「ご利用後」に、キャンセル料が発生した場合は「キャンセル確定後」に発行できます
        </p>
        {issued && (
          <Notice tone="success">
            {receipt && receipt.sequence > 1 ? '領収書を再発行しました' : '領収書を発行しました'}
          </Notice>
        )}

        {!availability.ok && !receipt && (
          <Notice tone="warn">
            {NOT_AVAILABLE[availability.reason] ?? NOT_AVAILABLE.not_issuable}
          </Notice>
        )}

        {receipt && (
          <article className="rounded-xl border border-ink bg-white p-5 text-sm print:border-0 print:p-0">
            <div className="flex items-start justify-between">
              <h2 className="text-xl font-bold tracking-widest">領収書</h2>
              {receipt.sequence > 1 && (
                <span className="rounded border border-alert px-2 py-0.5 text-xs font-bold text-alert">
                  再発行
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-sub">No. {receipt.receiptNumber}</p>
            <p className="mt-4 border-b border-ink pb-1 text-lg font-bold">
              {receipt.recipientName} 様
            </p>
            <p className="mt-4 text-center text-2xl font-bold tabular-nums">
              {yen(receipt.total)}（税込）
            </p>
            <p className="mt-1 text-center text-xs">但し {PURPOSE}</p>
            <dl className="mt-4 space-y-1 text-xs">
              <Line label="発行日" value={localDate(receipt.issuedAt, 'Asia/Tokyo')} />
              <Line label="予約番号" value={source.bookingCode} />
              {source.method && (
                <Line label="お支払方法" value={METHOD_LABEL[source.method] ?? source.method} />
              )}
              {receipt.lines.map((l) => (
                <div key={l.ratePercent} className="space-y-1">
                  <Line label={`小計（${l.ratePercent}%対象）`} value={yen(l.taxable)} />
                  <Line label={`消費税（${l.ratePercent}%）`} value={yen(l.tax)} />
                </div>
              ))}
              <Line label="合計" value={yen(receipt.total)} />
            </dl>
            <div className="mt-5 border-t border-line pt-3 text-xs">
              <p className="font-bold">{receipt.issuerName}</p>
              <p>{receipt.issuerAddress}</p>
              {receipt.invoiceRegistrationNo && <p>登録番号 {receipt.invoiceRegistrationNo}</p>}
            </div>
          </article>
        )}

        {receipt && <PrintButton />}

        {availability.ok && (
          <Card className="print:hidden">
            <h2 className="font-bold">{receipt ? '宛名を変えて再発行する' : '領収書を発行する'}</h2>
            <p className="mt-1 text-xs text-sub">
              {receipt
                ? '再発行すると以前の領収書は無効になり、「再発行」と表示されます'
                : `発行額 ${yen(view.amount)}（税込・お支払い額から返金額を除いた金額）`}
            </p>
            <ReceiptForm
              bookingCode={source.bookingCode}
              defaultName={receipt?.recipientName ?? defaultName}
              reissue={receipt !== null}
            />
          </Card>
        )}
      </main>
    </>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-sub">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function load(code: string, memberId: number) {
  return withContainer(async (c) => {
    const [receipt, account] = await Promise.all([
      c.getMyReceipt(code, memberId),
      c.getMyAccount(memberId),
    ])
    return { ...receipt, account }
  })
}

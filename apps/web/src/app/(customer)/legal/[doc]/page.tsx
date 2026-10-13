import type { LegalDocumentType } from '@jancube/application'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Notice } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { localDate } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

const DOCUMENTS = {
  terms: { type: 'terms', label: '利用規約' },
  privacy: { type: 'privacy', label: 'プライバシーポリシー' },
  cancellation: { type: 'cancellation_policy', label: 'キャンセルポリシー' },
} as const satisfies Record<string, { type: LegalDocumentType; label: string }>

type Slug = keyof typeof DOCUMENTS

/**
 * Body texts are PLACEHOLDERS until the client supplies them (R-items). The version shown and
 * consented to comes from legal_documents; a new text is published as a new version there.
 */
const BODIES: Record<Slug, { heading: string; text: string }[]> = {
  terms: [
    {
      heading: '第1条（適用）',
      text: '本規約は、株式会社アクトプロが提供する雀CUBE予約サービス（以下「本サービス」）の利用に関し、当社と会員との間の権利義務関係を定めるものです。',
    },
    {
      heading: '第2条（会員登録）',
      text: '本サービスの利用を希望する方は、当社所定の方法により会員登録を行うものとします。会員は18歳以上であることを要します。',
    },
    {
      heading: '第3条（予約・キャンセル）',
      text: '予約の成立時期、キャンセル料の料率および返金の取扱いは、当社が別途定めるキャンセルポリシーによります。',
    },
  ],
  privacy: [
    {
      heading: '1. 取得する情報',
      text: 'お名前、携帯電話番号、メールアドレス（任意）、ご予約・お支払いの履歴、LINE連携時のLINEユーザーIDを取得します。',
    },
    {
      heading: '2. 利用目的',
      text: 'ご予約の受付・ご本人確認・入室のご案内・お知らせの送信・お問い合わせへの対応のために利用します。',
    },
    {
      heading: '3. 退会時の取扱い',
      text: '退会後はお名前・電話番号・メールアドレスを削除します。法令・会計上必要な取引記録は所定の期間保持します。',
    },
  ],
  cancellation: [
    {
      heading: 'キャンセル料',
      text: 'ご利用開始の24時間前まで：無料（0%）／24時間前を過ぎてから開始時刻まで：お支払い額の50%／開始時刻以降：100%',
    },
    {
      heading: '返金',
      text: 'キャンセル料を差し引いた金額を、お支払いに使われた決済方法へ返金します。反映まで数日かかる場合があります。',
    },
    {
      heading: '日程変更',
      text: 'キャンセル料が発生する期間（ご利用開始24時間前以降）は、日程変更もできません。',
    },
  ],
}

/** C-20 利用規約 / プライバシーポリシー / キャンセルポリシー: the version currently in effect. */
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params
  if (!(doc in DOCUMENTS)) notFound()
  const slug = doc as Slug
  let document: Awaited<ReturnType<typeof load>>
  try {
    document = await load(DOCUMENTS[slug].type)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-5">
      <nav className="grid grid-cols-3 gap-1 rounded-xl bg-line/50 p-1 text-xs">
        {(Object.keys(DOCUMENTS) as Slug[]).map((key) => (
          <Link
            key={key}
            href={`/legal/${key}`}
            className={`rounded-lg py-2 text-center font-bold ${
              key === slug ? 'bg-white text-brand-dark shadow-sm' : 'text-sub'
            }`}
          >
            {DOCUMENTS[key].label}
          </Link>
        ))}
      </nav>
      <div>
        <h1 className="text-lg font-bold">{document.title}</h1>
        <p className="mt-1 text-xs text-sub">
          第 {document.version} 版 / {localDate(document.effectiveAt, 'Asia/Tokyo')} 適用
        </p>
      </div>
      <Notice tone="warn">本文は仮のものです。正式な文面のご提供後に差し替えます</Notice>
      <article className="space-y-4 rounded-xl border border-line bg-white p-4 text-sm leading-relaxed">
        {BODIES[slug].map((section) => (
          <section key={section.heading}>
            <h2 className="font-bold">{section.heading}</h2>
            <p className="mt-1">{section.text}</p>
          </section>
        ))}
        {slug === 'terms' && (
          <section id="age">
            <h2 className="font-bold">年齢の確認</h2>
            <p className="mt-1">本サービスは18歳以上の方のみご利用いただけます。</p>
          </section>
        )}
      </article>
    </main>
  )
}

function load(type: LegalDocumentType) {
  return withContainer((c) => c.getLegalDocument(type))
}

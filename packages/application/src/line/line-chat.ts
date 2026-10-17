import { addMinutes, DomainError, type LocalDate } from '@jancube/domain'
import { makeAttachMemberToHold } from '../auth/attach-member'
import { assertCanBook } from '../auth/sign-in'
import { makeGetBookingCalendar } from '../booking/get-booking-calendar'
import { makeGetDayAvailability } from '../booking/get-day-availability'
import { makeGetEndOptions } from '../booking/get-end-options'
import { type HoldDeps, makeCreateHold, makeSetGuestCount } from '../booking/hold'
import { type CheckoutDeps, makeGetPaymentOptions, makeStartCheckout } from '../payment/checkout'
import type { LineLinkRepository, LineReplyChoice, LineWebhookEvent } from '../ports/line'
import type { AlertRepository } from '../ports/ops'

type Stage =
  | 'store'
  | 'date'
  | 'lane'
  | 'start'
  | 'end'
  | 'guests'
  | 'confirm'
  | 'coupon'
  | 'method'
  | 'paid'
interface Choice {
  label: string
  value: string
}
export interface LineChatSession {
  stage: Stage
  mode: 'bot' | 'staff'
  nonce: string
  page: number
  store?: string
  date?: LocalDate
  lane?: string
  start?: string
  end?: string
  guests?: number
  grantId?: number | null
  requestKey?: string
  choices: Choice[]
  expiresAt: string
  lastTimestamp: number
  lastEventId: string
  response: LineChatReply | null
}
export interface LineChatReply {
  text: string
  choices: readonly LineReplyChoice[]
}
export interface LineChatRepository {
  /** Serialize each verified LINE user's state. No session is shared across providers/users. */
  withSession<T>(
    providerId: string,
    userId: string,
    fn: (session: LineChatSession | null) => Promise<{ session: LineChatSession; result: T }>,
  ): Promise<T>
}

/** Persisted stages require the selections from every preceding step. */
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new DomainError('line_session_invalid', 'restart booking selection')
  return value
}

/** L-05: server-side selection flow. Opaque, rotating tokens reject stale and cross-user buttons. */
export function makeLineChat(deps: {
  sessions: LineChatRepository
  links: LineLinkRepository
  providerId: string
  hold: HoldDeps
  checkout: CheckoutDeps
  alerts: AlertRepository
  appUrl: string
  liffId: string | null
  /** Stop booking automation during maintenance while keeping signed webhook processing active. */
  bookingEnabled?: () => boolean
}) {
  const day = makeGetDayAvailability(deps.hold)
  const ends = makeGetEndOptions(deps.hold)
  const fresh = (): LineChatSession => ({
    stage: 'store',
    mode: 'bot',
    nonce: deps.hold.newRequestKey(),
    page: 0,
    choices: [],
    expiresAt: addMinutes(deps.hold.clock.now(), 60).toISOString(),
    lastTimestamp: 0,
    lastEventId: '',
    response: null,
  })
  const liffUrl = (next: string) =>
    deps.liffId
      ? `https://liff.line.me/${deps.liffId}?next=${encodeURIComponent(next)}`
      : `${deps.appUrl}/liff?next=${encodeURIComponent(next)}`
  const time = (iso: string) =>
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso))

  async function render(s: LineChatSession, userId: string): Promise<LineChatReply> {
    let text = ''
    let options: Choice[] = []
    switch (s.stage) {
      case 'store':
        text = 'ご希望の店舗をお選びください。'
        options = (await deps.hold.stores.listActive()).map((v) => ({
          label: v.name,
          value: v.code,
        }))
        break
      case 'date': {
        text = 'ご希望の日付をお選びください。'
        const calendar = await makeGetBookingCalendar(deps.hold)(required(s.store))
        options = calendar.days
          .filter(
            (d) => d.status !== 'closed' && d.status !== 'not_bookable' && d.status !== 'full',
          )
          .map((d) => ({ label: d.date, value: d.date }))
        break
      }
      case 'lane':
        text = 'お部屋タイプ・お部屋をお選びください。'
        options = (await day(required(s.store), required(s.date))).lanes
          .filter((l) => l.slots.some((v) => v.available))
          .map((l) => ({ label: l.label, value: l.key }))
        break
      case 'start':
        text = '開始時刻をお選びください（30分単位）。'
        options = (
          (await day(required(s.store), required(s.date))).lanes.find((l) => l.key === s.lane)
            ?.slots ?? []
        )
          .filter((v) => v.available)
          .map((v) => ({ label: time(v.start), value: v.start }))
        break
      case 'end':
        text = '終了時刻と料金をお選びください。'
        options = (
          await ends({
            storeCode: required(s.store),
            date: required(s.date),
            laneKey: required(s.lane),
            start: required(s.start),
          })
        ).map((v) => ({
          label: `${time(v.end)} ${v.quote.price.toLocaleString('ja-JP')}円`,
          value: v.end,
        }))
        break
      case 'guests': {
        const lane = (await day(required(s.store), required(s.date))).lanes.find(
          (l) => l.key === s.lane,
        )
        text = 'ご利用人数をお選びください。'
        options = Array.from({ length: lane?.capacity ?? 0 }, (_, i) => ({
          label: `${i + 1}名`,
          value: String(i + 1),
        }))
        break
      }
      case 'confirm': {
        const link = await deps.links.findByLineUser(deps.providerId, userId)
        const member = link ? await deps.checkout.members.findById(link.memberId) : null
        if (!member) {
          s.choices = [{ label: '登録済み・続ける', value: 'continue' }]
          return {
            text: '初回のみ、お名前・メールアドレスと規約への同意をご登録ください。電話番号・SMSは不要です。登録後このトークに戻って「続ける」を押してください。',
            choices: [
              { label: 'LINEで登録', uri: liffUrl('/mypage') },
              { label: '続ける', data: `jc:${s.nonce}:0` },
              { label: 'スタッフに相談', data: `jc:${s.nonce}:staff` },
            ],
          }
        }
        assertCanBook(member)
        if (!member.email) {
          s.choices = [{ label: '登録済み・続ける', value: 'continue' }]
          return {
            text: 'ご予約にはメールアドレスが必要です。アカウント設定で登録し、このトークに戻って「続ける」を押してください。',
            choices: [
              { label: 'メールアドレス登録', uri: liffUrl('/mypage/account') },
              { label: '続ける', data: `jc:${s.nonce}:0` },
            ],
          }
        }
        const lane = (await day(required(s.store), required(s.date))).lanes.find(
          (l) => l.key === s.lane,
        )
        const selected = (
          await ends({
            storeCode: required(s.store),
            date: required(s.date),
            laneKey: required(s.lane),
            start: required(s.start),
          })
        ).find((v) => v.end === s.end)
        if (!selected)
          throw new DomainError('room_unavailable', 'selected time is no longer available')
        text = `${s.store} / ${s.date}\n${lane?.label ?? ''} / ${time(required(s.start))}〜${time(required(s.end))} / ${s.guests}名\n${selected.quote.price.toLocaleString('ja-JP')}円（税込・クーポン適用前）\nキャンセル規定: ${deps.appUrl}/legal/cancellation_policy\n規定をご確認のうえお進みください。決済完了まで予約は確定しません。`
        options = [{ label: '規定に同意して進む', value: 'confirm' }]
        break
      }
      case 'coupon': {
        const link = await deps.links.findByLineUser(deps.providerId, userId)
        if (!link) throw new DomainError('verification_required', 'LINE registration required')
        const payment = await makeGetPaymentOptions(deps.checkout)(
          required(s.requestKey),
          link.memberId,
        )
        text = 'クーポンをお選びください。'
        options = [
          { label: '利用しない', value: 'none' },
          ...payment.coupons
            .filter((c) => c.discount !== null)
            .map((c) => ({ label: `${c.couponName} -${c.discount}円`, value: String(c.grantId) })),
        ]
        break
      }
      case 'method':
        text = 'お支払い方法をお選びください。'
        options = [
          { label: 'クレジットカード', value: 'card' },
          { label: 'PayPay', value: 'paypay' },
        ]
        break
      case 'paid':
        return s.response ?? { text: '予約確認はLINEメニューからご確認ください。', choices: [] }
    }
    if (!options.length) text += '\n空きがありません。別の条件をお選びください。'
    s.choices = options.slice(s.page * 9, s.page * 9 + 9)
    const choices: LineReplyChoice[] = s.choices.map((c, i) => ({
      label: c.label,
      data: `jc:${s.nonce}:${i}`,
    }))
    if (s.page > 0) choices.push({ label: '前の候補', data: `jc:${s.nonce}:prev` })
    if (options.length > (s.page + 1) * 9)
      choices.push({ label: '次の候補', data: `jc:${s.nonce}:next` })
    choices.push(
      { label: '最初から', data: `jc:${s.nonce}:reset` },
      { label: 'スタッフに相談', data: `jc:${s.nonce}:staff` },
    )
    return { text, choices }
  }

  return async (event: LineWebhookEvent): Promise<LineChatReply | null> => {
    if (!event.userId) return null
    const userId = event.userId
    if (deps.bookingEnabled?.() === false)
      return {
        text: 'ただいまメンテナンス中のため、新しいご予約は受付を停止しています。しばらくしてからお試しください。',
        choices: [],
      }
    return deps.sessions.withSession(deps.providerId, userId, async (saved) => {
      let s = saved ?? fresh()
      if (s.lastEventId === event.eventId) return { session: s, result: s.response }
      if (event.timestamp.getTime() < s.lastTimestamp) return { session: s, result: null }
      const restart = event.text?.trim() === '予約する' || event.text?.trim() === '予約したい'
      if (restart) s = fresh()
      else if (s.mode === 'staff') return { session: s, result: null }
      else if (new Date(s.expiresAt) <= deps.hold.clock.now()) s = fresh()
      const matched = event.postbackData?.match(/^jc:([\w-]+):(\d+|next|prev|reset|staff)$/)
      let reply: LineChatReply | null
      try {
        if (restart) reply = await render(s, userId)
        else if (matched && matched[1] !== s.nonce) {
          reply = {
            text: 'この選択肢は古くなっています。最新の選択肢をお使いください。',
            choices: s.response?.choices ?? [],
          }
        } else if (matched) {
          const choice = required(matched[2])
          const value = s.choices[Number(choice)]?.value
          s.nonce = deps.hold.newRequestKey()
          if (choice === 'staff') reply = await handoff(s, userId)
          else if (choice === 'reset') {
            s = fresh()
            reply = await render(s, userId)
          } else if (choice === 'next' || choice === 'prev') {
            s.page = Math.max(0, s.page + (choice === 'next' ? 1 : -1))
            reply = await render(s, userId)
          } else if (value !== undefined) {
            s.page = 0
            switch (s.stage) {
              case 'store':
                s.store = value
                s.stage = 'date'
                break
              case 'date':
                s.date = value as LocalDate
                s.stage = 'lane'
                break
              case 'lane':
                s.lane = value
                s.stage = 'start'
                break
              case 'start':
                s.start = value
                s.stage = 'end'
                break
              case 'end':
                s.end = value
                s.stage = 'guests'
                break
              case 'guests':
                s.guests = Number(value)
                s.stage = 'confirm'
                break
              case 'confirm': {
                if (value === 'continue') break
                const link = await deps.links.findByLineUser(deps.providerId, userId)
                if (!link)
                  throw new DomainError('verification_required', 'LINE registration required')
                // The previous prompt token is stable across redelivery, including after a crash.
                const requestKey = required(matched[1])
                if (!(await deps.hold.bookings.findByRequestKey(requestKey))) {
                  await makeCreateHold({ ...deps.hold, newRequestKey: () => requestKey })({
                    storeCode: required(s.store),
                    date: required(s.date),
                    laneKey: required(s.lane),
                    start: required(s.start),
                    end: required(s.end),
                    source: 'liff',
                    acquisition: { source: 'line_chat' },
                  })
                }
                s.requestKey = requestKey
                await makeAttachMemberToHold({
                  bookings: deps.hold.bookings,
                  members: deps.checkout.members,
                  clock: deps.hold.clock,
                })(requestKey, link.memberId)
                await makeSetGuestCount(deps.hold)(requestKey, required(s.guests))
                s.stage = 'coupon'
                break
              }
              case 'coupon':
                s.grantId = value === 'none' ? null : Number(value)
                s.stage = 'method'
                break
              case 'method': {
                const link = await deps.links.findByLineUser(deps.providerId, userId)
                if (!link)
                  throw new DomainError('verification_required', 'LINE registration required')
                const hold = await deps.hold.bookings.findByRequestKey(required(s.requestKey))
                const next = `/mypage/bookings/${required(hold).bookingCode}`
                const checkout = await makeStartCheckout(deps.checkout)({
                  requestKey: required(s.requestKey),
                  memberId: link.memberId,
                  grantId: s.grantId ?? null,
                  method: value === 'paypay' ? 'paypay' : 'card',
                  successUrl: liffUrl(next),
                  cancelUrl: liffUrl('/mypage'),
                })
                s.stage = 'paid'
                s.response =
                  checkout.kind === 'redirect'
                    ? {
                        text: '下のリンクでお支払いください。決済成功後に予約が確定します。期限切れの場合は「予約する」からお選び直しください。',
                        choices: [
                          {
                            label: 'お支払いへ',
                            uri: checkout.url.startsWith('/')
                              ? `${deps.appUrl}${checkout.url}`
                              : checkout.url,
                          },
                        ],
                      }
                    : {
                        text: 'ご予約が完了しました。',
                        choices: [{ label: '予約詳細', uri: liffUrl(next) }],
                      }
                break
              }
            }
            reply = await render(s, userId)
          } else reply = await render(s, userId)
        } else if (event.text?.trim() === '予約確認') {
          reply = {
            text: 'LINEでログインしてご予約を確認できます。',
            choices: [{ label: '予約確認', uri: liffUrl('/mypage') }],
          }
        } else reply = await handoff(s, userId)
      } catch (error) {
        if (!(error instanceof DomainError)) throw error
        s = fresh()
        reply = {
          ...(await render(s, userId)),
          text: '空き状況やお支払い期限が変わりました。もう一度お選びください。',
        }
      }
      s.response = reply
      s.lastEventId = event.eventId
      s.lastTimestamp = event.timestamp.getTime()
      s.expiresAt = addMinutes(deps.hold.clock.now(), 60).toISOString()
      return { session: s, result: reply }
    })
  }

  async function handoff(s: LineChatSession, userId: string): Promise<LineChatReply> {
    s.mode = 'staff'
    const link = await deps.links.findByLineUser(deps.providerId, userId)
    await deps.alerts.raise({
      alertKey: `line_handoff:${deps.providerId}:${userId}`,
      alertType: 'line_handoff',
      severity: 'warning',
      failureReason: `LINEのお問い合わせがあります${link ? `（会員ID ${link.memberId}）` : '（未登録のお客様）'}`,
      recoverySteps:
        'LINE Official Accountのチャットで対応してください。お客様が「予約する」を送ると自動予約が再開します。',
      detectedAt: deps.hold.clock.now(),
    })
    return {
      text: 'スタッフがこのトークでご案内します。自動応答を停止しました。「予約する」で自動予約を再開できます。',
      choices: [],
    }
  }
}

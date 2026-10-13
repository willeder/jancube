import {
  DomainError,
  keyValidity,
  LIVE_KEY_STATUSES,
  nextKeyAttemptAt,
  sameValidity,
  utcToLocal,
} from '@jancube/domain'
import type { Clock } from '../ports/clock'
import {
  type AccessKeyProvider,
  AccessKeyProviderError,
  type AccessKeyRecord,
  type AccessKeyRepository,
  type LockDevice,
  type LockDeviceRepository,
  type OpsBooking,
  type OpsStore,
} from '../ports/operations'
import type { AlertRepository, SecretBox } from '../ports/ops'

export interface KeyDeps {
  readonly keys: AccessKeyRepository
  readonly devices: LockDeviceRepository
  readonly provider: AccessKeyProvider
  readonly secrets: SecretBox
  readonly alerts: AlertRepository
  readonly clock: Clock
}

/** access_keys.encryption_key_version: version byte of the SecretBox key (DATA_ENCRYPTION_KEY). */
const KEY_VERSION = '1'

/** Pending keys younger than this are left to the request that created them (avoids double calls). */
const FRESH_KEY_MINUTES = 2

export const isLive = (key: AccessKeyRecord) => LIVE_KEY_STATUSES.includes(key.status)
export const isIssued = (key: AccessKeyRecord) => key.status === 'issued' || key.status === 'active'

const errorInfo = (error: unknown) => ({
  code: error instanceof AccessKeyProviderError ? error.code : 'error',
  message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
  retryable: !(error instanceof AccessKeyProviderError) || error.retryable,
})

/** `M月D日 HH:mm` in store time, for notices and screens. */
export function formatLocalDateTime(instant: Date, timeZone: string): string {
  const { date, minuteOfDay } = utcToLocal(instant, timeZone)
  const [, m, d] = date.split('-').map(Number)
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const mm = String(minuteOfDay % 60).padStart(2, '0')
  return `${m}月${d}日 ${hh}:${mm}`
}

/**
 * Entry-code lifecycle (F-KEY-01〜07): issue per booking on the store's entrance lock, retry
 * failures with back-off, revoke on cancellation, reissue when the time changes or staff ask.
 * Every API attempt is written to key_events without the code.
 */
export function makeKeyOperations(deps: KeyDeps) {
  async function attemptIssue(
    key: AccessKeyRecord,
    device: LockDevice,
  ): Promise<AccessKeyRecord | null> {
    const now = deps.clock.now()
    const attemptNo = key.attempts + 1
    try {
      const issued = await deps.provider.issue(device, {
        requestKey: key.idempotencyKey,
        validFrom: key.validFrom,
        validTo: key.validTo,
      })
      await deps.keys.markIssued(key.id, {
        providerKeyId: issued.providerKeyId,
        codeCiphertext: await deps.secrets.encrypt(issued.code),
        keyVersion: KEY_VERSION,
        at: now,
      })
      await deps.keys.recordEvent({
        accessKeyId: key.id,
        lockDeviceId: device.id,
        bookingId: key.bookingId,
        eventType: 'issue',
        result: 'success',
        requestKey: key.idempotencyKey,
        attemptNo,
        details: {
          provider: deps.provider.name,
          providerKeyId: issued.providerKeyId,
          validFrom: key.validFrom.toISOString(),
          validTo: key.validTo.toISOString(),
          ...issued.details,
        },
        at: now,
      })
      await deps.alerts.resolve(`key_missing:${key.bookingId}`, now)
      return deps.keys.key(key.id)
    } catch (error) {
      const info = errorInfo(error)
      await deps.keys.recordEvent({
        accessKeyId: key.id,
        lockDeviceId: device.id,
        bookingId: key.bookingId,
        eventType: 'issue',
        result: 'failure',
        requestKey: key.idempotencyKey,
        attemptNo,
        errorCode: info.code,
        details: { provider: deps.provider.name, message: info.message },
        at: now,
      })
      if (!info.retryable || nextKeyAttemptAt(attemptNo, now) === null) {
        await deps.keys.setStatus(key.id, 'failed', now)
        await deps.alerts.raise({
          alertKey: `key_failed:${key.id}`,
          alertType: 'key_issue_failed',
          severity: 'critical',
          failureReason: `入室コードを発行できませんでした (${info.code}): ${info.message}`,
          recoverySteps:
            '鍵デバイスの通信状態を確認し、鍵状況画面(A-09)から再発行してください。復旧できない場合は店舗スタッフが手動解錠で対応します。',
          storeId: key.storeId,
          bookingId: key.bookingId,
          lockDeviceId: device.id,
          detectedAt: now,
        })
      }
      return null
    }
  }

  async function attemptRevoke(key: AccessKeyRecord, device: LockDevice | null): Promise<boolean> {
    const now = deps.clock.now()
    if (!key.providerKeyId || !device) {
      // Never reached the provider: nothing to remove there.
      await deps.keys.setStatus(key.id, 'revoked', now)
      return true
    }
    const attemptNo = key.status === 'revoke_pending' ? key.attempts + 1 : 1
    if (key.status !== 'revoke_pending') await deps.keys.setStatus(key.id, 'revoke_pending', now)
    try {
      await deps.provider.revoke(device, key.providerKeyId)
      await deps.keys.setStatus(key.id, 'revoked', now)
      await deps.keys.recordEvent({
        accessKeyId: key.id,
        lockDeviceId: device.id,
        bookingId: key.bookingId,
        eventType: 'revoke',
        result: 'success',
        requestKey: key.idempotencyKey,
        attemptNo,
        details: { provider: deps.provider.name, providerKeyId: key.providerKeyId },
        at: now,
      })
      return true
    } catch (error) {
      const info = errorInfo(error)
      await deps.keys.recordEvent({
        accessKeyId: key.id,
        lockDeviceId: device.id,
        bookingId: key.bookingId,
        eventType: 'revoke',
        result: 'failure',
        requestKey: key.idempotencyKey,
        attemptNo,
        errorCode: info.code,
        details: { provider: deps.provider.name, message: info.message },
        at: now,
      })
      if (!info.retryable || nextKeyAttemptAt(attemptNo, now) === null) {
        await deps.alerts.raise({
          alertKey: `key_revoke_failed:${key.id}`,
          alertType: 'key_revoke_failed',
          severity: 'warning',
          failureReason: `入室コードを失効できませんでした (${info.code}): ${info.message}`,
          recoverySteps: '鍵事業者の管理画面で該当の電話パスコードを削除してください。',
          storeId: key.storeId,
          bookingId: key.bookingId,
          lockDeviceId: device.id,
          detectedAt: now,
        })
      }
      return false
    }
  }

  async function liveKey(bookingId: number) {
    const keys = await deps.keys.keysForBookings([bookingId])
    return { all: keys, live: keys.find(isLive) ?? null }
  }

  /** Issues the booking's code unless it already has one. */
  async function ensureKey(
    booking: OpsBooking,
    store: OpsStore,
  ): Promise<{
    status: 'issued' | 'pending' | 'failed' | 'no_device'
    key: AccessKeyRecord | null
  }> {
    const { all, live } = await liveKey(booking.id)
    if (live && isIssued(live)) return { status: 'issued', key: live }
    const device = await deps.devices.activeForStore(booking.storeId)
    if (!device) {
      await deps.alerts.raise({
        alertKey: `lock_device_missing:${booking.storeId}`,
        alertType: 'lock_device_missing',
        severity: 'critical',
        failureReason: `${store.name} に有効な鍵デバイスが登録されていないため、入室コードを発行できません`,
        recoverySteps:
          '鍵デバイス管理(A-20)で店舗入口の鍵を登録し、鍵状況画面(A-09)から発行してください。',
        storeId: booking.storeId,
        detectedAt: deps.clock.now(),
      })
      return { status: 'no_device', key: live }
    }
    if (live?.status === 'revoke_pending') return { status: 'pending', key: live }
    let key = live
    if (!key) {
      const validity = keyValidity(booking, store.keyBeforeMinutes, store.keyAfterMinutes)
      const id = await deps.keys.createKey({
        bookingId: booking.id,
        storeId: booking.storeId,
        lockDeviceId: device.id,
        validFrom: validity.start,
        validTo: validity.end,
        idempotencyKey: `booking:${booking.id}:key:${all.length + 1}`,
      })
      key = await deps.keys.key(id)
      if (!key) throw new Error(`access key ${id} not found`)
    }
    const issued = await attemptIssue(key, device)
    if (issued) return { status: 'issued', key: issued }
    const after = await deps.keys.key(key.id)
    return { status: after?.status === 'failed' ? 'failed' : 'pending', key: after }
  }

  /** Revokes every live key of the booking. False if a provider call failed (it is retried). */
  async function revokeKeys(bookingId: number): Promise<boolean> {
    const keys = (await deps.keys.keysForBookings([bookingId])).filter(isLive)
    let ok = true
    for (const key of keys) {
      const device = await deps.devices.find(key.lockDeviceId)
      if (!(await attemptRevoke(key, device))) ok = false
    }
    return ok
  }

  /** Replaces the booking's code: the old one must be removed first (one live code per booking). */
  async function reissue(booking: OpsBooking, store: OpsStore) {
    if (!(await revokeKeys(booking.id))) {
      throw new DomainError('key_revoke_failed', 'the current code could not be revoked')
    }
    return ensureKey(booking, store)
  }

  /** F-KEY-04: follows a time change. Returns true when a new code was issued. */
  async function followBookingTime(booking: OpsBooking, store: OpsStore): Promise<boolean> {
    const { live } = await liveKey(booking.id)
    if (!live) return false
    const wanted = keyValidity(booking, store.keyBeforeMinutes, store.keyAfterMinutes)
    if (sameValidity(wanted, { start: live.validFrom, end: live.validTo })) return false
    const result = await reissue(booking, store)
    return result.status === 'issued'
  }

  /**
   * Minute job: retries pending issues and revocations whose back-off has passed. Keys of bookings
   * that are no longer confirmed are revoked instead of issued.
   */
  async function processPendingWork(
    isBookingActive: (bookingId: number) => Promise<boolean>,
    onIssued: (key: AccessKeyRecord) => Promise<void>,
    limit = 50,
  ) {
    const now = deps.clock.now()
    let issued = 0
    let revoked = 0
    let failed = 0
    for (const key of await deps.keys.pendingWork(limit)) {
      const due = nextKeyAttemptAt(key.attempts, key.lastAttemptAt)
      if (!due || due > now) continue
      if (key.status === 'pending' && key.attempts === 0) {
        if (now.getTime() - key.createdAt.getTime() < FRESH_KEY_MINUTES * 60_000) continue
      }
      const device = await deps.devices.find(key.lockDeviceId)
      if (key.status === 'revoke_pending' || !(await isBookingActive(key.bookingId))) {
        if (await attemptRevoke(key, device)) revoked++
        else failed++
        continue
      }
      if (!device) continue
      const result = await attemptIssue(key, device)
      if (result) {
        issued++
        await onIssued(result)
      } else failed++
    }
    return { issued, revoked, failed }
  }

  async function decryptCode(key: AccessKeyRecord): Promise<string | null> {
    return key.codeCiphertext ? deps.secrets.decrypt(key.codeCiphertext) : null
  }

  return {
    ensureKey,
    revokeKeys,
    reissue,
    followBookingTime,
    processPendingWork,
    decryptCode,
    liveKey,
  }
}

export type KeyOperations = ReturnType<typeof makeKeyOperations>

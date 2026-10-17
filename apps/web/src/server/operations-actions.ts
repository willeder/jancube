'use server'

import { can } from '@jancube/domain'
import { redirect } from 'next/navigation'
import { endStaffSession, requireStaff, startStaffSession } from './admin-session'
import type { FormState } from './booking-actions'
import {
  requireCleaningSelection,
  requireCleaningStaff,
  writeCleaningSelection,
} from './cleaning-session'
import { withContainer } from './container'
import { toUserMessage } from './errors'

const text = (form: FormData, name: string) => String(form.get(name) ?? '')
const id = (form: FormData, name: string) => {
  const value = Number(form.get(name))
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}
const bookingPath = (code: string) => encodeURIComponent(code)

/** A-07 割当変更を確定する (F-RM-06 / F-RM-07). */
export async function reassignRoomAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff('bookings.manage')
  const bookingCode = text(form, 'bookingCode')
  try {
    await withContainer((c) =>
      c.reassignRoom(staff, {
        bookingCode,
        roomId: id(form, 'roomId'),
        finalize: form.get('finalize') === 'on',
        notifyCustomer: form.get('notify') === 'on',
        reason: text(form, 'reason'),
      }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(`/admin/bookings/${bookingPath(bookingCode)}/assignment?done=1`)
}

/** A-09 鍵を再発行する (F-KEY-06). */
export async function reissueKeyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff('keys.manage')
  const bookingCode = text(form, 'bookingCode')
  try {
    await withContainer((c) =>
      c.reissueKey(staff, {
        bookingCode,
        reason: text(form, 'reason'),
        notify: form.get('notify') === 'on',
      }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(`/admin/keys/${bookingPath(bookingCode)}?done=reissued`)
}

/** A-09 お客様に鍵コードを再通知. */
export async function resendKeyNoticeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff('keys.manage')
  const bookingCode = text(form, 'bookingCode')
  try {
    await withContainer((c) => c.resendKeyNotice(staff, bookingCode))
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(`/admin/keys/${bookingPath(bookingCode)}?done=resent`)
}

/** A-09 手動解錠で対応(記録のみ). */
export async function manualUnlockAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff('keys.manage')
  const bookingCode = text(form, 'bookingCode')
  try {
    await withContainer((c) =>
      c.recordManualUnlock(staff, { bookingCode, note: text(form, 'note') }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(`/admin/keys/${bookingPath(bookingCode)}?done=recorded`)
}

/** A-20 デバイス登録・更新. */
export async function saveLockDeviceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff('stores.manage')
  const deviceId = id(form, 'id') || null
  try {
    await withContainer((c) =>
      c.saveLockDevice(staff, deviceId, {
        storeId: id(form, 'storeId'),
        name: text(form, 'name'),
        provider: text(form, 'provider'),
        providerAccountId: text(form, 'providerAccountId'),
        externalDeviceId: text(form, 'externalDeviceId'),
        secretReference: text(form, 'secretReference') || null,
        isActive: form.get('isActive') === 'on',
      }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/admin/lock-devices?saved=1')
}

/** A-20 テスト (one device) / 全デバイス疎通テスト. */
export async function testLockDevicesAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff('stores.manage')
  const deviceId = id(form, 'id')
  const storeIds = form
    .getAll('storeId')
    .map(Number)
    .filter((n) => n > 0)
  try {
    await withContainer(async (c) => {
      if (deviceId) await c.testLockDevice(staff, deviceId)
      else await c.testLockDevices(staff, storeIds.length ? storeIds : null)
    })
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  const back = text(form, 'back')
  redirect(back.startsWith('/admin/') ? back : '/admin/lock-devices?tested=1')
}

/** A-10 完了(代理入力) / 開始. */
export async function adminCleaningTaskAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const staff = await requireStaff('cleaning.view')
  const taskId = id(form, 'taskId')
  const workerId = id(form, 'workerId')
  try {
    await withContainer((c) =>
      form.get('step') === 'start'
        ? c.startCleaningTask(staff, { taskId, workerId, source: 'admin' })
        : c.completeCleaningTask(staff, {
            taskId,
            workerId,
            notes: text(form, 'notes'),
            source: 'admin',
          }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(`/admin/cleaning?date=${encodeURIComponent(text(form, 'date'))}&done=1`)
}

/** A-10 / K-02 活動メモ. */
export async function roomMemoAction(_prev: FormState, form: FormData): Promise<FormState> {
  const fromCleaning = form.get('source') === 'cleaning'
  const staff = fromCleaning ? await requireCleaningStaff() : await requireStaff('cleaning.work')
  try {
    await withContainer((c) =>
      c.addRoomMemo(staff, {
        storeId: id(form, 'storeId'),
        roomId: id(form, 'roomId'),
        taskId: id(form, 'taskId') || null,
        body: text(form, 'body'),
        source: fromCleaning ? 'cleaning' : 'admin',
      }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  if (fromCleaning && form.get('back') === 'memo') {
    // A fixed destination preserves the cleaning scope without accepting a caller-supplied URL.
    redirect(`/cleaning/memo?room=${id(form, 'roomId')}&saved=1`)
  }
  redirect(
    fromCleaning
      ? '/cleaning?memo=1'
      : `/admin/cleaning?date=${encodeURIComponent(text(form, 'date'))}&memo=1`,
  )
}

/** K-01 ログイン (the staff sign-in, limited to accounts that can do cleaning work). */
export async function cleaningLoginAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const session = await withContainer((c) =>
      c.staffSignIn(text(form, 'email'), text(form, 'password')),
    )
    if (!can(session.access, 'cleaning.work'))
      return { error: '清掃担当の権限がないアカウントです' }
    await startStaffSession(session.staffId, form.get('remember') === 'on')
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/cleaning/login')
}

/** K-01 担当の選択: store and worker for the log. */
export async function selectCleaningWorkerAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const staff = await requireCleaningStaff()
  const storeId = id(form, 'storeId')
  const workerId = id(form, 'workerId')
  try {
    const workers = await withContainer((c) => c.cleaningAssignees(staff, storeId))
    if (!workers.some((w) => w.id === workerId)) return { error: '担当者を選択してください' }
    await writeCleaningSelection(storeId, workerId)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/cleaning')
}

/** K-02 清掃開始 / 清掃完了. */
export async function cleaningTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { staff, selection } = await requireCleaningSelection()
  const taskId = id(form, 'taskId')
  try {
    await withContainer((c) =>
      form.get('step') === 'start'
        ? c.startCleaningTask(staff, { taskId, workerId: selection.workerId, source: 'cleaning' })
        : c.completeCleaningTask(staff, {
            taskId,
            workerId: selection.workerId,
            notes: text(form, 'notes'),
            source: 'cleaning',
          }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/cleaning?done=1')
}

/** K-01 ログアウト (back to the cleaning sign-in, not the admin one). */
export async function cleaningLogoutAction(): Promise<void> {
  await endStaffSession()
  redirect('/cleaning/login')
}

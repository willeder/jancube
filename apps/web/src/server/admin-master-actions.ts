'use server'

import { startOfLocalDate } from '@jancube/application'
import type { WeeklyHours } from '@jancube/domain'
import {
  type AdminFormState,
  adminMutation,
  checked,
  clock,
  grantsFromForm,
  ids,
  int,
  localDate,
  optional,
  photosFromForm,
  priceVersionFromForm,
  requestOrigin,
  storeDraftFromForm,
  text,
} from './admin-form'
import { requireStaff } from './admin-session'
import { withContainer } from './container'
import { toAdminMessage } from './errors'

// ---------------------------------------------------------------- A-16 prices

export async function createPriceProfileAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  return adminMutation(
    'prices.manage',
    (c, staff) =>
      c.createPriceProfile(staff, {
        code: text(form, 'code'),
        name: text(form, 'name'),
        version: priceVersionFromForm(form),
      }),
    { revalidate: '/admin/prices', redirectTo: (id) => `/admin/prices/${id}?created=1` },
  )
}

export async function updatePriceProfileAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const profileId = int(form, 'profileId')
  return adminMutation(
    'prices.manage',
    (c, staff) =>
      c.updatePriceProfile(staff, profileId, {
        name: text(form, 'name'),
        isActive: checked(form, 'isActive'),
      }),
    { revalidate: ['/admin/prices', `/admin/prices/${profileId}`] },
  )
}

export async function publishPriceVersionAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const profileId = int(form, 'profileId')
  let message = ''
  const state = await adminMutation(
    'prices.manage',
    async (c, staff) => {
      const r = await c.publishPriceVersion(staff, profileId, {
        version: priceVersionFromForm(form),
        moveRooms: checked(form, 'moveRooms'),
      })
      message = `第${r.versionNo}版を公開しました（切り替えた部屋 ${r.movedRooms}室）`
    },
    { revalidate: ['/admin/prices', `/admin/prices/${profileId}`] },
  )
  return state.error ? state : { error: null, message }
}

export async function assignPriceVersionAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const profileId = int(form, 'profileId')
  return adminMutation(
    'prices.manage',
    (c, staff) =>
      c.assignPriceVersion(staff, {
        versionId: int(form, 'versionId'),
        roomIds: ids(form, 'roomIds'),
        validFrom: startOfLocalDate(localDate(form, 'validFrom')),
      }),
    {
      message: '割当を保存しました',
      revalidate: ['/admin/prices', `/admin/prices/${profileId}`, '/admin/rooms'],
    },
  )
}

// ---------------------------------------------------------------- A-18 stores

export async function createStoreAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  return adminMutation(
    'stores.manage',
    (c, staff) =>
      c.createStore(staff, { code: text(form, 'code'), store: storeDraftFromForm(form) }),
    { revalidate: '/admin/stores', redirectTo: (id) => `/admin/stores/${id}?created=1` },
  )
}

export async function updateStoreAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const storeId = int(form, 'storeId')
  return adminMutation(
    'stores.manage',
    (c, staff) => c.updateStore(staff, storeId, storeDraftFromForm(form)),
    { revalidate: ['/admin/stores', `/admin/stores/${storeId}`] },
  )
}

export async function setWeeklyHoursAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const storeId = int(form, 'storeId')
  return adminMutation(
    'stores.manage',
    (c, staff) => {
      const weekly: WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
        const isClosed = checked(form, `closed${weekday}`)
        return {
          weekday,
          isClosed,
          opensMinute: clock(form, `opens${weekday}`) ?? 0,
          closesMinute: clock(form, `closes${weekday}`) ?? (isClosed ? 1440 : 0),
        }
      })
      return c.setWeeklyHours(staff, storeId, weekly)
    },
    {
      message: '営業時間を保存しました',
      revalidate: ['/admin/stores', `/admin/stores/${storeId}`],
    },
  )
}

export async function saveCalendarDayAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const storeId = int(form, 'storeId')
  return adminMutation(
    'stores.manage',
    (c, staff) =>
      c.saveCalendarDay(staff, storeId, {
        date: localDate(form, 'date'),
        isClosed: checked(form, 'isClosed'),
        isHoliday: checked(form, 'isHoliday'),
        opensMinute: clock(form, 'opens'),
        closesMinute: clock(form, 'closes'),
        reason: optional(form, 'reason'),
      }),
    { message: 'カレンダーを保存しました', revalidate: `/admin/stores/${storeId}` },
  )
}

export async function deleteCalendarDayAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const storeId = int(form, 'storeId')
  return adminMutation(
    'stores.manage',
    (c, staff) => c.deleteCalendarDay(staff, storeId, localDate(form, 'date')),
    { message: '削除しました', revalidate: `/admin/stores/${storeId}` },
  )
}

// ---------------------------------------------------------------- A-19 rooms

export async function saveRoomTypeAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  return adminMutation(
    'stores.manage',
    (c, staff) =>
      c.saveRoomType(staff, {
        id: optional(form, 'id') ? int(form, 'id') : null,
        code: text(form, 'code'),
        name: text(form, 'name'),
        capacity: int(form, 'capacity'),
        isActive: checked(form, 'isActive'),
      }),
    { message: '部屋タイプを保存しました', revalidate: '/admin/rooms' },
  )
}

export async function saveRoomGroupAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  return adminMutation(
    'stores.manage',
    (c, staff) =>
      c.saveRoomGroup(staff, {
        id: optional(form, 'id') ? int(form, 'id') : null,
        storeId: int(form, 'storeId'),
        roomTypeId: optional(form, 'roomTypeId') ? int(form, 'roomTypeId') : 0,
        code: text(form, 'code'),
        name: text(form, 'name'),
        bookingMode: text(form, 'bookingMode'),
        sortOrder: int(form, 'sortOrder'),
        isActive: checked(form, 'isActive'),
      }),
    { message: '部屋グループを保存しました', revalidate: '/admin/rooms' },
  )
}

const roomDraft = (form: FormData) => ({
  name: text(form, 'name'),
  description: optional(form, 'description'),
  operatingStatus: text(form, 'operatingStatus') as 'active' | 'paused' | 'broken',
  isNamedBooking: checked(form, 'isNamedBooking'),
  isVipCandidate: checked(form, 'isVipCandidate'),
  sortOrder: int(form, 'sortOrder'),
  photos: photosFromForm(form),
})

export async function createRoomAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  return adminMutation(
    'stores.manage',
    (c, staff) =>
      c.createRoom(staff, {
        ...roomDraft(form),
        groupId: int(form, 'groupId'),
        code: text(form, 'code'),
      }),
    { revalidate: '/admin/rooms', redirectTo: (id) => `/admin/rooms/${id}?created=1` },
  )
}

export async function updateRoomAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const roomId = int(form, 'roomId')
  return adminMutation(
    'stores.manage',
    (c, staff) => c.updateRoom(staff, roomId, roomDraft(form)),
    {
      revalidate: ['/admin/rooms', `/admin/rooms/${roomId}`],
    },
  )
}

// ---------------------------------------------------------------- A-21 notification templates

export async function createTemplateAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  return adminMutation(
    'notifications.manage',
    (c, staff) =>
      c.createTemplate(staff, {
        event: text(form, 'event'),
        channel: text(form, 'channel'),
        storeId: text(form, 'storeId') === 'all' ? null : int(form, 'storeId'),
        priority: int(form, 'priority'),
        isEnabled: checked(form, 'isEnabled'),
        subject: optional(form, 'subject'),
        body: String(form.get('body') ?? ''),
        entryGuideUrl: optional(form, 'entryGuideUrl'),
      }),
    {
      revalidate: '/admin/notification-templates',
      redirectTo: (id) => `/admin/notification-templates/${id}?created=1`,
    },
  )
}

export async function updateTemplateSettingsAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const templateId = int(form, 'templateId')
  return adminMutation(
    'notifications.manage',
    (c, staff) =>
      c.updateTemplateSettings(staff, templateId, {
        isEnabled: checked(form, 'isEnabled'),
        priority: int(form, 'priority'),
      }),
    {
      revalidate: ['/admin/notification-templates', `/admin/notification-templates/${templateId}`],
    },
  )
}

export async function publishTemplateVersionAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const templateId = int(form, 'templateId')
  return adminMutation(
    'notifications.manage',
    (c, staff) =>
      c.publishTemplateVersion(staff, templateId, {
        subject: optional(form, 'subject'),
        body: String(form.get('body') ?? ''),
        entryGuideUrl: optional(form, 'entryGuideUrl'),
      }),
    {
      message: '新しい版を公開しました。以後の通知はこの文面で送信されます',
      revalidate: ['/admin/notification-templates', `/admin/notification-templates/${templateId}`],
    },
  )
}

/** A-21 プレビュー (sample values, read only). */
export async function previewTemplateAction(input: {
  event: string
  channel: string
  subject: string | null
  body: string
}): Promise<{ ok: true; subject: string | null; body: string } | { ok: false; error: string }> {
  const staff = await requireStaff('notifications.manage')
  try {
    const preview = await withContainer(async (c) => c.previewTemplate(staff, input))
    return { ok: true, ...preview }
  } catch (error) {
    return { ok: false, error: toAdminMessage(error) }
  }
}

// ---------------------------------------------------------------- A-23 staff

const inviteLink = async () => {
  const base = await requestOrigin()
  return (token: string) => `${base}/admin/password/set?purpose=invite&token=${token}`
}

export async function inviteStaffAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const link = await inviteLink()
  return adminMutation(
    'staff.manage',
    (c, staff) =>
      c.inviteStaff(
        staff,
        { email: text(form, 'email'), name: text(form, 'name'), grants: grantsFromForm(form) },
        link,
      ),
    { revalidate: '/admin/staff', redirectTo: (id) => `/admin/staff/${id}?invited=1` },
  )
}

export async function updateStaffAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const staffId = int(form, 'staffId')
  return adminMutation(
    'staff.manage',
    (c, staff) =>
      c.updateStaff(staff, staffId, { name: text(form, 'name'), grants: grantsFromForm(form) }),
    { revalidate: ['/admin/staff', `/admin/staff/${staffId}`] },
  )
}

export async function setStaffEnabledAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const staffId = int(form, 'staffId')
  const enabled = text(form, 'enabled') === 'true'
  return adminMutation('staff.manage', (c, staff) => c.setStaffEnabled(staff, staffId, enabled), {
    message: enabled ? '有効にしました' : '無効にしました',
    revalidate: ['/admin/staff', `/admin/staff/${staffId}`],
  })
}

export async function resendInviteAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const staffId = int(form, 'staffId')
  const link = await inviteLink()
  return adminMutation('staff.manage', (c, staff) => c.resendStaffInvite(staff, staffId, link), {
    message: '招待メールを再送しました',
    revalidate: `/admin/staff/${staffId}`,
  })
}

'use server'

import type { MemberSegment, SegmentCount } from '@jancube/application'
import {
  type AdminFormState,
  adminMutation,
  checked,
  couponVersionFromForm,
  int,
  optional,
  optionalInt,
  text,
} from './admin-form'
import { requireStaff } from './admin-session'
import { withContainer } from './container'
import { toAdminMessage } from './errors'

const memberPath = (code: string) => `/admin/members/${encodeURIComponent(code)}`

/** A-12 状態変更 (F-AUTH-08). */
export async function changeMemberStatusAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const memberCode = text(form, 'memberCode')
  return adminMutation(
    'members.manage',
    (c, staff) =>
      c.changeMemberStatus(staff, {
        memberCode,
        status: text(form, 'status'),
        reason: text(form, 'reason'),
      }),
    { message: '会員の状態を変更しました', revalidate: memberPath(memberCode) },
  )
}

/** A-12 対応ログ(CS)を追加. */
export async function addMemberNoteAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const memberCode = text(form, 'memberCode')
  return adminMutation(
    'members.manage',
    (c, staff) =>
      c.addMemberNote(staff, {
        memberCode,
        body: String(form.get('body') ?? ''),
        bookingCode: optional(form, 'bookingCode'),
      }),
    { message: '対応ログを追加しました', revalidate: memberPath(memberCode) },
  )
}

/** A-13 個別クーポン発行. */
export async function grantCouponAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const memberCode = text(form, 'memberCode')
  return adminMutation(
    'members.manage',
    (c, staff) =>
      c.grantCouponToMember(staff, {
        memberCode,
        couponVersionId: int(form, 'couponVersionId'),
        maxUses: optionalInt(form, 'maxUses'),
        expiresOn: optional(form, 'expiresOn'),
        internalNote: optional(form, 'internalNote'),
        notify: checked(form, 'notify'),
        requestKey: text(form, 'requestKey'),
      }),
    {
      revalidate: memberPath(memberCode),
      redirectTo: (r) => `${memberPath(memberCode)}?granted=${r.notification?.status ?? 'none'}`,
    },
  )
}

/** A-14 作成. */
export async function createCouponAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  return adminMutation(
    'coupons.manage',
    (c, staff) =>
      c.createCoupon(staff, {
        code: text(form, 'code'),
        name: text(form, 'name'),
        campaignTag: optional(form, 'campaignTag'),
        activate: checked(form, 'activate'),
        version: couponVersionFromForm(form),
      }),
    { revalidate: '/admin/coupons', redirectTo: (id) => `/admin/coupons/${id}?created=1` },
  )
}

/** A-14 条件変更 = new version. */
export async function publishCouponVersionAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const couponId = int(form, 'couponId')
  return adminMutation(
    'coupons.manage',
    (c, staff) => c.publishCouponVersion(staff, couponId, couponVersionFromForm(form)),
    {
      message: '新しい版を公開しました',
      revalidate: ['/admin/coupons', `/admin/coupons/${couponId}`],
    },
  )
}

export async function updateCouponAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const couponId = int(form, 'couponId')
  return adminMutation(
    'coupons.manage',
    (c, staff) =>
      c.updateCoupon(staff, couponId, {
        name: text(form, 'name'),
        campaignTag: optional(form, 'campaignTag'),
      }),
    { revalidate: ['/admin/coupons', `/admin/coupons/${couponId}`] },
  )
}

export async function setCouponStatusAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const couponId = int(form, 'couponId')
  const status = text(form, 'status') === 'active' ? 'active' : 'disabled'
  return adminMutation('coupons.manage', (c, staff) => c.setCouponStatus(staff, couponId, status), {
    message: status === 'active' ? '有効にしました' : '停止しました',
    revalidate: ['/admin/coupons', `/admin/coupons/${couponId}`],
  })
}

function segmentFromForm(form: FormData): MemberSegment {
  switch (text(form, 'segmentCode')) {
    case 'no_use_days':
      return { code: 'no_use_days', days: int(form, 'days') }
    case 'registered_between':
      return { code: 'registered_between', from: text(form, 'from'), to: text(form, 'to') }
    case 'single_use':
      return { code: 'single_use' }
    case 'store_users':
      return { code: 'store_users', storeId: int(form, 'storeId') }
    default:
      return { code: 'all_active' }
  }
}

/** A-15 対象件数プレビュー (read only). */
export async function previewSegmentAction(
  form: FormData,
): Promise<{ ok: true; data: SegmentCount } | { ok: false; error: string }> {
  const staff = await requireStaff('coupons.manage')
  try {
    const segment = segmentFromForm(form)
    return { ok: true, data: await withContainer((c) => c.previewSegment(staff, segment)) }
  } catch (error) {
    return { ok: false, error: toAdminMessage(error) }
  }
}

/** A-15 一斉発行 (idempotent on the form's campaign key). */
export async function runCampaignAction(
  _prev: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  let summary = ''
  const state = await adminMutation(
    'coupons.manage',
    async (c, staff) => {
      const r = await c.runCampaign(staff, {
        campaignKey: text(form, 'campaignKey'),
        name: text(form, 'name'),
        couponVersionId: int(form, 'couponVersionId'),
        segment: segmentFromForm(form),
        notify: checked(form, 'notify'),
      })
      summary = r.alreadyRan
        ? `この一斉発行は実行済みです（付与 ${r.granted}件）`
        : `${r.granted}名に付与しました（通知 ${r.notified}件 / 通知手段なし ${r.screenOnly}件）`
    },
    { revalidate: '/admin/coupons/campaigns' },
  )
  return state.error ? state : { error: null, message: summary }
}

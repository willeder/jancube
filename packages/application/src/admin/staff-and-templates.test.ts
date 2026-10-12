import type { RoleGrant } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { TEMPLATE_VARIABLES } from '../notifications/template-variables'
import type {
  StaffAdminRepository,
  StaffAdminRow,
  TemplateAdminRepository,
  TemplateDetail,
} from '../ports/admin-masters'
import type { StaffActor } from './admin-actor'
import {
  checkTemplateContent,
  makeCreateTemplate,
  makePublishTemplateVersion,
} from './notification-templates'
import { makeInviteStaff, makeSetStaffEnabled, makeUpdateStaff } from './staff'

const owner: StaffActor = {
  staffId: 1,
  access: { staffId: 1, grants: [{ role: 'owner', storeId: null }] },
}
const admin: StaffActor = {
  staffId: 2,
  access: { staffId: 2, grants: [{ role: 'admin', storeId: null }] },
}

describe('notification templates (A-21)', () => {
  it('allows only the variables the event provides', () => {
    expect(() =>
      checkTemplateContent('coupon_granted', 'line', {
        subject: null,
        body: '{{couponName}} {{bookingCode}}',
      }),
    ).toThrow(expect.objectContaining({ code: 'template_variable_unknown' }))
    const ok = checkTemplateContent('room_assigned', 'email', {
      subject: '【雀CUBE】{{date}}のご案内',
      body: 'コード {{entryCode}}（{{codeValidFrom}}〜{{codeValidTo}}）',
    })
    expect(ok.preview.body).toBe('コード 1234（12:45〜16:15）')
    expect(TEMPLATE_VARIABLES.payment_link).toContain('paymentUrl')
  })

  it('requires an email subject and keeps SMS short', () => {
    expect(() =>
      checkTemplateContent('booking_confirmed', 'email', { subject: ' ', body: 'x' }),
    ).toThrow(expect.objectContaining({ code: 'template_subject_required' }))
    expect(() =>
      checkTemplateContent('payment_link', 'sms', { subject: null, body: 'a'.repeat(671) }),
    ).toThrow(expect.objectContaining({ code: 'template_too_long' }))
  })

  it('creates a template with version 1 and publishes later edits as new versions', async () => {
    const published: { templateId: number; body: string }[] = []
    let detail: TemplateDetail | null = null
    const templates: TemplateAdminRepository = {
      list: async () => [],
      find: async () => detail,
      exists: async () => false,
      create: async (t) => {
        detail = {
          ...t,
          id: 5,
          storeCode: null,
          latestVersionNo: null,
          latestPublishedAt: null,
          versions: [],
        }
        return 5
      },
      update: async () => {},
      publishVersion: async (templateId, v) => {
        published.push({ templateId, body: v.body })
        return published.length
      },
    }
    const deps = {
      templates,
      audit: { record: async () => {} },
      clock: { now: () => new Date('2026-10-12T00:00:00Z') },
    }
    const storeOnly: StaffActor = {
      staffId: 3,
      access: { staffId: 3, grants: [{ role: 'admin', storeId: 1 }] },
    }
    const input = {
      event: 'coupon_granted',
      channel: 'line',
      storeId: null,
      priority: 1,
      isEnabled: true,
      subject: null,
      body: '「{{couponName}}」をお届けしました',
    }
    await expect(makeCreateTemplate(deps)(storeOnly, input)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await makeCreateTemplate(deps)(owner, input)
    const versionNo = await makePublishTemplateVersion(deps)(owner, 5, {
      subject: null,
      body: '{{couponName}} 期限 {{couponExpiresAt}}',
    })
    expect(versionNo).toBe(2)
    expect(published.map((p) => p.templateId)).toEqual([5, 5])
  })
})

describe('staff and roles (A-23)', () => {
  function world() {
    const staff: StaffAdminRow[] = [
      {
        id: 1,
        email: 'owner@example.com',
        name: 'オーナー',
        status: 'active',
        hasPassword: true,
        lastLoginAt: null,
        grants: [{ role: 'owner', storeId: null, storeCode: null }],
      },
      {
        id: 2,
        email: 'admin@example.com',
        name: '本部',
        status: 'active',
        hasPassword: true,
        lastLoginAt: null,
        grants: [{ role: 'admin', storeId: null, storeCode: null }],
      },
    ]
    const invites: number[] = []
    const repo: StaffAdminRepository = {
      list: async () => staff,
      find: async (id) => staff.find((s) => s.id === id) ?? null,
      emailTaken: async (email) => staff.some((s) => s.email === email),
      create: async (s) => {
        const id = staff.length + 1
        staff.push({
          id,
          email: s.email,
          name: s.name,
          status: 'invited',
          hasPassword: false,
          lastLoginAt: null,
          grants: s.grants.map((g) => ({ ...g, storeCode: null })),
        })
        return id
      },
      updateName: async () => {},
      replaceGrants: async (id, grants) => {
        Object.assign(staff.find((s) => s.id === id) ?? {}, {
          grants: grants.map((g) => ({ ...g, storeCode: null })),
        })
      },
      setStatus: async (id, status) => {
        Object.assign(staff.find((s) => s.id === id) ?? {}, { status })
      },
      activeOwnerIds: async () =>
        staff
          .filter((s) => s.status === 'active' && s.grants.some((g) => g.role === 'owner'))
          .map((s) => s.id),
    }
    const deps = {
      staffAdmin: repo,
      sendInvite: async (id: number) => void invites.push(id),
      audit: { record: async () => {} },
      clock: { now: () => new Date('2026-10-12T00:00:00Z') },
    }
    return { deps, staff, invites }
  }
  const url = (t: string) => `https://example.com/admin/password/set?purpose=invite&token=${t}`

  it('invites new staff (owners only) and requires a store for store roles', async () => {
    const { deps, invites, staff } = world()
    const invite = makeInviteStaff(deps)
    const storeStaff: RoleGrant[] = [{ role: 'store_staff', storeId: null }]
    await expect(
      invite(owner, { email: 'a@example.com', name: '田牧', grants: storeStaff }, url),
    ).rejects.toMatchObject({ code: 'store_required' })
    await expect(
      invite(
        admin,
        { email: 'a@example.com', name: '田牧', grants: [{ role: 'store_staff', storeId: 1 }] },
        url,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const id = await invite(
      owner,
      { email: ' A@Example.com ', name: '田牧', grants: [{ role: 'store_staff', storeId: 1 }] },
      url,
    )
    expect(staff.find((s) => s.id === id)).toMatchObject({
      email: 'a@example.com',
      status: 'invited',
    })
    expect(invites).toEqual([id])
    await expect(
      invite(
        owner,
        { email: 'a@example.com', name: 'x', grants: [{ role: 'admin', storeId: null }] },
        url,
      ),
    ).rejects.toMatchObject({ code: 'staff_email_taken' })
  })

  it('keeps at least one active owner', async () => {
    const { deps } = world()
    await expect(
      makeUpdateStaff(deps)(owner, 1, {
        name: 'オーナー',
        grants: [{ role: 'admin', storeId: null }],
      }),
    ).rejects.toMatchObject({ code: 'last_owner' })
    await expect(makeSetStaffEnabled(deps)(owner, 1, false)).rejects.toMatchObject({
      code: 'cannot_disable_self',
    })
    await makeUpdateStaff(deps)(owner, 2, {
      name: '本部',
      grants: [{ role: 'owner', storeId: null }],
    })
    // Now there are two owners: the first may step down.
    await makeUpdateStaff(deps)(owner, 1, {
      name: 'オーナー',
      grants: [{ role: 'admin', storeId: null }],
    })
  })

  it('re-enables accounts that never set a password as invited', async () => {
    const { deps, staff } = world()
    const id = await makeInviteStaff(deps)(
      owner,
      { email: 'b@example.com', name: '清掃', grants: [{ role: 'cleaning', storeId: 1 }] },
      url,
    )
    await makeSetStaffEnabled(deps)(owner, id, false)
    expect(staff.find((s) => s.id === id)?.status).toBe('disabled')
    await makeSetStaffEnabled(deps)(owner, id, true)
    expect(staff.find((s) => s.id === id)?.status).toBe('invited')
  })
})

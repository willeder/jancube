import { describe, expect, it } from 'vitest'
import { assertCan, can, visibleStoreIds } from '../staff/permissions'
import {
  assertTemplateVariables,
  chooseChannel,
  renderTemplate,
  templateVariables,
} from './notification'

describe('chooseChannel (F-NTF-07)', () => {
  const order = ['line', 'email'] as const
  it('prefers LINE, then email, else nothing', () => {
    expect(chooseChannel(order, { line: true, email: true, sms: true })).toBe('line')
    expect(chooseChannel(order, { line: false, email: true, sms: true })).toBe('email')
    expect(chooseChannel(order, { line: false, email: false, sms: true })).toBeNull()
  })
  it('uses SMS only when the template enables it', () => {
    expect(chooseChannel(['sms'], { line: true, email: true, sms: true })).toBe('sms')
  })
})

describe('templates', () => {
  it('renders variables and lists them', () => {
    const body = '{{storeName}} {{ date }} {{storeName}}'
    expect(templateVariables(body)).toEqual(['storeName', 'date'])
    expect(renderTemplate(body, { storeName: '本町店', date: '11/10' })).toBe('本町店 11/10 本町店')
  })
  it('fails on missing or unknown variables', () => {
    expect(() => renderTemplate('{{x}}', {})).toThrow(/x/)
    expect(() => assertTemplateVariables('{{storeName}} {{oops}}', ['storeName'])).toThrow(/oops/)
  })
})

describe('permissions (F-ADM-02)', () => {
  const storeStaff = { staffId: 1, grants: [{ role: 'admin' as const, storeId: 1 }] }
  const owner = { staffId: 2, grants: [{ role: 'owner' as const, storeId: null }] }
  it('limits store staff to their store', () => {
    expect(can(storeStaff, 'bookings.view', 1)).toBe(true)
    expect(can(storeStaff, 'bookings.view', 2)).toBe(false)
    expect(can(storeStaff, 'prices.manage', 1)).toBe(true)
    expect(() =>
      assertCan({ staffId: 3, grants: [{ role: 'cleaning', storeId: 1 }] }, 'staff.manage'),
    ).toThrow()
    expect(visibleStoreIds(storeStaff, 'bookings.view')).toEqual([1])
  })
  it('gives owners everything everywhere', () => {
    expect(can(owner, 'staff.manage', 3)).toBe(true)
    expect(visibleStoreIds(owner, 'bookings.view')).toBeNull()
  })
})

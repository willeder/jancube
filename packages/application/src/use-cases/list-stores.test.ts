import type { Store } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { makeListStores } from './list-stores'

const store = (code: string): Store => ({
  id: 1,
  code,
  name: `Store ${code}`,
  address: 'Osaka',
  accessText: null,
  mapUrl: null,
  timezone: 'Asia/Tokyo',
  status: 'open',
  isActive: true,
  booking: {
    openDate: '2026-10-19',
    horizonDays: 60,
    holdMinutes: 10,
    proxyHoldMinutes: 30,
    cleaningBufferMinutes: 15,
  },
})

describe('listStores', () => {
  it('returns customer-facing summaries from the repository', async () => {
    const listStores = makeListStores({
      stores: {
        listActive: async () => [store('JC001'), store('JC002')],
        findActiveByCode: async () => null,
        weeklyHours: async () => [],
        calendarOverrides: async () => [],
      },
    })
    const result = await listStores()
    expect(result.map((s) => s.code)).toEqual(['JC001', 'JC002'])
    expect(result[0]).not.toHaveProperty('id')
  })
})

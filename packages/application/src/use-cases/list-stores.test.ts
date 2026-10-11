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
})

describe('listStores', () => {
  it('returns customer-facing summaries from the repository', async () => {
    const listStores = makeListStores({
      stores: { listActive: async () => [store('JC001'), store('JC002')] },
    })
    const result = await listStores()
    expect(result.map((s) => s.code)).toEqual(['JC001', 'JC002'])
    expect(result[0]).not.toHaveProperty('id')
  })
})

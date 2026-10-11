import type { Store } from '@jancube/domain'
import type { StoreRepository } from '../ports/store-repository'

export interface StoreSummary {
  readonly code: string
  readonly name: string
  readonly address: string
  readonly accessText: string | null
  readonly mapUrl: string | null
}

/** C-01 店舗選択: the stores a customer can book. */
export function makeListStores(deps: { stores: StoreRepository }) {
  return async function listStores(): Promise<StoreSummary[]> {
    const stores = await deps.stores.listActive()
    return stores.map(toSummary)
  }
}

function toSummary(s: Store): StoreSummary {
  return {
    code: s.code,
    name: s.name,
    address: s.address,
    accessText: s.accessText,
    mapUrl: s.mapUrl,
  }
}

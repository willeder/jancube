import type { Store } from '@jancube/domain'

export interface StoreRepository {
  /** Stores shown to customers (active), ordered by store code. */
  listActive(): Promise<Store[]>
}

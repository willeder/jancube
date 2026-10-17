import type { CalendarOverride, LocalDate, Store, WeeklyHours } from '@jancube/domain'

/** Listing read model: adapters may include regular hours in the same batched read. */
export interface ListedStore extends Store {
  readonly regularHours?: readonly WeeklyHours[]
}

export interface StoreRepository {
  /** Stores shown to customers (active), ordered by store code. */
  listActive(): Promise<ListedStore[]>
  findActiveByCode(code: string): Promise<Store | null>
  weeklyHours(storeId: number): Promise<WeeklyHours[]>
  calendarOverrides(storeId: number, from: LocalDate, to: LocalDate): Promise<CalendarOverride[]>
}

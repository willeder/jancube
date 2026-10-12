import type { CalendarOverride, LocalDate, Store, WeeklyHours } from '@jancube/domain'

export interface StoreRepository {
  /** Stores shown to customers (active), ordered by store code. */
  listActive(): Promise<Store[]>
  findActiveByCode(code: string): Promise<Store | null>
  weeklyHours(storeId: number): Promise<WeeklyHours[]>
  calendarOverrides(storeId: number, from: LocalDate, to: LocalDate): Promise<CalendarOverride[]>
}

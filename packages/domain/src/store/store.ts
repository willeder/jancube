export type StoreStatus = 'preparing' | 'open' | 'closed'

export interface Store {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly address: string
  readonly accessText: string | null
  readonly mapUrl: string | null
  readonly timezone: string
  readonly status: StoreStatus
  readonly isActive: boolean
}

import type { PriceProfile, TimeRange } from '@jancube/domain'

export interface RoomGroupInfo {
  readonly id: number
  readonly code: string
  readonly name: string
  /** `group`: customers book the room type, a room is assigned later. `named`: customers pick a room. */
  readonly bookingMode: 'group' | 'named'
  readonly capacity: number
  readonly sortOrder: number
  /** room_types.id (coupon eligibility when a booking moves to another room type, C-14). */
  readonly roomTypeId?: number
}

export interface RoomInfo {
  readonly id: number
  readonly groupId: number
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly sortOrder: number
}

/** A booking that occupies inventory (confirmed, or a draft whose hold has not expired). */
export interface OccupyingBooking {
  /** bookings.id, so a booking being changed (C-14) does not block its own new time. */
  readonly bookingId?: number
  readonly groupId: number
  /** Assigned or requested (named) room; null while a group booking waits for assignment. */
  readonly roomId: number | null
  readonly range: TimeRange
}

export interface RoomBlock {
  readonly roomId: number
  readonly range: TimeRange
}

export interface StoreInventory {
  readonly groups: readonly RoomGroupInfo[]
  /** Rooms in service (operating_status = active). Paused/broken rooms are excluded. */
  readonly rooms: readonly RoomInfo[]
  readonly bookings: readonly OccupyingBooking[]
  readonly blocks: readonly RoomBlock[]
}

export interface InventoryRepository {
  /** Everything that affects availability for a store within [from, to). */
  load(storeId: number, from: Date, to: Date, now: Date): Promise<StoreInventory>
}

export interface PricedProfile {
  readonly priceVersionId: number
  readonly profile: PriceProfile
  readonly minimumMinutes: number
  readonly taxRatePercent: number
}

export interface PricingRepository {
  /** Price profile version assigned to a room at the given instant. */
  forRoom(roomId: number, at: Date): Promise<PricedProfile | null>
}

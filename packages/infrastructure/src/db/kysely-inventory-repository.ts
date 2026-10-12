import type { InventoryRepository, StoreInventory } from '@jancube/application'
import type { Database } from './create-db'

/**
 * Loads everything that affects availability for a store and time range:
 * active room groups and rooms, bookings that occupy inventory, and room blocks.
 *
 * A booking occupies inventory when it is confirmed/completed, or a draft whose hold has not expired.
 * Its room is the current assignment, otherwise the requested (named) room, otherwise none yet.
 */
export class KyselyInventoryRepository implements InventoryRepository {
  constructor(private readonly db: Database) {}

  async load(storeId: number, from: Date, to: Date, now: Date): Promise<StoreInventory> {
    const [groups, rooms, bookings, blocks] = await Promise.all([
      this.db
        .selectFrom('room_groups as g')
        .innerJoin('room_types as t', 't.id', 'g.room_type_id')
        .select(['g.id', 'g.code', 'g.name', 'g.booking_mode', 'g.sort_order', 't.capacity'])
        .where('g.store_id', '=', storeId)
        .where('g.is_active', '=', 1)
        .execute(),
      this.db
        .selectFrom('rooms')
        .select(['id', 'room_group_id', 'code', 'name', 'description', 'sort_order'])
        .where('store_id', '=', storeId)
        .where('operating_status', '=', 'active')
        .execute(),
      this.db
        .selectFrom('bookings as b')
        .leftJoin('booking_assignments as a', (join) =>
          join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
        )
        .select(['b.room_group_id', 'b.requested_room_id', 'a.room_id', 'b.starts_at', 'b.ends_at'])
        .where('b.store_id', '=', storeId)
        .where('b.starts_at', '<', to)
        .where('b.ends_at', '>', from)
        .where((eb) =>
          eb.or([
            eb('b.status', 'in', ['confirmed', 'completed']),
            eb.and([eb('b.status', '=', 'draft'), eb('b.hold_expires_at', '>', now)]),
          ]),
        )
        .execute(),
      this.db
        .selectFrom('room_blocks as k')
        .innerJoin('rooms as r', 'r.id', 'k.room_id')
        .select(['k.room_id', 'k.starts_at', 'k.ends_at'])
        .where('r.store_id', '=', storeId)
        .where('k.released_at', 'is', null)
        .where('k.starts_at', '<', to)
        .where('k.ends_at', '>', from)
        .execute(),
    ])

    return {
      groups: groups.map((g) => ({
        id: Number(g.id),
        code: g.code,
        name: g.name,
        bookingMode: g.booking_mode === 'named' ? 'named' : 'group',
        capacity: g.capacity,
        sortOrder: g.sort_order,
      })),
      rooms: rooms.map((r) => ({
        id: Number(r.id),
        groupId: Number(r.room_group_id),
        code: r.code,
        name: r.name,
        description: r.description,
        sortOrder: r.sort_order,
      })),
      bookings: bookings.map((b) => ({
        groupId: Number(b.room_group_id),
        roomId: b.room_id ?? b.requested_room_id ?? null,
        range: { start: b.starts_at, end: b.ends_at },
      })),
      blocks: blocks.map((k) => ({
        roomId: Number(k.room_id),
        range: { start: k.starts_at, end: k.ends_at },
      })),
    }
  }
}

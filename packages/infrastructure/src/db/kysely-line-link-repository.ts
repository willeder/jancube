import type { LineFriendStatus, LineLink, LineLinkRepository } from '@jancube/application'
import type { Database } from './create-db'

const columns = ['member_id', 'line_user_id', 'friend_status', 'linked_at'] as const

const toLink = (row: {
  member_id: number
  line_user_id: string
  friend_status: string
  linked_at: Date
}): LineLink => ({
  memberId: Number(row.member_id),
  lineUserId: row.line_user_id,
  friendStatus: row.friend_status as LineFriendStatus,
  linkedAt: row.linked_at,
})

/** member_line_links (C-17, L-02, L-03). */
export class KyselyLineLinkRepository implements LineLinkRepository {
  constructor(private readonly db: Database) {}

  async findByLineUser(providerId: string, lineUserId: string) {
    const row = await this.db
      .selectFrom('member_line_links')
      .select(columns)
      .where('provider_id', '=', providerId)
      .where('line_user_id', '=', lineUserId)
      .executeTakeFirst()
    return row ? toLink(row) : null
  }

  async findByMember(memberId: number) {
    const row = await this.db
      .selectFrom('member_line_links')
      .select(columns)
      .where('member_id', '=', memberId)
      .executeTakeFirst()
    return row ? toLink(row) : null
  }

  async save(link: Parameters<LineLinkRepository['save']>[0]) {
    // One row per member (uq_member_line_links_1): replace the previous LINE account in one statement.
    await this.db
      .insertInto('member_line_links')
      .values({
        member_id: link.memberId,
        provider_id: link.providerId,
        line_user_id: link.lineUserId,
        friend_status: link.friendStatus,
        linked_at: link.linkedAt,
        status_checked_at: link.friendStatus === 'unknown' ? null : link.linkedAt,
      })
      .onDuplicateKeyUpdate({
        provider_id: link.providerId,
        line_user_id: link.lineUserId,
        friend_status: link.friendStatus,
        linked_at: link.linkedAt,
        status_checked_at: link.friendStatus === 'unknown' ? null : link.linkedAt,
      })
      .execute()
  }

  async remove(memberId: number) {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('member_line_links')
        .select(columns)
        .where('member_id', '=', memberId)
        .forUpdate()
        .executeTakeFirst()
      if (!row) return null
      await trx.deleteFrom('member_line_links').where('member_id', '=', memberId).execute()
      return toLink(row)
    })
  }

  async setFriendStatus(
    providerId: string,
    lineUserId: string,
    status: LineFriendStatus,
    checkedAt: Date,
  ) {
    const exists = await this.findByLineUser(providerId, lineUserId)
    if (!exists) return false
    // Webhook events can arrive out of order: an older event never overwrites a newer status.
    await this.db
      .updateTable('member_line_links')
      .set({ friend_status: status, status_checked_at: checkedAt })
      .where('provider_id', '=', providerId)
      .where('line_user_id', '=', lineUserId)
      .where((eb) =>
        eb.or([eb('status_checked_at', 'is', null), eb('status_checked_at', '<=', checkedAt)]),
      )
      .execute()
    return true
  }
}

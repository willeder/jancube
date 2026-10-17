import type { LineChatRepository, LineChatSession, SecretBox } from '@jancube/application'
import type { Database } from './create-db'

/** A row lock serializes choices from the same identity across Workers and webhook requests. */
export class KyselyLineChatRepository implements LineChatRepository {
  constructor(
    private readonly db: Database,
    private readonly secrets: SecretBox,
  ) {}

  async withSession<T>(
    providerId: string,
    userId: string,
    fn: (session: LineChatSession | null) => Promise<{ session: LineChatSession; result: T }>,
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('line_chat_sessions')
        .values({
          provider_id: providerId,
          line_user_id: userId,
          payload_ciphertext: null,
          updated_at: new Date(),
        })
        .ignore()
        .execute()
      const row = await trx
        .selectFrom('line_chat_sessions')
        .select('payload_ciphertext')
        .where('provider_id', '=', providerId)
        .where('line_user_id', '=', userId)
        .forUpdate()
        .executeTakeFirstOrThrow()
      const session = row.payload_ciphertext
        ? (JSON.parse(await this.secrets.decrypt(row.payload_ciphertext)) as LineChatSession)
        : null
      const outcome = await fn(session)
      await trx
        .updateTable('line_chat_sessions')
        .set({
          payload_ciphertext: Buffer.from(
            await this.secrets.encrypt(JSON.stringify(outcome.session)),
          ),
          updated_at: new Date(),
        })
        .where('provider_id', '=', providerId)
        .where('line_user_id', '=', userId)
        .execute()
      return outcome.result
    })
  }
}

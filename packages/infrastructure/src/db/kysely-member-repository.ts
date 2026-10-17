import type {
  AuthChallenge,
  AuthChallengeRepository,
  ChallengeStatus,
  LegalDocumentRepository,
  LegalDocumentType,
  LineMemberCreator,
  MemberRecord,
  MemberRepository,
  MemberStatus,
} from '@jancube/application'
import type { E164 } from '@jancube/domain'
import type { Database } from './create-db'

const memberColumns = [
  'id',
  'member_code',
  'phone_e164',
  'family_name',
  'given_name',
  'email_normalized',
  'status',
] as const

function toMember(row: {
  id: number
  member_code: string
  phone_e164: string | null
  family_name: string | null
  given_name: string | null
  email_normalized: string | null
  status: string
}): MemberRecord {
  return {
    id: Number(row.id),
    memberCode: row.member_code,
    phone: row.phone_e164,
    familyName: row.family_name,
    givenName: row.given_name,
    email: row.email_normalized,
    status: row.status as MemberStatus,
  }
}

export class KyselyMemberRepository implements MemberRepository, LineMemberCreator {
  constructor(private readonly db: Database) {}

  async findById(id: number) {
    const row = await this.db
      .selectFrom('members')
      .select(memberColumns)
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? toMember(row) : null
  }

  async findByPhone(phone: E164) {
    const row = await this.db
      .selectFrom('members')
      .select(memberColumns)
      .where('phone_e164', '=', phone)
      .executeTakeFirst()
    return row ? toMember(row) : null
  }

  /** The unique provider/user constraint serializes racing registrations without merging by email. */
  async createLineMember(input: Parameters<LineMemberCreator['createLineMember']>[0]) {
    const existing = async () => {
      const row = await this.db
        .selectFrom('member_line_links as l')
        .innerJoin('members as m', 'm.id', 'l.member_id')
        .select(memberColumns.map((c) => `m.${c}` as const))
        .where('l.provider_id', '=', input.providerId)
        .where('l.line_user_id', '=', input.lineUserId)
        .executeTakeFirst()
      return row ? toMember(row) : null
    }
    const member = await existing()
    if (member) return member
    try {
      return await this.db.transaction().execute(async (trx) => {
        const result = await trx
          .insertInto('members')
          .values({
            member_code: crypto.randomUUID().replaceAll('-', ''),
            identity_kind: 'line',
            notification_channel: 'line',
            family_name: input.profile.familyName,
            given_name: input.profile.givenName,
            email_normalized: input.profile.email,
            registration_source: 'line',
            status: 'active',
          })
          .executeTakeFirstOrThrow()
        const id = Number(result.insertId)
        if (id > 999999) throw new Error('member number capacity exceeded')
        await trx
          .updateTable('members')
          .set({ member_code: `JC-U-${String(id).padStart(6, '0')}` })
          .where('id', '=', id)
          .execute()
        await trx
          .insertInto('member_line_links')
          .values({
            member_id: id,
            provider_id: input.providerId,
            line_user_id: input.lineUserId,
            friend_status: input.friendStatus,
            linked_at: input.at,
            status_checked_at: input.friendStatus === 'unknown' ? null : input.at,
          })
          .execute()
        await trx
          .insertInto('member_consents')
          .values(
            input.consentDocumentIds.map((documentId) => ({
              member_id: id,
              legal_document_id: documentId,
              agreed_at: input.at,
              channel: 'liff',
            })),
          )
          .execute()
        return toMember(
          await trx
            .selectFrom('members')
            .select(memberColumns)
            .where('id', '=', id)
            .executeTakeFirstOrThrow(),
        )
      })
    } catch (error) {
      if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error
      const raced = await existing()
      if (!raced) throw error
      return raced
    }
  }

  async createPhoneMember(input: Parameters<MemberRepository['createPhoneMember']>[0]) {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('members')
        .values({
          // Temporary unique code; replaced below once the id is known.
          member_code: `tmp-${input.phone}`,
          phone_e164: input.phone,
          phone_verified_at: input.phoneVerifiedAt,
          family_name: input.profile.familyName,
          given_name: input.profile.givenName,
          email_normalized: input.profile.email,
          status: 'active',
          registration_source: input.registrationSource,
          identity_kind: 'phone',
        })
        .executeTakeFirstOrThrow()
      const id = Number(inserted.insertId)
      await trx
        .updateTable('members')
        .set({ member_code: `JC-U-${String(id).padStart(6, '0')}` })
        .where('id', '=', id)
        .execute()
      if (input.consentDocumentIds.length > 0) {
        await trx
          .insertInto('member_consents')
          .values(
            input.consentDocumentIds.map((documentId) => ({
              member_id: id,
              legal_document_id: documentId,
              agreed_at: input.consentedAt,
              channel: input.channel,
            })),
          )
          .execute()
      }
      const row = await trx
        .selectFrom('members')
        .select(memberColumns)
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
      return toMember(row)
    })
  }
}

export class KyselyLegalDocumentRepository implements LegalDocumentRepository {
  constructor(private readonly db: Database) {}

  async current(types: readonly LegalDocumentType[], at: Date) {
    if (types.length === 0) return []
    const rows = await this.db
      .selectFrom('legal_documents')
      .select(['id', 'document_type', 'version'])
      .where('document_type', 'in', types)
      .where('effective_at', '<=', at)
      .orderBy('effective_at', 'desc')
      .orderBy('id', 'desc')
      .execute()
    const latest = new Map<string, (typeof rows)[number]>()
    for (const row of rows) if (!latest.has(row.document_type)) latest.set(row.document_type, row)
    return [...latest.values()].map((row) => ({
      id: Number(row.id),
      type: row.document_type as LegalDocumentType,
      version: row.version,
    }))
  }
}

const challengeColumns = [
  'public_id',
  'phone_e164',
  'status',
  'secret_hash',
  'expires_at',
  'verified_at',
  'attempt_count',
  'max_attempts',
  'resend_after',
  'member_id',
] as const

export class KyselyAuthChallengeRepository implements AuthChallengeRepository {
  constructor(private readonly db: Database) {}

  async create(c: Parameters<AuthChallengeRepository['create']>[0]) {
    await this.db
      .insertInto('auth_challenges')
      .values({
        public_id: c.publicId,
        purpose: 'sms_login',
        phone_e164: c.phone,
        secret_hash: Buffer.from(c.secretHash, 'hex'),
        status: 'pending',
        expires_at: c.expiresAt,
        max_attempts: c.maxAttempts,
        resend_after: c.resendAfter,
      })
      .execute()
  }

  async findByPublicId(publicId: string) {
    const row = await this.db
      .selectFrom('auth_challenges')
      .select(challengeColumns)
      .where('public_id', '=', publicId)
      .executeTakeFirst()
    return row ? toChallenge(row) : null
  }

  async latestForPhone(phone: E164) {
    const row = await this.db
      .selectFrom('auth_challenges')
      .select(challengeColumns)
      .where('phone_e164', '=', phone)
      .where('purpose', '=', 'sms_login')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst()
    return row ? toChallenge(row) : null
  }

  async countCreatedSince(phone: E164, since: Date) {
    const row = await this.db
      .selectFrom('auth_challenges')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('phone_e164', '=', phone)
      .where('purpose', '=', 'sms_login')
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow()
    return Number(row.n)
  }

  async recordFailure(publicId: string, lock: boolean) {
    await this.db
      .updateTable('auth_challenges')
      .set((eb) => ({
        attempt_count: eb('attempt_count', '+', 1),
        ...(lock ? { status: 'locked' } : {}),
      }))
      .where('public_id', '=', publicId)
      .where('status', '=', 'pending')
      .whereRef('attempt_count', '<', 'max_attempts')
      .execute()
  }

  async markVerified(publicId: string, at: Date, memberId: number | null) {
    await this.db
      .updateTable('auth_challenges')
      .set({ status: 'verified', verified_at: at, member_id: memberId })
      .where('public_id', '=', publicId)
      .where('status', '=', 'pending')
      .execute()
  }

  async linkMember(publicId: string, memberId: number) {
    await this.db
      .updateTable('auth_challenges')
      .set({ member_id: memberId })
      .where('public_id', '=', publicId)
      .execute()
  }

  async setProviderRequestId(publicId: string, providerRequestId: string) {
    await this.db
      .updateTable('auth_challenges')
      .set({ provider_request_id: providerRequestId })
      .where('public_id', '=', publicId)
      .execute()
  }
}

function toChallenge(row: {
  public_id: string
  phone_e164: string | null
  status: string
  secret_hash: Buffer
  expires_at: Date
  verified_at: Date | null
  attempt_count: number
  max_attempts: number
  resend_after: Date
  member_id: number | null
}): AuthChallenge | null {
  if (row.phone_e164 === null) return null
  return {
    publicId: row.public_id,
    phone: row.phone_e164,
    status: row.status as ChallengeStatus,
    secretHash: Buffer.from(row.secret_hash).toString('hex'),
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    resendAfter: row.resend_after,
    memberId: row.member_id === null ? null : Number(row.member_id),
  }
}

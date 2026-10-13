/** member_line_links.friend_status. 'blocked' = not reachable by push (blocked, or never added). */
export type LineFriendStatus = 'unknown' | 'friend' | 'blocked'

/** A LINE user proven by a verified ID token (F-LINE-02). */
export interface LineIdentity {
  /** LINE user id (`sub`), unique per LINE provider. */
  readonly lineUserId: string
  readonly displayName: string | null
}

/**
 * Verifies LIFF / LINE Login tokens with LINE (https://api.line.me/oauth2/v2.1/verify).
 * Throws DomainError('line_token_invalid') for a token that is invalid, expired or for another channel,
 * and DomainError('line_not_configured') when the channel is not set up.
 */
export interface LineIdentityVerifier {
  verifyIdToken(idToken: string): Promise<LineIdentity>
  /**
   * Whether the user is a friend of the official account linked to the LIFF channel. null when it
   * cannot be determined (no access token, API error); never throws for these.
   */
  friendship(accessToken: string | null): Promise<boolean | null>
}

export interface LineLink {
  readonly memberId: number
  readonly lineUserId: string
  readonly friendStatus: LineFriendStatus
  readonly linkedAt: Date
}

/** member_line_links. `providerId` scopes LINE user ids (they are unique per LINE provider). */
export interface LineLinkRepository {
  findByLineUser(providerId: string, lineUserId: string): Promise<LineLink | null>
  findByMember(memberId: number): Promise<LineLink | null>
  /** Creates or replaces the member's link (one LINE account per member, F-AUTH-06). */
  save(link: {
    readonly memberId: number
    readonly providerId: string
    readonly lineUserId: string
    readonly friendStatus: LineFriendStatus
    readonly linkedAt: Date
  }): Promise<void>
  /** Removes the member's link and returns it; null when there was none. */
  remove(memberId: number): Promise<LineLink | null>
  /** Updates the friend status of a linked LINE user; false when the user is not linked. */
  setFriendStatus(
    providerId: string,
    lineUserId: string,
    status: LineFriendStatus,
    checkedAt: Date,
  ): Promise<boolean>
}

/** One webhook event (https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects). */
export interface LineWebhookEvent {
  /** `webhookEventId` (stable across redeliveries). */
  readonly eventId: string
  readonly type: 'follow' | 'unfollow' | 'message' | 'other'
  /** Original event type, for logging (e.g. 'postback'). */
  readonly rawType: string
  readonly userId: string | null
  readonly replyToken: string | null
  readonly timestamp: Date
  readonly isRedelivery: boolean
}

export interface LineWebhookPayload {
  /** Bot user id of the official account that received the events. */
  readonly destination: string
  readonly events: readonly LineWebhookEvent[]
  readonly payloadSha256: string
}

/**
 * Verifies `x-line-signature` (HMAC-SHA256 of the raw body with the channel secret, base64) and
 * parses the body. Throws an Error whose message contains "signature" when it does not match.
 */
export interface LineWebhookParser {
  parse(rawBody: string, signature: string | null): Promise<LineWebhookPayload>
}

/** Reply message (free; only valid for a short time after the event). */
export interface LineReplySender {
  reply(replyToken: string, text: string): Promise<void>
}

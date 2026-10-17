import { DomainError } from '@jancube/domain'
import { assertCanBook } from '../auth/sign-in'
import type { Clock } from '../ports/clock'
import type {
  LineFriendStatus,
  LineIdentityVerifier,
  LineLink,
  LineLinkRepository,
} from '../ports/line'
import type { MemberRepository } from '../ports/member-repository'
import type { AuditLog } from '../ports/ops'

export interface LineAccountDeps {
  readonly verifier: LineIdentityVerifier
  readonly links: LineLinkRepository
  readonly members: MemberRepository
  readonly audit: AuditLog
  readonly clock: Clock
  /**
   * member_line_links.provider_id. LINE user ids are unique per provider, so the LIFF (LINE Login)
   * channel and the Messaging API channel must belong to the same provider; the LINE Login channel
   * id is used as the key.
   */
  readonly providerId: string
}

/** A LINE user proven by the ID token, carried through L-03 until the link is made. */
export interface VerifiedLineUser {
  readonly lineUserId: string
  readonly friendStatus: LineFriendStatus
}

export type LineSignInResult =
  | { readonly kind: 'member'; readonly memberId: number }
  | { readonly kind: 'not_linked'; readonly line: VerifiedLineUser }

const toFriendStatus = (friend: boolean | null): LineFriendStatus | null =>
  friend === null ? null : friend ? 'friend' : 'blocked'

/**
 * L-02 LIFF entry (F-LINE-02): verify the ID token. Linked members are signed in without any
 * further step; others continue to L-03 linking (F-LINE-03).
 */
export function makeLineSignIn(deps: LineAccountDeps) {
  return async function lineSignIn(
    idToken: string,
    accessToken: string | null,
  ): Promise<LineSignInResult> {
    const identity = await deps.verifier.verifyIdToken(idToken)
    const friendStatus = toFriendStatus(await deps.verifier.friendship(accessToken))
    const link = await deps.links.findByLineUser(deps.providerId, identity.lineUserId)
    const member = link ? await deps.members.findById(link.memberId) : null
    if (link && member && member.status !== 'withdrawn') {
      assertCanBook(member)
      if (friendStatus && friendStatus !== link.friendStatus) {
        await deps.links.setFriendStatus(
          deps.providerId,
          identity.lineUserId,
          friendStatus,
          deps.clock.now(),
        )
      }
      return { kind: 'member', memberId: member.id }
    }
    return {
      kind: 'not_linked',
      line: { lineUserId: identity.lineUserId, friendStatus: friendStatus ?? 'unknown' },
    }
  }
}

/**
 * L-03 / C-17: link the LINE account to a member who has just proven their phone number (SMS) or is
 * signed in (F-AUTH-06). Idempotent; an account already linked elsewhere is refused, and a member's
 * previous LINE account is replaced (one link per member).
 */
export function makeLinkLineAccount(deps: Omit<LineAccountDeps, 'verifier'>) {
  return async function linkLineAccount(
    memberId: number,
    line: VerifiedLineUser,
  ): Promise<{ replaced: boolean }> {
    const member = await deps.members.findById(memberId)
    if (!member || member.status === 'withdrawn') {
      throw new DomainError('member_not_found', 'sign in again')
    }
    const owner = await deps.links.findByLineUser(deps.providerId, line.lineUserId)
    if (owner && owner.memberId !== memberId) {
      const other = await deps.members.findById(owner.memberId)
      if (other && other.status !== 'withdrawn') {
        throw new DomainError(
          'line_already_linked',
          'this LINE account is linked to another member',
        )
      }
      // Left over from a withdrawn member: the LINE account is free again.
      await deps.links.remove(owner.memberId)
    }
    const current = await deps.links.findByMember(memberId)
    if (current?.lineUserId === line.lineUserId) {
      if (line.friendStatus !== 'unknown' && line.friendStatus !== current.friendStatus) {
        await deps.links.setFriendStatus(
          deps.providerId,
          line.lineUserId,
          line.friendStatus,
          deps.clock.now(),
        )
      }
      return { replaced: false }
    }
    const now = deps.clock.now()
    await deps.links.save({
      memberId,
      providerId: deps.providerId,
      lineUserId: line.lineUserId,
      friendStatus: line.friendStatus,
      linkedAt: now,
    })
    await deps.audit.record({
      actor: { type: 'member', memberId },
      action: 'member.line_link',
      targetType: 'member',
      targetId: memberId,
      targetCode: member.memberCode,
      // The LINE user id itself is not copied into the audit log.
      before: current ? { lineLinked: true, linkedAt: current.linkedAt } : { lineLinked: false },
      after: { lineLinked: true, friendStatus: line.friendStatus },
    })
    return { replaced: current !== null }
  }
}

/** Unlink only when a separate phone login remains; never strand a phone-free LINE member. */
export function makeUnlinkLineAccount(deps: Pick<LineAccountDeps, 'links' | 'members' | 'audit'>) {
  return async function unlinkLineAccount(memberId: number): Promise<{ unlinked: boolean }> {
    const member = await deps.members.findById(memberId)
    if (!member?.phone)
      throw new DomainError(
        'line_only_account',
        'a separate sign-in method is required before unlinking LINE',
      )
    const removed = await deps.links.remove(memberId)
    if (!removed) return { unlinked: false }
    await deps.audit.record({
      actor: { type: 'member', memberId },
      action: 'member.line_unlink',
      targetType: 'member',
      targetId: memberId,
      targetCode: member?.memberCode ?? null,
      before: { lineLinked: true, linkedAt: removed.linkedAt },
      after: { lineLinked: false },
    })
    return { unlinked: true }
  }
}

export interface LineLinkStatus {
  readonly linked: boolean
  readonly friendStatus: LineFriendStatus | null
  readonly linkedAt: Date | null
}

/** C-17: whether the member's LINE account is linked (the LINE user id is not exposed). */
export function makeGetLineLinkStatus(deps: Pick<LineAccountDeps, 'links'>) {
  return async function getLineLinkStatus(memberId: number): Promise<LineLinkStatus> {
    const link: LineLink | null = await deps.links.findByMember(memberId)
    return {
      linked: link !== null,
      friendStatus: link?.friendStatus ?? null,
      linkedAt: link?.linkedAt ?? null,
    }
  }
}

import { DomainError } from '@jancube/domain'
import { makeGetActiveHold } from '../booking/hold'
import type { BookingRepository } from '../ports/booking-repository'
import type { Clock } from '../ports/clock'
import type { MemberRepository } from '../ports/member-repository'
import { assertCanBook } from './sign-in'

/** After sign-in (C-06/C-07) the hold belongs to the member; contact details are snapshotted. */
export function makeAttachMemberToHold(deps: {
  readonly bookings: BookingRepository
  readonly members: MemberRepository
  readonly clock: Clock
}) {
  const getActiveHold = makeGetActiveHold(deps)
  return async function attachMemberToHold(requestKey: string, memberId: number): Promise<void> {
    const hold = await getActiveHold(requestKey)
    const member = await deps.members.findById(memberId)
    if (!member) throw new DomainError('member_not_found', 'sign in again')
    assertCanBook(member)
    if (hold.memberId !== null && hold.memberId !== memberId) {
      throw new DomainError('hold_not_found', 'this booking belongs to another member')
    }
    await deps.bookings.assignMember(requestKey, {
      memberId: member.id,
      familyName: member.familyName,
      givenName: member.givenName,
      phone: member.phone,
      email: member.email,
    })
  }
}

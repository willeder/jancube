import 'server-only'
import {
  makeGetStaffSession,
  makeRequestPasswordReset,
  makeSendStaffInvite,
  makeSetPasswordWithToken,
  makeStaffSignIn,
  type StaffAuthDeps,
} from '@jancube/application'
import type { Deps } from '../deps'

/** A-01 / A-30 staff authentication (other admin areas add their own feature files). */
export function adminFeatures(deps: Deps) {
  const auth: StaffAuthDeps = {
    staff: deps.staff,
    passwords: deps.passwords,
    tokens: deps.hasher,
    random: deps.random,
    email: deps.email,
    audit: deps.audit,
    clock: deps.clock,
  }
  return {
    staffSignIn: makeStaffSignIn(auth),
    getStaffSession: makeGetStaffSession(auth),
    requestPasswordReset: makeRequestPasswordReset(auth),
    sendStaffInvite: makeSendStaffInvite(auth),
    setPasswordWithToken: makeSetPasswordWithToken(auth),
    /** Stores for the admin store selector (includes internal ids). */
    listAdminStores: () => deps.stores.listActive(),
  }
}

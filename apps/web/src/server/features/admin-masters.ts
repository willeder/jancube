import 'server-only'
import {
  type CouponAdminDeps,
  type CouponGrantDeps,
  type MemberAdminDeps,
  makeAddMemberNote,
  makeAssignPriceVersion,
  makeChangeMemberStatus,
  makeCreateCoupon,
  makeCreatePriceProfile,
  makeCreateRoom,
  makeCreateStore,
  makeCreateTemplate,
  makeDeleteCalendarDay,
  makeGetCoupon,
  makeGetMemberDetail,
  makeGetPriceProfile,
  makeGetRoom,
  makeGetRoomMaster,
  makeGetStaff,
  makeGetStoreMaster,
  makeGetTemplate,
  makeGrantCouponToMember,
  makeInviteStaff,
  makeListAdminStoreMasters,
  makeListCampaigns,
  makeListCoupons,
  makeListGrantableCoupons,
  makeListMasterOptions,
  makeListPriceProfiles,
  makeListSimulationOptions,
  makeListStaff,
  makeListTemplates,
  makePreviewSegment,
  makePreviewTemplate,
  makePublishCouponVersion,
  makePublishPriceVersion,
  makePublishTemplateVersion,
  makeResendStaffInvite,
  makeRunCampaign,
  makeSaveCalendarDay,
  makeSaveRoomGroup,
  makeSaveRoomType,
  makeSearchMembers,
  makeSendStaffInvite,
  makeSetCouponStatus,
  makeSetStaffEnabled,
  makeSetWeeklyHours,
  makeSimulatePrice,
  makeUpdateCoupon,
  makeUpdatePriceProfile,
  makeUpdateRoom,
  makeUpdateStaff,
  makeUpdateStore,
  makeUpdateTemplateSettings,
  type PriceAdminDeps,
  type StaffAdminDeps,
  type StoreAdminDeps,
  type TemplateAdminDeps,
} from '@jancube/application'
import {
  KyselyCouponAdminRepository,
  KyselyMemberAdminRepository,
  KyselyPriceAdminRepository,
  KyselyRoomAdminRepository,
  KyselyStaffAdminRepository,
  KyselyStoreAdminRepository,
  KyselyTemplateAdminRepository,
} from '@jancube/infrastructure'
import type { Deps } from '../deps'

/**
 * A-11〜A-23 admin masters: members, coupons, campaigns, prices, stores, rooms, notification
 * templates and staff. Every use case takes the signed-in staff member first and checks the
 * permission (and store scope) itself.
 */
export function adminMasterFeatures(deps: Deps) {
  const { db, audit, clock } = deps
  const members = new KyselyMemberAdminRepository(db)
  const coupons = new KyselyCouponAdminRepository(db)
  const memberDeps: MemberAdminDeps = { members, audit, clock }
  const couponDeps: CouponAdminDeps = { coupons, audit, clock }
  const grantDeps: CouponGrantDeps = {
    members,
    coupons,
    campaigns: coupons,
    notify: deps.notify,
    audit,
    clock,
  }
  const priceDeps: PriceAdminDeps = {
    prices: new KyselyPriceAdminRepository(db),
    pricing: deps.booking.pricing,
    coupons,
    audit,
    clock,
    // Same rule as the booking flow (deps.ts, tracker #6).
    combinationRule: 'cheapest-combination',
  }
  const storeDeps: StoreAdminDeps = {
    storeAdmin: new KyselyStoreAdminRepository(db),
    rooms: new KyselyRoomAdminRepository(db),
    audit,
    clock,
  }
  const templateDeps: TemplateAdminDeps = {
    templates: new KyselyTemplateAdminRepository(db),
    audit,
    clock,
  }
  const staffDeps: StaffAdminDeps = {
    staffAdmin: new KyselyStaffAdminRepository(db),
    sendInvite: makeSendStaffInvite({
      staff: deps.staff,
      passwords: deps.passwords,
      tokens: deps.hasher,
      random: deps.random,
      email: deps.email,
      audit,
      clock,
    }),
    audit,
    clock,
  }
  return {
    // A-11 / A-12
    searchMembers: makeSearchMembers(memberDeps),
    getMemberDetail: makeGetMemberDetail(memberDeps),
    changeMemberStatus: makeChangeMemberStatus(memberDeps),
    addMemberNote: makeAddMemberNote(memberDeps),
    // A-13 / A-15
    grantCouponToMember: makeGrantCouponToMember(grantDeps),
    previewSegment: makePreviewSegment(grantDeps),
    runCampaign: makeRunCampaign(grantDeps),
    listCampaigns: makeListCampaigns(grantDeps),
    // A-14
    listCoupons: makeListCoupons(couponDeps),
    getCoupon: makeGetCoupon(couponDeps),
    createCoupon: makeCreateCoupon(couponDeps),
    publishCouponVersion: makePublishCouponVersion(couponDeps),
    updateCoupon: makeUpdateCoupon(couponDeps),
    setCouponStatus: makeSetCouponStatus(couponDeps),
    listGrantableCoupons: makeListGrantableCoupons(couponDeps),
    // A-16 / A-17
    listPriceProfiles: makeListPriceProfiles(priceDeps),
    getPriceProfile: makeGetPriceProfile(priceDeps),
    createPriceProfile: makeCreatePriceProfile(priceDeps),
    updatePriceProfile: makeUpdatePriceProfile(priceDeps),
    publishPriceVersion: makePublishPriceVersion(priceDeps),
    assignPriceVersion: makeAssignPriceVersion(priceDeps),
    simulatePrice: makeSimulatePrice(priceDeps),
    listSimulationOptions: makeListSimulationOptions(priceDeps),
    // A-18 / A-19
    listStoreMasters: makeListAdminStoreMasters(storeDeps),
    listMasterOptions: makeListMasterOptions(storeDeps),
    getStoreMaster: makeGetStoreMaster(storeDeps),
    createStore: makeCreateStore(storeDeps),
    updateStore: makeUpdateStore(storeDeps),
    setWeeklyHours: makeSetWeeklyHours(storeDeps),
    saveCalendarDay: makeSaveCalendarDay(storeDeps),
    deleteCalendarDay: makeDeleteCalendarDay(storeDeps),
    getRoomMaster: makeGetRoomMaster(storeDeps),
    getRoom: makeGetRoom(storeDeps),
    saveRoomType: makeSaveRoomType(storeDeps),
    saveRoomGroup: makeSaveRoomGroup(storeDeps),
    createRoom: makeCreateRoom(storeDeps),
    updateRoom: makeUpdateRoom(storeDeps),
    // A-21
    listTemplates: makeListTemplates(templateDeps),
    getTemplate: makeGetTemplate(templateDeps),
    previewTemplate: makePreviewTemplate(),
    createTemplate: makeCreateTemplate(templateDeps),
    updateTemplateSettings: makeUpdateTemplateSettings(templateDeps),
    publishTemplateVersion: makePublishTemplateVersion(templateDeps),
    // A-23
    listStaff: makeListStaff(staffDeps),
    getStaff: makeGetStaff(staffDeps),
    inviteStaff: makeInviteStaff(staffDeps),
    updateStaff: makeUpdateStaff(staffDeps),
    setStaffEnabled: makeSetStaffEnabled(staffDeps),
    resendStaffInvite: makeResendStaffInvite(staffDeps),
  }
}

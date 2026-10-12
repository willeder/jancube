import 'server-only'
import {
  type AccessKeyProvider,
  makeAdminOperations,
  makeCleaningWork,
  makeOperations,
  type OperationsDeps,
} from '@jancube/application'
import {
  ConsoleAccessKeyProvider,
  KyselyAccessKeyRepository,
  KyselyBatchRunRepository,
  KyselyCleaningRepository,
  KyselyLockDeviceRepository,
  KyselyOperationsRepository,
  SmartRoomingAccessKeyProvider,
  UnconfiguredAccessKeyProvider,
} from '@jancube/infrastructure'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Deps } from '../deps'

/**
 * Lock API (SmartRooming Connect). Development without SMARTROOMING_API_TOKEN uses a local
 * stand-in; deployed environments without it fail every call (and raise alerts).
 */
function lockProvider(isDevelopment: boolean): AccessKeyProvider {
  const env = getCloudflareContext().env as unknown as Record<string, string | undefined>
  const apiToken = env.SMARTROOMING_API_TOKEN
  if (apiToken) {
    return new SmartRoomingAccessKeyProvider({
      apiToken,
      baseUrl: env.SMARTROOMING_BASE_URL || undefined,
      timeZone: env.SMARTROOMING_TIME_ZONE || undefined,
    })
  }
  return isDevelopment ? new ConsoleAccessKeyProvider() : new UnconfiguredAccessKeyProvider()
}

/** Rooms, cleaning and keys: A-07, A-09, A-10, A-20 and K-01〜K-03. */
export function operationsFeatures(deps: Deps) {
  const ops = new KyselyOperationsRepository(deps.db)
  const operationsDeps: OperationsDeps = {
    ops,
    bookings: deps.bookings,
    cleaning: new KyselyCleaningRepository(deps.db),
    stores: deps.stores,
    keys: new KyselyAccessKeyRepository(deps.db),
    devices: new KyselyLockDeviceRepository(deps.db),
    provider: lockProvider(deps.config.isDevelopment),
    secrets: deps.secrets,
    alerts: deps.alerts,
    audit: deps.audit,
    batchRuns: new KyselyBatchRunRepository(deps.db),
    notifyBooking: deps.notifyBooking,
    clock: deps.clock,
  }
  const operations = makeOperations(operationsDeps)
  const admin = makeAdminOperations(operationsDeps, operations)
  const cleaning = makeCleaningWork(operationsDeps, operations)
  return {
    // A-07
    getAssignmentOptions: admin.getAssignmentOptions,
    reassignRoom: admin.reassignRoom,
    // A-09
    listKeys: admin.listKeys,
    getKeyDetail: admin.getKeyDetail,
    reissueKey: admin.reissueKey,
    resendKeyNotice: admin.resendKeyNotice,
    recordManualUnlock: admin.recordManualUnlock,
    runDayBeforeBatchNow: admin.runDayBeforeBatchNow,
    // A-20
    listLockDevices: admin.listLockDevices,
    getLockDevice: admin.getLockDevice,
    saveLockDevice: admin.saveLockDevice,
    testLockDevice: admin.testLockDevice,
    testLockDevices: admin.testLockDevices,
    // A-10 / K-01〜K-03
    getCleaningBoard: cleaning.getCleaningBoard,
    cleaningAssignees: cleaning.cleaningAssignees,
    getTodayCleaningTasks: cleaning.getTodayTasks,
    startCleaningTask: cleaning.startCleaningTask,
    completeCleaningTask: cleaning.completeCleaningTask,
    addRoomMemo: cleaning.addRoomMemo,
    getCleaningLog: cleaning.getCleaningLog,
    /** Store settings (time zone) for operations screens. */
    getOperationsStore: (storeId: number) => ops.store(storeId),
  }
}

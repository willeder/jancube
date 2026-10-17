import type {
  AccessKeyStatus,
  CleaningTaskStatus,
  CleaningTaskType,
  LocalDate,
  PlannedCleaningTask,
  RoomUse,
  TimeRange,
} from '@jancube/domain'

/** bookings.status (same values as BookingStatus; kept here so the ports do not import each other). */
type BookingStatus = 'draft' | 'confirmed' | 'completed' | 'canceled' | 'expired'

// ---------------------------------------------------------------- stores and bookings

/** Store settings used by rooms, cleaning and keys. */
export interface OpsStore {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly timezone: string
  readonly cleaningBufferMinutes: number
  readonly keyBeforeMinutes: number
  readonly keyAfterMinutes: number
  /** stores.room_finalize_minutes; null = default (F-RM-05, CQ-31 open). */
  readonly roomFinalizeMinutes: number | null
}

export interface OpsAssignment {
  readonly id: number
  readonly roomId: number
  readonly roomCode: string
  readonly roomName: string
  readonly status: 'provisional' | 'final'
  readonly source: 'batch' | 'manual' | 'named'
  readonly assignedAt: Date
}

/** A booking as rooms / cleaning / keys see it. */
export interface OpsBooking {
  readonly id: number
  readonly bookingCode: string
  readonly status: BookingStatus
  readonly storeId: number
  readonly roomGroupId: number
  readonly roomGroupName: string
  readonly requestedRoomId: number | null
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly guestCount: number
  readonly memberId: number | null
  /** Contact name snapshot (staff screens only). */
  readonly contactName: string | null
  readonly assignment: OpsAssignment | null
}

export interface OperationsRepository {
  activeStores(): Promise<OpsStore[]>
  store(storeId: number): Promise<OpsStore | null>
  booking(bookingId: number): Promise<OpsBooking | null>
  bookingByCode(bookingCode: string): Promise<OpsBooking | null>
  /** Bookings of a business date with the given statuses, by start time. */
  bookingsOn(
    storeId: number,
    date: LocalDate,
    statuses: readonly BookingStatus[],
  ): Promise<OpsBooking[]>
  /** Confirmed bookings ending after `from` and starting before `to` that have no access key at all. */
  bookingsWithoutKey(from: Date, to: Date, limit: number): Promise<number[]>
  /** Active provisional assignments of confirmed bookings starting before `until`. */
  provisionalAssignments(until: Date): Promise<
    {
      assignmentId: number
      start: Date
      finalizeMinutes: number | null
      businessDate?: LocalDate
      timezone?: string
    }[]
  >
  finalizeAssignments(assignmentIds: readonly number[], at: Date): Promise<number>
  /** booking_cancellations amounts for the cancellation notice. */
  cancellation(bookingId: number): Promise<{ fee: number; refund: number } | null>
  /** Rooms whose booking has started since they were last cleaned become dirty. */
  markUsedRoomsDirty(now: Date): Promise<number>
}

// ---------------------------------------------------------------- assignment (inside the inventory lock)

export interface AssignmentContext {
  readonly bufferMinutes: number
  readonly timezone: string
  /** Rooms of the group in service. */
  readonly rooms: readonly {
    readonly roomId: number
    readonly code: string
    readonly name: string
    readonly sortOrder: number
    readonly cleaningStatus: 'clean' | 'dirty'
    readonly usageMinutes: number
    readonly blocks: readonly TimeRange[]
  }[]
  /** Bookings of the group around the date: confirmed/completed, and drafts whose hold is active. */
  readonly bookings: readonly {
    readonly bookingId: number
    readonly status: BookingStatus
    readonly businessDate: LocalDate
    readonly range: TimeRange
    readonly requestedRoomId: number | null
    readonly assignedRoomId: number | null
  }[]
}

/** Assignment changes; only available inside BookingRepository.withInventoryLock. */
export interface LockedAssignmentTx {
  assignmentContext(
    roomGroupId: number,
    businessDate: LocalDate,
    now: Date,
  ): Promise<AssignmentContext>
  /** Inserts the booking's current assignment (the previous one must be released first). */
  assignRoom(input: {
    readonly bookingId: number
    readonly roomId: number
    readonly status: 'provisional' | 'final'
    readonly source: 'batch' | 'manual' | 'named'
    readonly staffId: number | null
    readonly reason: string | null
    readonly at: Date
  }): Promise<number>
  releaseAssignment(bookingId: number, at: Date, reason: string): Promise<void>
}

// ---------------------------------------------------------------- cleaning

export interface CleaningRoom {
  readonly roomId: number
  readonly code: string
  readonly name: string
  readonly roomTypeName: string
  readonly operatingStatus: 'active' | 'paused' | 'broken'
  readonly cleaningStatus: 'clean' | 'dirty'
  readonly lastCleanedAt: Date | null
  readonly sortOrder: number
}

export interface CleaningTask {
  readonly id: number
  readonly storeId: number
  readonly roomId: number
  readonly roomCode: string
  readonly roomName: string
  readonly bookingId: number | null
  /** Start of the booking that needs the room (spot tasks). */
  readonly bookingStart: Date | null
  readonly businessDate: LocalDate
  readonly taskType: CleaningTaskType
  readonly status: CleaningTaskStatus
  readonly urgent: boolean
  readonly plannedStartAt: Date | null
  readonly dueAt: Date
  readonly assignedStaffName: string | null
  readonly startedAt: Date | null
  readonly generationKey: string
}

export interface CleaningLogEntry {
  readonly taskId: number
  readonly roomCode: string
  readonly roomName: string
  readonly taskType: CleaningTaskType
  readonly workerName: string
  readonly startedAt: Date | null
  readonly completedAt: Date
  readonly wasOverdue: boolean
  readonly notes: string | null
}

export interface RoomActivity {
  readonly id: number
  readonly roomCode: string
  readonly roomName: string
  readonly staffName: string
  readonly source: 'cleaning' | 'admin'
  readonly action: string
  readonly body: string
  readonly occurredAt: Date
}

export interface CleaningRepository {
  rooms(storeId: number): Promise<CleaningRoom[]>
  /** Rooms in use (active assignment, or named room) by confirmed bookings overlapping [from, to). */
  roomUses(storeId: number, from: Date, to: Date): Promise<RoomUse[]>
  tasks(storeId: number, date: LocalDate): Promise<CleaningTask[]>
  task(taskId: number): Promise<CleaningTask | null>
  /** Inserts planned tasks (idempotent by generation key) and cancels pending ones not planned. */
  syncTasks(
    storeId: number,
    date: LocalDate,
    planned: readonly PlannedCleaningTask[],
    at: Date,
  ): Promise<{ created: number; canceled: number }>
  startTask(
    taskId: number,
    input: {
      readonly workerId: number
      readonly loggedBy: number
      readonly source: 'cleaning' | 'admin'
      readonly at: Date
    },
  ): Promise<boolean>
  /** Writes cleaning_logs, marks the task done and the room clean. False if already done/canceled. */
  completeTask(
    taskId: number,
    input: {
      readonly workerId: number
      readonly loggedBy: number
      readonly source: 'cleaning' | 'admin'
      readonly notes: string | null
      readonly at: Date
    },
  ): Promise<boolean>
  logs(storeId: number, from: Date, to: Date): Promise<CleaningLogEntry[]>
  addActivity(entry: {
    readonly roomId: number
    readonly taskId: number | null
    readonly staffId: number
    readonly source: 'cleaning' | 'admin'
    readonly action: string
    readonly body: string
    readonly at: Date
  }): Promise<void>
  activities(storeId: number, from: Date, to: Date): Promise<RoomActivity[]>
  /** Active staff holding one of `roles` for the store (or all stores). */
  staffWithRoles(storeId: number, roles: readonly string[]): Promise<{ id: number; name: string }[]>
}

// ---------------------------------------------------------------- keys and lock devices

export interface LockDevice {
  readonly id: number
  readonly storeId: number
  readonly storeCode: string
  readonly name: string
  readonly provider: string
  readonly providerAccountId: string
  /** Provider key of the entrance door (SmartRooming EntranceDoorApiKey). */
  readonly externalDeviceId: string
  /** Where the API credential is kept (e.g. an environment secret name); never the secret itself. */
  readonly secretReference: string | null
  readonly batteryPercent: number | null
  readonly communicationStatus: 'unknown' | 'online' | 'offline'
  readonly lastResponseAt: Date | null
  readonly isActive: boolean
}

export interface LockDeviceInput {
  readonly storeId: number
  readonly name: string
  readonly provider: string
  readonly providerAccountId: string
  readonly externalDeviceId: string
  readonly secretReference: string | null
  readonly isActive: boolean
}

export interface LockDeviceRepository {
  list(storeIds: readonly number[] | null): Promise<LockDevice[]>
  find(id: number): Promise<LockDevice | null>
  /** The store's entrance lock (tracker #10: one per store). */
  activeForStore(storeId: number): Promise<LockDevice | null>
  create(input: LockDeviceInput): Promise<number>
  update(id: number, input: LockDeviceInput): Promise<void>
  recordStatus(
    id: number,
    status: {
      readonly communication: 'online' | 'offline' | 'unknown'
      readonly batteryPercent: number | null
      readonly at: Date
    },
  ): Promise<void>
}

export interface AccessKeyRecord {
  readonly id: number
  readonly bookingId: number
  readonly storeId: number
  readonly lockDeviceId: number
  readonly providerKeyId: string | null
  readonly codeCiphertext: Uint8Array | null
  readonly validFrom: Date
  readonly validTo: Date
  readonly status: AccessKeyStatus
  readonly idempotencyKey: string
  readonly issuedAt: Date | null
  readonly revokedAt: Date | null
  readonly createdAt: Date
  /** API attempts of the current phase (issue while pending, revoke while revoke_pending). */
  readonly attempts: number
  readonly lastAttemptAt: Date | null
}

export interface KeyEvent {
  readonly id: number
  readonly accessKeyId: number | null
  readonly lockDeviceId: number
  readonly bookingId: number | null
  readonly eventType: string
  readonly result: 'requested' | 'success' | 'failure' | 'unknown'
  readonly attemptNo: number
  readonly occurredAt: Date
  readonly errorCode: string | null
  readonly details: Readonly<Record<string, unknown>> | null
  readonly staffName: string | null
}

export interface AccessKeyRepository {
  /** Keys of the bookings, newest first. */
  keysForBookings(bookingIds: readonly number[]): Promise<AccessKeyRecord[]>
  key(id: number): Promise<AccessKeyRecord | null>
  /** Idempotent on `idempotencyKey`; returns the key id. */
  createKey(input: {
    readonly bookingId: number
    readonly storeId: number
    readonly lockDeviceId: number
    readonly validFrom: Date
    readonly validTo: Date
    readonly idempotencyKey: string
  }): Promise<number>
  markIssued(
    id: number,
    input: {
      readonly providerKeyId: string
      readonly codeCiphertext: Uint8Array
      readonly keyVersion: string
      readonly at: Date
    },
  ): Promise<void>
  setStatus(id: number, status: AccessKeyStatus, at: Date): Promise<void>
  /** key_events: every API attempt and manual action. Details must not contain codes or tokens. */
  recordEvent(event: {
    readonly accessKeyId: number | null
    readonly lockDeviceId: number
    readonly bookingId: number | null
    readonly eventType: string
    readonly result: 'requested' | 'success' | 'failure' | 'unknown'
    readonly requestKey: string | null
    readonly attemptNo: number
    readonly errorCode?: string | null
    readonly details?: Readonly<Record<string, unknown>> | null
    readonly staffId?: number | null
    readonly at: Date
  }): Promise<void>
  events(bookingId: number): Promise<KeyEvent[]>
  /** Keys waiting for an API call (pending issue or pending revocation). */
  pendingWork(limit: number): Promise<AccessKeyRecord[]>
  /** Issued keys past their validity become expired. */
  expireKeys(now: Date): Promise<number>
}

/** Thrown by lock adapters; `code` is safe to store (no secrets). */
export class AccessKeyProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** False when retrying cannot help (e.g. the device does not exist). */
    readonly retryable = true,
  ) {
    super(message)
    this.name = 'AccessKeyProviderError'
  }
}

/** Smart-lock provider (F-KEY-01〜08). Production adapter: SmartRooming Connect API (NinjaLock M). */
export interface AccessKeyProvider {
  readonly name: string
  /**
   * Issues an entry code valid in [validFrom, validTo]. Must be safe to call again with the same
   * `requestKey` (returns the code created by an earlier attempt instead of a second one).
   */
  issue(
    device: LockDevice,
    input: { readonly requestKey: string; readonly validFrom: Date; readonly validTo: Date },
  ): Promise<{ providerKeyId: string; code: string; details?: Record<string, string> }>
  /** Removes the code. Already removed counts as success. */
  revoke(device: LockDevice, providerKeyId: string): Promise<void>
  /** Communication check (F-KEY-08). Battery is null when the provider does not report it. */
  status(device: LockDevice): Promise<{
    communication: 'online' | 'offline' | 'unknown'
    batteryPercent: number | null
    detail: string | null
  }>
}

// ---------------------------------------------------------------- expired holds

export interface HoldExpiryRepository {
  /** Drafts whose hold has expired, with their open checkout sessions. */
  expiredHolds(now: Date, limit: number): Promise<{ bookingId: number; checkoutIds: string[] }[]>
  /** draft → expired, pending payments canceled, coupon reservations released (one transaction). */
  expireHold(bookingId: number, now: Date): Promise<boolean>
}

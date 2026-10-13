import 'server-only'
import type { StaffSession } from '@jancube/application'
import { can } from '@jancube/domain'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { currentStaff } from './admin-session'
import { withContainer } from './container'

/**
 * K-01 担当選択: the store and the worker (作業担当者) chosen on a cleaning device. The signed-in
 * account (入力者) is the staff session; the worker may be someone else sharing the device.
 * Re-validated against the account's store scope on every request.
 */
const SELECTION = 'jc_cleaning'
const MAX_AGE_DAYS = 30

export interface CleaningSelection {
  readonly storeId: number
  readonly workerId: number
  readonly workerName: string
}

export async function writeCleaningSelection(storeId: number, workerId: number): Promise<void> {
  ;(await cookies()).set(SELECTION, `${storeId}.${workerId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/cleaning',
    maxAge: MAX_AGE_DAYS * 86_400,
  })
}

async function readRaw(): Promise<{ storeId: number; workerId: number } | null> {
  const value = (await cookies()).get(SELECTION)?.value
  const [store, worker] = (value ?? '').split('.').map(Number)
  if (!store || !worker || !Number.isSafeInteger(store) || !Number.isSafeInteger(worker))
    return null
  return { storeId: store, workerId: worker }
}

/** Signed-in staff allowed to do cleaning work; otherwise back to K-01. */
export async function requireCleaningStaff(): Promise<StaffSession> {
  const staff = await currentStaff()
  if (!staff || !can(staff.access, 'cleaning.work')) redirect('/cleaning/login')
  return staff
}

/** The validated selection, or null when it is missing or no longer allowed. */
export async function cleaningSelection(staff: StaffSession): Promise<CleaningSelection | null> {
  const raw = await readRaw()
  if (!raw || !can(staff.access, 'cleaning.work', raw.storeId)) return null
  const workers = await withContainer((c) => c.cleaningAssignees(staff, raw.storeId))
  const worker = workers.find((w) => w.id === raw.workerId)
  return worker ? { storeId: raw.storeId, workerId: worker.id, workerName: worker.name } : null
}

export async function requireCleaningSelection(): Promise<{
  staff: StaffSession
  selection: CleaningSelection
}> {
  const staff = await requireCleaningStaff()
  const selection = await cleaningSelection(staff)
  if (!selection) redirect('/cleaning/login')
  return { staff, selection }
}

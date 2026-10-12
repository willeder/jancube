'use server'

import type { EndOption } from '@jancube/application'
import { redirect } from 'next/navigation'
import { withContainer } from './container'
import { toUserMessage } from './errors'
import { clearHoldKey, readHoldKey, writeHoldKey } from './hold-cookie'

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }
export type FormState = { error: string | null }

/** C-03: end times (with prices) for a chosen start. */
export async function getEndOptionsAction(input: {
  storeCode: string
  date: string
  laneKey: string
  start: string
}): Promise<ActionResult<EndOption[]>> {
  try {
    return { ok: true, data: await withContainer((c) => c.getEndOptions(input)) }
  } catch (error) {
    return { ok: false, error: toUserMessage(error) }
  }
}

/** C-03 「この内容で進む」: hold the selected time, then show C-04. */
export async function createHoldAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const previousRequestKey = await readHoldKey()
    const hold = await withContainer((c) =>
      c.createHold({
        storeCode: String(form.get('storeCode')),
        date: String(form.get('date')),
        laneKey: String(form.get('laneKey')),
        start: String(form.get('start')),
        end: String(form.get('end')),
        source: 'web',
        previousRequestKey,
      }),
    )
    await writeHoldKey(hold.requestKey)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/booking/confirm')
}

/** C-04 「お客様情報の入力へ」: save the number of guests and continue to sign-in (C-05). */
export async function confirmHoldAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const key = await readHoldKey()
    await withContainer((c) => c.setGuestCount(key ?? '', Number(form.get('guestCount'))))
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/booking/auth')
}

/** C-04 「日時を変更する」: free the hold and go back to the grid. */
export async function changeSelectionAction(form: FormData): Promise<void> {
  const key = await readHoldKey()
  if (key) await withContainer((c) => c.releaseHold(key))
  await clearHoldKey()
  redirect(`/booking/${String(form.get('storeCode'))}/slots?date=${String(form.get('date'))}`)
}

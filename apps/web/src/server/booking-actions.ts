'use server'

import type { EndOption } from '@jancube/application'
import { withContainer } from './container'
import { toUserMessage } from './errors'

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

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

import type { LockDevice } from '@jancube/application'
import { describe, expect, it } from 'vitest'
import { SmartRoomingAccessKeyProvider } from './smartrooming-provider'

const device = { externalDeviceId: 'door/1', name: 'ENTRANCE' } as LockDevice

function fakeApi(responses: { status: number; body?: unknown }[]) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    calls.push({
      method: init.method ?? 'GET',
      url,
      body: init.body ? JSON.parse(init.body as string) : null,
      auth: headers.authorization ?? null,
    })
    const next = responses.shift() ?? { status: 500 }
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
    })
  }) as unknown as typeof fetch
  return {
    calls,
    provider: new SmartRoomingAccessKeyProvider({ apiToken: 'token-x', fetch: fetcher }),
  }
}

const validFrom = new Date('2026-11-10T03:45:00Z') // 12:45 JST
const validTo = new Date('2026-11-10T07:15:00Z') // 16:15 JST

describe('SmartRoomingAccessKeyProvider', () => {
  it('issues an entrance phone passcode with the period in store time', async () => {
    const api = fakeApi([
      { status: 200, body: [] },
      {
        status: 200,
        body: [
          { id: 1, passcode: '111111', comment: 'other' },
          {
            id: 42,
            passcode: '123456',
            comment: 'jancube booking:7:key:1',
            phone_number: '03-3000-1234',
          },
        ],
      },
    ])
    const result = await api.provider.issue(device, {
      requestKey: 'booking:7:key:1',
      validFrom,
      validTo,
    })
    expect(result).toEqual({
      providerKeyId: '42',
      code: '123456',
      details: { phoneNumber: '03-3000-1234' },
    })
    expect(api.calls[1]).toEqual({
      method: 'POST',
      url: 'https://www.smartrooming.net/api/v2/entrance-doors/phone-passcodes/door%2F1',
      body: {
        begin: '2026-11-10 12:45:00',
        end: '2026-11-10 16:14:59',
        comment: 'jancube booking:7:key:1',
      },
      auth: 'Bearer token-x',
    })
  })

  it('returns the passcode of an earlier attempt instead of creating another', async () => {
    const api = fakeApi([
      { status: 200, body: [{ id: 42, passcode: '123456', comment: 'jancube booking:7:key:1' }] },
    ])
    const result = await api.provider.issue(device, {
      requestKey: 'booking:7:key:1',
      validFrom,
      validTo,
    })
    expect(result.providerKeyId).toBe('42')
    expect(api.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('maps errors without echoing response bodies', async () => {
    const api = fakeApi([
      { status: 200, body: [] },
      { status: 400, body: { secret: '999999' } },
    ])
    await expect(
      api.provider.issue(device, { requestKey: 'k', validFrom, validTo }),
    ).rejects.toMatchObject({
      code: 'rejected',
      retryable: false,
      message: expect.not.stringContaining('999999'),
    })
    const server = fakeApi([{ status: 503 }])
    await expect(
      server.provider.issue(device, { requestKey: 'k', validFrom, validTo }),
    ).rejects.toMatchObject({
      code: 'server_error',
      retryable: true,
    })
  })

  it('treats an already deleted passcode as revoked and reports status', async () => {
    const api = fakeApi([
      { status: 404 },
      { status: 204 },
      { status: 200, body: [] },
      { status: 401 },
    ])
    await api.provider.revoke(device, '42')
    await api.provider.revoke(device, '43')
    expect(api.calls[1]).toMatchObject({
      method: 'DELETE',
      url: 'https://www.smartrooming.net/api/v2/entrance-door-phone-passcodes/43',
    })
    expect(await api.provider.status(device)).toMatchObject({ communication: 'online' })
    expect(await api.provider.status(device)).toMatchObject({
      communication: 'offline',
      detail: 'unauthorized',
    })
  })
})

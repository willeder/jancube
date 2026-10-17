import { describe, expect, it } from 'vitest'
import { deploymentSetupResponse } from './deployment-status'

describe('Cloudflare beta setup gate', () => {
  it('blocks all routes and writes without a database, even if setup was cleared', async () => {
    for (const route of ['/', '/admin/login', '/api/webhooks/stripe', '/api/line/webhook']) {
      for (const method of ['GET', 'POST']) {
        const response = deploymentSetupResponse(
          new Request(`https://beta.example${route}`, { method }),
          { BETA_SETUP_MODE: '0' },
        )
        expect(response?.status).toBe(503)
        expect(response?.headers.get('Cache-Control')).toBe('no-store')
      }
    }
  })

  it('reports not-ready without leaking placeholder values and delegates only once configured', async () => {
    const env = { BETA_SETUP_MODE: '1', HYPERDRIVE: {}, SESSION_SECRET: 'private-placeholder' }
    const response = deploymentSetupResponse(new Request('https://beta.example/healthz'), env)
    expect(await response?.json()).toEqual({ status: 'setup_required', ready: false })
    const html = deploymentSetupResponse(new Request('https://beta.example/'), env)
    expect(await html?.text()).not.toContain('private-placeholder')
    expect(
      deploymentSetupResponse(new Request('https://beta.example/'), {
        ...env,
        BETA_SETUP_MODE: '0',
      }),
    ).toBeNull()
  })
})

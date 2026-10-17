// Preserve OpenNext's exports while applying the account-bootstrap gate before all routes.
import app from './.open-next/worker.js'
import { deploymentSetupResponse } from './src/server/deployment-status.ts'

export * from './.open-next/worker.js'

export default {
  ...app,
  async fetch(request, env, ctx) {
    return deploymentSetupResponse(request, env) ?? app.fetch(request, env, ctx)
  },
}

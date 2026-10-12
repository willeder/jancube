import { jobsConfig, withJobs } from './container'

/**
 * Scheduled batches. Each cron maps to application use cases; this file only does routing,
 * runtime wiring and logging.
 */
export default {
  async scheduled(controller, env, ctx) {
    const config = jobsConfig(env as unknown as Record<string, unknown>)
    const run = withJobs(env.HYPERDRIVE.connectionString, config, async (jobs) => {
      switch (controller.cron) {
        case '* * * * *': {
          // Events first, so notifications they queue go out in the same tick.
          const outbox = await jobs.processOutbox()
          const sent = await jobs.dispatchNotifications()
          console.info(
            `[jobs] minute: outbox=${JSON.stringify(outbox)} notifications=${JSON.stringify(sent)}`,
          )
          break
        }
        case '0 11 * * *':
          console.info('[jobs] day-before batch (20:00 JST)')
          break
        default:
          console.warn(`[jobs] unknown cron: ${controller.cron}`)
      }
    })
    ctx.waitUntil(run)
    await run
  },
} satisfies ExportedHandler<Env>

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
          const holds = await jobs.expireHolds()
          // Events first, so notifications they queue go out in the same tick.
          const outbox = await jobs.processOutbox()
          // Finalize rooms (F-RM-05), retry lock API calls, catch up missed bookings.
          const operations = await jobs.operations.runMinute()
          const sent = await jobs.dispatchNotifications()
          console.info(
            `[jobs] minute: holds=${JSON.stringify(holds)} outbox=${JSON.stringify(outbox)} operations=${JSON.stringify(operations)} notifications=${JSON.stringify(sent)}`,
          )
          break
        }
        case '0 11 * * *': {
          // 20:00 JST: assign rooms → cleaning plan → entry codes → notices (tracker #9, CQ-68).
          const results = await jobs.operations.runDayBeforeBatch()
          const sent = await jobs.dispatchNotifications()
          console.info(
            `[jobs] day-before batch: ${JSON.stringify(results)} notifications=${JSON.stringify(sent)}`,
          )
          break
        }
        default:
          console.warn(`[jobs] unknown cron: ${controller.cron}`)
      }
    })
    ctx.waitUntil(run)
    await run
  },
} satisfies ExportedHandler<Env>

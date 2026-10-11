/**
 * Scheduled batches. Each cron maps to an application use case; this file only does routing,
 * runtime wiring and logging. The use cases are added as features are built.
 */
export default {
  async scheduled(controller, _env, _ctx) {
    switch (controller.cron) {
      case '* * * * *':
        console.info('[jobs] minute tick: hold expiry + lock jobs (not implemented yet)')
        break
      case '0 9 * * *':
        console.info('[jobs] day-before batch (not implemented yet)')
        break
      default:
        console.warn(`[jobs] unknown cron: ${controller.cron}`)
    }
  },
} satisfies ExportedHandler<Env>

import 'server-only'
import {
  type LineIdentityVerifier,
  type LineReplySender,
  type LineWebhookParser,
  makeExportReport,
  makeGetLineLinkStatus,
  makeGetReportSummary,
  makeHandleLineWebhook,
  makeLineSignIn,
  makeLinkLineAccount,
  makeListReportExports,
  makeRecordFunnelEvent,
  makeSearchAuditLogs,
  makeUnlinkLineAccount,
  type ReportDeps,
} from '@jancube/application'
import { DomainError } from '@jancube/domain'
import {
  ConsoleLineSender,
  DevLineIdentityVerifier,
  KyselyAuditLogQuery,
  KyselyFunnelEventRepository,
  KyselyLineLinkRepository,
  KyselyReportExportRepository,
  KyselyReportQueries,
  KyselyWebhookRepository,
  LineLoginVerifier,
  LineMessagingSender,
  LineSignatureWebhookParser,
} from '@jancube/infrastructure'
import type { Deps } from '../deps'

/** Development without a LINE channel (docs/line-setup.md). Never used outside APP_ENV=development. */
const DEV_PROVIDER_ID = 'dev-line-provider'
export const DEV_LINE_CHANNEL_SECRET = 'dev-only-line-channel-secret'

const notConfigured = (setting: string) => async (): Promise<never> => {
  throw new DomainError('line_not_configured', `${setting} is not configured`)
}

/** Real LINE adapters when configured, local stand-ins in development, "not configured" otherwise. */
function lineAdapters({ config }: Deps) {
  const dev = config.isDevelopment
  const channelId = config.line.loginChannelId
  const verifier: LineIdentityVerifier = channelId
    ? new LineLoginVerifier({ channelId })
    : dev
      ? new DevLineIdentityVerifier()
      : { verifyIdToken: notConfigured('LINE_LOGIN_CHANNEL_ID'), friendship: async () => null }
  const secret = config.line.channelSecret ?? (dev ? DEV_LINE_CHANNEL_SECRET : null)
  const parser: LineWebhookParser = secret
    ? new LineSignatureWebhookParser({ channelSecret: secret })
    : { parse: notConfigured('LINE_CHANNEL_SECRET') }
  const replies: LineReplySender = config.lineChannelAccessToken
    ? new LineMessagingSender({ channelAccessToken: config.lineChannelAccessToken })
    : dev
      ? new ConsoleLineSender()
      : { reply: notConfigured('LINE_CHANNEL_ACCESS_TOKEN') }
  return {
    verifier,
    parser,
    replies,
    providerId: channelId ?? (dev ? DEV_PROVIDER_ID : 'unconfigured'),
    /** The /liff page shows a developer form instead of the LIFF SDK. */
    devStandIn: !channelId && dev,
  }
}

/**
 * LINE / LIFF (F-LINE-01〜04, F-AUTH-06), A-24 audit log, A-27 reports and CSV and F-RPT-01
 * funnel events. (A-29 embed codes need no adapters: the page calls buildEmbedSnippets directly.)
 */
export function lineReportsFeatures(deps: Deps) {
  const line = lineAdapters(deps)
  const links = new KyselyLineLinkRepository(deps.db)
  const account = {
    verifier: line.verifier,
    links,
    members: deps.members,
    audit: deps.audit,
    clock: deps.clock,
    providerId: line.providerId,
  }
  const reports: ReportDeps = {
    reports: new KyselyReportQueries(deps.db),
    stores: deps.stores,
    exports: new KyselyReportExportRepository(deps.db),
    auditLogs: new KyselyAuditLogQuery(deps.db),
    audit: deps.audit,
    clock: deps.clock,
  }
  return {
    lineSettings: { liffId: deps.config.line.liffId, devStandIn: line.devStandIn },
    lineSignIn: makeLineSignIn(account),
    linkLineAccount: makeLinkLineAccount(account),
    unlinkLineAccount: makeUnlinkLineAccount(account),
    getLineLinkStatus: makeGetLineLinkStatus(account),
    handleLineWebhook: makeHandleLineWebhook({
      parser: line.parser,
      webhooks: new KyselyWebhookRepository(deps.db),
      links,
      replies: line.replies,
      clock: deps.clock,
      providerId: line.providerId,
      environment: deps.config.isDevelopment ? 'test' : 'live',
    }),
    getReportSummary: makeGetReportSummary(reports),
    exportReport: makeExportReport(reports),
    listReportExports: makeListReportExports(reports),
    searchAuditLogs: makeSearchAuditLogs(reports),
    recordFunnelEvent: makeRecordFunnelEvent({
      funnel: new KyselyFunnelEventRepository(deps.db),
      stores: deps.stores,
      clock: deps.clock,
    }),
  }
}

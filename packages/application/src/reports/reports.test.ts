import type { StaffAccess, Store } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { buildEmbedSnippets } from '../embed/embed-code'
import type { AuditLog } from '../ports/ops'
import type {
  AcquisitionRow,
  BookingLine,
  ReportExportRepository,
  ReportQueries,
} from '../ports/reports'
import { makeSearchAuditLogs } from './audit-logs'
import { CSV_BOM, csvCell, csvLine, formatReportTime } from './csv'
import { includedTax, makeExportReport } from './export-report'
import { makeRecordFunnelEvent } from './funnel'
import {
  makeGetReportSummary,
  occupancyLines,
  type ReportDeps,
  summarizeAcquisition,
  summarizeCoupons,
} from './report-summary'
import { assertReportPeriod, resolveStoreScope } from './scope'

const owner: StaffAccess = { staffId: 1, grants: [{ role: 'owner', storeId: null }] }
const storeAdmin: StaffAccess = { staffId: 2, grants: [{ role: 'admin', storeId: 10 }] }
const storeStaff: StaffAccess = { staffId: 3, grants: [{ role: 'cleaning', storeId: 10 }] }

const STORE = { id: 10, code: 'JC001', name: '大阪本町店', timezone: 'Asia/Tokyo' }

const bookingLine: BookingLine = {
  bookingCode: 'JC-2026-0001',
  storeCode: 'JC001',
  storeName: '大阪本町店',
  businessDate: '2026-11-02',
  start: new Date('2026-11-02T04:00:00Z'),
  end: new Date('2026-11-02T07:00:00Z'),
  roomTypeName: '4麻',
  roomName: null,
  memberCode: 'JC-U-000001',
  status: 'confirmed',
  channel: 'liff',
  acquisitionSource: 'line',
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  guestCount: 4,
  subtotal: 6000,
  discount: 600,
  total: 5400,
  couponCodes: 'WELCOME',
  paid: 5400,
  refunded: 0,
  cancellationFee: null,
  confirmedAt: new Date('2026-11-01T03:00:00Z'),
  canceledAt: null,
  createdAt: new Date('2026-11-01T02:55:00Z'),
}

function fakeQueries(overrides: Partial<ReportQueries> = {}): ReportQueries {
  return {
    stores: async () => [STORE],
    roomCounts: async () => [{ storeId: 10, roomTypeName: '4麻', rooms: 2 }],
    bookedMinutes: async () => [
      { storeId: 10, businessDate: '2026-11-02', roomTypeName: '4麻', minutes: 420, bookings: 2 },
    ],
    dailySales: async () => [
      { storeId: 10, date: '2026-11-01', payments: 1, paid: 5400, refunded: 0 },
    ],
    acquisitionRows: async () => [],
    couponGrantStats: async () => [],
    couponRedemptions: async () => [],
    cleaningRows: async () => [],
    funnelSteps: async () => [{ storeId: 10, step: 'store_selected', visitors: 8 }],
    bookingFunnel: async () => [
      { storeId: 10, holds: 4, signedIn: 3, checkoutStarted: 3, confirmed: 2 },
    ],
    bookingLines: async function* () {
      yield bookingLine
    },
    moneyLines: async function* () {},
    ...overrides,
  }
}

function fakeDeps(queries = fakeQueries()) {
  const exports: { id: number; status: string; rowCount?: number; error?: string }[] = []
  const audits: Parameters<AuditLog['record']>[0][] = []
  const exportRepo: ReportExportRepository = {
    start: async () => {
      exports.push({ id: exports.length + 1, status: 'running' })
      return exports.length
    },
    finish: async (id, result) => {
      const row = exports.find((e) => e.id === id)
      if (!row) return
      row.status = result.status
      if (result.status === 'completed') row.rowCount = result.rowCount
      else row.error = result.error
    },
    recent: async () => [],
  }
  const deps: ReportDeps = {
    reports: queries,
    stores: {
      // Open 10:00-24:00 every day; closed on 2026-11-03.
      weeklyHours: async () =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          opensMinute: 600,
          closesMinute: 1440,
          isClosed: false,
        })),
      calendarOverrides: async () => [
        { date: '2026-11-03', isClosed: true, opensMinute: null, closesMinute: null },
      ],
    },
    exports: exportRepo,
    auditLogs: {
      search: async () => [],
      stream: async function* () {},
      actions: async () => ['staff.sign_in'],
    },
    audit: { record: async (e) => void audits.push(e) },
    clock: { now: () => new Date('2026-11-05T00:00:00Z') },
  }
  return { deps, exports, audits }
}

async function readAll(chunks: AsyncIterable<string>) {
  let text = ''
  for await (const c of chunks) text += c
  return text
}

describe('report scope (F-ADM-02)', () => {
  it('limits store-scoped staff to their stores and needs the permission', () => {
    expect(resolveStoreScope(owner, 'reports.export', null)).toBeNull()
    expect(resolveStoreScope(owner, 'reports.export', 11)).toEqual([11])
    expect(resolveStoreScope(storeAdmin, 'reports.export', null)).toEqual([10])
    expect(() => resolveStoreScope(storeAdmin, 'reports.export', 11)).toThrow(/permission/)
    expect(() => resolveStoreScope(storeStaff, 'reports.export', null)).toThrow(/permission/)
  })

  it('accepts at most one year', () => {
    expect(() => assertReportPeriod('2026-11-01', '2026-11-30')).not.toThrow()
    expect(() => assertReportPeriod('2026-11-30', '2026-11-01')).toThrow(/before/)
    expect(() => assertReportPeriod('2025-01-01', '2026-11-01')).toThrow(/too long/)
    expect(() => assertReportPeriod('2026-02-30', '2026-03-01')).toThrow(/invalid date/)
  })
})

describe('CSV encoding', () => {
  it('quotes separators and neutralises formulas', () => {
    expect(csvLine(['a', 'b,c', 'say "hi"', null, 12, -500])).toBe(
      'a,"b,c","say ""hi""",,12,-500\r\n',
    )
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-1+2')).toBe("'-1+2")
    expect(csvCell('改行\nあり')).toBe('"改行\nあり"')
  })

  it('writes times in Japan time', () => {
    expect(formatReportTime(new Date('2026-11-01T15:04:05Z'))).toBe('2026-11-02 00:04:05')
    expect(formatReportTime(null)).toBe('')
  })

  it('extracts the consumption tax included in an amount', () => {
    expect(includedTax(5500, 10)).toBe(500)
    expect(includedTax(-5500, 10)).toBe(-500)
    expect(includedTax(999, 10)).toBe(90)
    expect(includedTax(1000, null)).toBeNull()
  })
})

describe('aggregations (F-RPT-02/03/05)', () => {
  it('computes occupancy from opening hours, rooms and booked minutes', async () => {
    const { deps } = fakeDeps()
    const lines = await occupancyLines(
      deps,
      { from: '2026-11-02', to: '2026-11-03', storeIds: null },
      [STORE],
    )
    expect(lines).toEqual([
      expect.objectContaining({
        date: '2026-11-02',
        rooms: 2,
        openMinutes: 840,
        availableMinutes: 1680,
        bookedMinutes: 420,
        rate: 25,
      }),
      expect.objectContaining({ date: '2026-11-03', openMinutes: 0, rate: null }),
    ])
  })

  it('groups bookings by acquisition source with first-time and second-booking rates', () => {
    const row = (p: Partial<AcquisitionRow>): AcquisitionRow => ({
      storeId: 10,
      channel: 'web',
      acquisitionSource: 'instagram',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: null,
      total: 5000,
      isFirst: true,
      hasNext: false,
      ...p,
    })
    const lines = summarizeAcquisition([
      row({ hasNext: true }),
      row({}),
      row({ isFirst: false }),
      row({ channel: 'liff', acquisitionSource: 'line', utmSource: null, utmMedium: null }),
    ])
    expect(lines[0]).toMatchObject({
      acquisitionSource: 'instagram',
      bookings: 3,
      sales: 15000,
      firstTime: 2,
      firstTimeRate: 66.7,
      secondBookings: 1,
      secondRate: 50,
    })
    expect(lines[1]).toMatchObject({ channel: 'liff', bookings: 1 })
  })

  it('measures coupon usage and re-booking (reversed uses do not count)', () => {
    const base = {
      couponId: 1,
      couponCode: 'WELCOME',
      couponName: '初回10%',
      appliedAt: new Date(),
      bookingCode: 'B',
      storeId: 10,
      storeCode: 'JC001',
      businessDate: '2026-11-02',
      memberCode: 'M',
      useSequence: 1,
      discount: 500,
      bookingTotal: 4500,
    }
    const [line] = summarizeCoupons(
      [{ couponId: 1, code: 'WELCOME', name: '初回10%', issued: 10, used: 4 }],
      [
        { ...base, status: 'applied', memberBookedAgain: true },
        { ...base, status: 'applied', memberBookedAgain: false },
        { ...base, status: 'reversed', memberBookedAgain: false },
      ],
    )
    expect(line).toMatchObject({
      issued: 10,
      issuedUsed: 4,
      usageRate: 40,
      redemptions: 2,
      discountTotal: 1000,
      salesTotal: 9000,
      rebooked: 1,
      rebookRate: 50,
    })
  })

  it('builds the A-27 summary within the staff member’s scope', async () => {
    const { deps } = fakeDeps()
    const summary = await makeGetReportSummary(deps)(storeAdmin, {
      from: '2026-11-01',
      to: '2026-11-02',
      storeId: null,
    })
    expect(summary.sales).toEqual([expect.objectContaining({ storeCode: 'JC001', net: 5400 })])
    expect(summary.funnel.lines[0]).toMatchObject({
      storeSelected: 8,
      confirmed: 2,
      conversion: 25,
    })
  })
})

describe('CSV export (F-RPT-04, F-PAY-09)', () => {
  it('streams BOM, header and rows and records the export', async () => {
    const { deps, exports, audits } = fakeDeps()
    const file = await makeExportReport(deps)(
      { staffId: 1, access: owner },
      { type: 'bookings', from: '2026-11-01', to: '2026-11-30', storeId: 10 },
    )
    expect(file.filename).toBe('jancube_bookings_JC001_2026-11-01_2026-11-30.csv')
    expect(exports).toEqual([{ id: 1, status: 'running' }])
    const text = await readAll(file.chunks)
    expect(text.startsWith(CSV_BOM)).toBe(true)
    const lines = text.slice(1).split('\r\n')
    expect(lines[0]?.startsWith('予約番号,店舗コード')).toBe(true)
    expect(lines[1]).toContain('JC-2026-0001,JC001,大阪本町店,2026-11-02,2026-11-02 13:00:00')
    expect(lines[1]).toContain(',確定,LINE(LIFF),line,')
    expect(exports[0]).toMatchObject({ status: 'completed', rowCount: 1 })
    expect(audits).toMatchObject([{ action: 'report.export', targetCode: 'bookings' }])
  })

  it('signs refunds negative in the sales export', async () => {
    const { deps } = fakeDeps(
      fakeQueries({
        moneyLines: async function* () {
          const line = {
            occurredAt: new Date('2026-11-01T03:00:00Z'),
            storeCode: 'JC001',
            storeName: '大阪本町店',
            bookingCode: 'B1',
            businessDate: '2026-11-02',
            method: 'card',
            provider: 'stripe',
            amount: 5500,
            taxRatePercent: 10,
            externalId: 'pi_1',
            reason: null,
          }
          yield { ...line, kind: 'payment' as const }
          yield { ...line, kind: 'refund' as const, reason: 'キャンセル' }
        },
      }),
    )
    const file = await makeExportReport(deps)(
      { staffId: 1, access: owner },
      { type: 'sales', from: '2026-11-01', to: '2026-11-30', storeId: null },
    )
    const [, payment, refund] = (await readAll(file.chunks)).slice(1).split('\r\n')
    expect(payment).toContain(',決済,JC001,')
    expect(payment).toContain(',カード,stripe,5500,10,500,pi_1,')
    expect(refund).toContain(',返金,')
    expect(refund).toContain(',-5500,10,-500,pi_1,キャンセル')
  })

  it('marks the export failed when reading fails', async () => {
    const { deps, exports } = fakeDeps(
      fakeQueries({
        // biome-ignore lint/correctness/useYield: fails before the first row
        bookingLines: async function* () {
          throw new Error('connection lost')
        },
      }),
    )
    const file = await makeExportReport(deps)(
      { staffId: 1, access: owner },
      { type: 'bookings', from: '2026-11-01', to: '2026-11-30', storeId: null },
    )
    await expect(readAll(file.chunks)).rejects.toThrow('connection lost')
    expect(exports[0]).toMatchObject({ status: 'failed', error: 'connection lost' })
  })

  it('checks the permission of each report type', async () => {
    const { deps } = fakeDeps()
    const exportReport = makeExportReport(deps)
    await expect(
      exportReport(
        { staffId: 3, access: storeStaff },
        { type: 'sales', from: '2026-11-01', to: '2026-11-30', storeId: 10 },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      exportReport(
        { staffId: 1, access: owner },
        { type: 'members_all', from: '2026-11-01', to: '2026-11-30', storeId: null },
      ),
    ).rejects.toMatchObject({ code: 'report_type_unknown' })
  })
})

describe('audit log search (A-24)', () => {
  it('pages by id and limits scoped staff to their stores', async () => {
    const seen: unknown[] = []
    const entry = (id: number) => ({
      id,
      occurredAt: new Date(),
      actorType: 'system' as const,
      actorLabel: null,
      actorRoles: [],
      storeCode: null,
      action: 'booking.cancel',
      targetType: 'booking',
      targetId: id,
      targetCode: null,
      before: null,
      after: null,
      reason: null,
      ip: null,
      requestId: 'r',
    })
    const search = makeSearchAuditLogs({
      auditLogs: {
        search: async (filter, page) => {
          seen.push({ filter, page })
          return Array.from({ length: 51 }, (_, i) => entry(100 - i))
        },
        stream: async function* () {},
        actions: async () => [],
      },
    })
    const result = await search(storeAdmin, {
      from: '2026-11-01',
      to: '2026-11-07',
      actor: '  堀口 ',
      storeId: null,
    })
    expect(result.entries).toHaveLength(50)
    expect(result.nextBeforeId).toBe(51)
    expect(seen[0]).toMatchObject({
      filter: { actor: '堀口', storeIds: [10] },
      page: { limit: 51, beforeId: null },
    })
  })
})

describe('funnel events (F-RPT-01)', () => {
  it('records valid steps and ignores anything else', async () => {
    const recorded: unknown[] = []
    const record = makeRecordFunnelEvent({
      funnel: { record: async (e) => void recorded.push(e) },
      stores: {
        findActiveByCode: async (code) =>
          code === 'JC001' ? ({ id: 10 } as unknown as Store) : null,
      },
      clock: { now: () => new Date('2026-11-01T00:00:00Z') },
    })
    const visitorKey = '0f8e7a1c-7f2b-4a51-9b11-5d4c3b2a1908'
    expect(
      await record({ visitorKey, step: 'store_selected', channel: 'web', storeCode: 'JC001' }),
    ).toBe(true)
    expect(await record({ visitorKey, step: 'drop_table', channel: 'web' })).toBe(false)
    expect(await record({ visitorKey: 'x', step: 'slots_viewed', channel: 'web' })).toBe(false)
    expect(
      await record({ visitorKey, step: 'slots_viewed', channel: 'web', storeCode: 'NOPE' }),
    ).toBe(false)
    expect(recorded).toEqual([expect.objectContaining({ step: 'store_selected', storeId: 10 })])
  })
})

describe('embed code (A-29)', () => {
  it('builds escaped iframe, link button and shortcode', () => {
    const s = buildEmbedSnippets({
      baseUrl: 'https://jancube.net/',
      storeCode: 'JC001',
      storeName: '大阪"本町"店',
      days: 3,
      theme: 'light',
    })
    expect(s.widgetUrl).toBe('https://jancube.net/embed/availability/JC001?days=3&theme=light')
    expect(s.iframe).toContain(
      'src="https://jancube.net/embed/availability/JC001?days=3&amp;theme=light"',
    )
    expect(s.iframe).toContain('title="雀CUBE 大阪&quot;本町&quot;店 空き状況"')
    expect(s.linkButton).toContain('utm_source=website')
    expect(s.shortcode).toBe(
      '[jancube_availability store="JC001" days="3" theme="light" height="360"]',
    )
    expect(() =>
      buildEmbedSnippets({
        baseUrl: 'javascript:alert(1)',
        storeCode: 'JC001',
        storeName: 'x',
        days: 3,
        theme: 'light',
      }),
    ).toThrow()
    expect(() =>
      buildEmbedSnippets({
        baseUrl: 'https://jancube.net',
        storeCode: '"><script>',
        storeName: 'x',
        days: 3,
        theme: 'light',
      }),
    ).toThrow()
  })
})

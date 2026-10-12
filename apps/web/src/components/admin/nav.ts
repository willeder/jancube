import type { Permission } from '@jancube/domain'

export interface NavItem {
  readonly href: string
  readonly label: string
  readonly permission: Permission
  /** Screen id in the requirements (A-xx). */
  readonly screen: string
}

/**
 * Admin navigation and URL map. Every admin screen lives at the path listed here; links between
 * screens should use these paths.
 */
export const ADMIN_NAV: readonly { group: string; items: readonly NavItem[] }[] = [
  {
    group: '日次運用',
    items: [
      { href: '/admin', label: 'ダッシュボード', permission: 'dashboard.view', screen: 'A-02' },
      { href: '/admin/timeline', label: '予約状況', permission: 'bookings.view', screen: 'A-03' },
      { href: '/admin/bookings', label: '予約一覧', permission: 'bookings.view', screen: 'A-04' },
      {
        href: '/admin/bookings/new',
        label: '代理予約',
        permission: 'bookings.manage',
        screen: 'A-06',
      },
      { href: '/admin/keys', label: '鍵状況', permission: 'keys.manage', screen: 'A-09' },
      { href: '/admin/cleaning', label: '清掃状況', permission: 'cleaning.view', screen: 'A-10' },
      { href: '/admin/blocks', label: '枠ブロック', permission: 'bookings.manage', screen: 'A-22' },
      { href: '/admin/alerts', label: 'アラート', permission: 'alerts.manage', screen: 'A-25' },
    ],
  },
  {
    group: '会員・クーポン',
    items: [
      { href: '/admin/members', label: '会員管理', permission: 'members.view', screen: 'A-11' },
      { href: '/admin/coupons', label: 'クーポン', permission: 'coupons.manage', screen: 'A-14' },
      {
        href: '/admin/coupons/campaigns',
        label: 'セグメント一斉発行',
        permission: 'coupons.manage',
        screen: 'A-15',
      },
    ],
  },
  {
    group: 'マスタ・設定',
    items: [
      {
        href: '/admin/prices',
        label: '料金プロファイル',
        permission: 'prices.manage',
        screen: 'A-16',
      },
      {
        href: '/admin/prices/simulate',
        label: '料金シミュレーション',
        permission: 'prices.manage',
        screen: 'A-17',
      },
      { href: '/admin/stores', label: '店舗マスタ', permission: 'stores.manage', screen: 'A-18' },
      { href: '/admin/rooms', label: '部屋マスタ', permission: 'stores.manage', screen: 'A-19' },
      {
        href: '/admin/lock-devices',
        label: '鍵デバイス',
        permission: 'stores.manage',
        screen: 'A-20',
      },
      {
        href: '/admin/notification-templates',
        label: '通知テンプレート',
        permission: 'notifications.manage',
        screen: 'A-21',
      },
      {
        href: '/admin/staff',
        label: 'スタッフ・ロール',
        permission: 'staff.manage',
        screen: 'A-23',
      },
      {
        href: '/admin/embed',
        label: '埋め込みコード',
        permission: 'stores.manage',
        screen: 'A-29',
      },
    ],
  },
  {
    group: '運用・レポート',
    items: [
      {
        href: '/admin/payments',
        label: '決済・返金履歴',
        permission: 'payments.view',
        screen: 'A-26',
      },
      {
        href: '/admin/reports',
        label: 'レポート・CSV',
        permission: 'reports.export',
        screen: 'A-27',
      },
      { href: '/admin/audit', label: '監査ログ', permission: 'audit.view', screen: 'A-24' },
    ],
  },
]

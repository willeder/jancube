import Link from 'next/link'
import { Badge, buttonClass, Notice, PageHeader, Table, TextLink } from '@/components/admin/ui'
import { ActionForm } from '@/components/operations/ActionForm'
import { localDateTime } from '@/components/operations/time'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { testLockDevicesAction } from '@/server/operations-actions'

export const dynamic = 'force-dynamic'

const LOW_BATTERY = 20

/** A-20 鍵デバイス管理: entrance locks, status and communication test (F-KEY-08). */
export default async function LockDevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; tested?: string }>
}) {
  const staff = await requireStaff('stores.manage')
  const storeId = await selectedStoreId(staff, 'stores.manage')
  const { saved, tested } = await searchParams
  const devices = await withContainer((c) =>
    c.listLockDevices(staff, storeId === null ? null : [storeId]),
  )
  const lowBattery = devices.filter(
    (d) => d.isActive && d.batteryPercent !== null && d.batteryPercent < LOW_BATTERY,
  )
  const offline = devices.filter((d) => d.isActive && d.communicationStatus === 'offline')
  const tz = 'Asia/Tokyo'

  return (
    <>
      <PageHeader
        title="鍵デバイス管理"
        description="店舗入口のスマートロックの一覧・状態確認と疎通テストを行います"
        actions={
          <>
            <ActionForm action={testLockDevicesAction}>
              {storeId !== null && <input type="hidden" name="storeId" value={storeId} />}
              <button type="submit" className={buttonClass.secondary}>
                全デバイス疎通テスト
              </button>
            </ActionForm>
            <Link href="/admin/lock-devices/new" className={buttonClass.primary}>
              ＋ デバイスを登録
            </Link>
          </>
        }
      />
      {saved && <Notice tone="green">鍵デバイスを保存しました</Notice>}
      {tested && <Notice tone="green">疎通テストを実行しました</Notice>}
      {(lowBattery.length > 0 || offline.length > 0) && (
        <div className="my-3">
          <Notice tone="red">
            電池残量 {LOW_BATTERY}% 未満のデバイスが {lowBattery.length} 台 / 通信不通{' '}
            {offline.length} 台 あります
          </Notice>
        </div>
      )}
      <div className="mt-3">
        <Table
          head={[
            'デバイス名',
            'プロバイダ',
            '外部ID',
            '店舗',
            '電池',
            '通信',
            '最終応答',
            '有効',
            '操作',
          ]}
          rows={devices.map((d) => [
            <TextLink key="name" href={`/admin/lock-devices/${d.id}`}>
              {d.name}
            </TextLink>,
            d.provider,
            <span key="ext" className="font-mono text-xs">
              {d.externalDeviceId}
            </span>,
            d.storeCode,
            d.batteryPercent === null ? '—' : `${d.batteryPercent}%`,
            <Badge
              key="comm"
              tone={
                d.communicationStatus === 'online'
                  ? 'green'
                  : d.communicationStatus === 'offline'
                    ? 'red'
                    : 'gray'
              }
            >
              {d.communicationStatus === 'online'
                ? '正常'
                : d.communicationStatus === 'offline'
                  ? '不通'
                  : '不明'}
            </Badge>,
            localDateTime(d.lastResponseAt, tz),
            d.isActive ? '有効' : '無効',
            <ActionForm key="test" action={testLockDevicesAction}>
              <input type="hidden" name="id" value={d.id} />
              <button type="submit" className={`${buttonClass.secondary} px-3 py-1`}>
                テスト
              </button>
            </ActionForm>,
          ])}
          empty="登録されている鍵デバイスはありません"
        />
      </div>
      <div className="mt-4 space-y-3">
        <Notice>
          鍵プロバイダは SmartRooming Connect API（NinjaLock
          M）を想定しています。入口ドアの電話パスコードを予約ごとに発行し、外部IDには
          API用エントランスドア識別キー（EntranceDoorApiKey）を登録します。API仕様上、電池残量は取得できないため「—」と表示します。
        </Notice>
        <Notice tone="green">
          【課題#10
          決定】鍵は店舗の入口にのみ設置します。部屋ごとの鍵は存在せず、入室コードは予約単位で入口錠に発行します（1店舗につき有効なデバイスは1台）。
        </Notice>
      </div>
    </>
  )
}

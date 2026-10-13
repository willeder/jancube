import { visibleStoreIds } from '@jancube/domain'
import { ActionForm } from '@/components/admin/ActionForm'
import { ROOM_STATUS_LABELS } from '@/components/admin/format'
import {
  Badge,
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
  TextLink,
} from '@/components/admin/ui'
import {
  createRoomAction,
  saveRoomGroupAction,
  saveRoomTypeAction,
} from '@/server/admin-master-actions'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { RoomFields } from './RoomFields'

export const dynamic = 'force-dynamic'

/** A-19 部屋マスタ: room types (all stores), room groups and rooms of one store. */
export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; group?: string; type?: string }>
}) {
  const staff = await requireStaff('stores.manage')
  const params = await searchParams
  const stores = await withContainer((c) => c.listStoreMasters(staff))
  const selected = await selectedStoreId(staff, 'stores.manage')
  const storeId = Number(params.store) || (selected && selected > 0 ? selected : stores[0]?.id)
  const store = stores.find((s) => s.id === storeId)
  if (!store) return <Notice>管理できる店舗がありません</Notice>
  const { roomTypes, groups, rooms } = await withContainer((c) => c.getRoomMaster(staff, store.id))
  const allStores = visibleStoreIds(staff.access, 'stores.manage') === null
  const editGroup = groups.find((g) => g.id === Number(params.group))
  const editType = roomTypes.find((t) => t.id === Number(params.type))
  const base = `/admin/rooms?store=${store.id}`

  return (
    <>
      <PageHeader
        title={`部屋マスタ — ${store.code} ${store.name}`}
        description="RoomType（全店共通）/ RoomGroup（予約・在庫の単位）/ Room を管理します"
        actions={
          <form method="get" className="flex gap-2">
            <select name="store" defaultValue={store.id} className={inputClass} aria-label="店舗">
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.name}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClass.secondary}>
              切替
            </button>
          </form>
        }
      />

      <Card title="部屋">
        <Table
          head={[
            'Room No.',
            'RoomType',
            'RoomGroup',
            '料金プロファイル',
            '写真',
            '紹介文',
            '稼働状態',
            '清掃',
            '指名',
            'VIP候補',
            '',
          ]}
          rows={rooms.map((r) => [
            r.code,
            r.roomTypeName,
            r.groupName,
            r.priceProfileName ?? <span className="text-alert">未設定</span>,
            `${r.photoCount}枚`,
            <span key="d" className="line-clamp-1 max-w-48">
              {r.description ?? '—'}
            </span>,
            <Badge
              key="s"
              tone={
                r.operatingStatus === 'active'
                  ? 'green'
                  : r.operatingStatus === 'broken'
                    ? 'red'
                    : 'gray'
              }
            >
              {ROOM_STATUS_LABELS[r.operatingStatus]}
            </Badge>,
            r.cleaningStatus === 'clean' ? '清掃済' : '要清掃',
            r.isNamedBooking ? '○' : '—',
            r.isVipCandidate ? '○' : '—',
            <TextLink key="e" href={`/admin/rooms/${r.id}`}>
              編集
            </TextLink>,
          ])}
          empty="部屋はまだありません"
        />
        <p className="mt-2 text-xs text-sub">
          【課題#34】料金プロファイルは部屋単位で設定（A-16
          の各パターン画面で割当）。清掃状態は清掃画面で更新します。
        </p>
      </Card>

      {groups.length > 0 && (
        <Card title="部屋を追加" className="mt-4">
          <ActionForm action={createRoomAction} submitLabel="部屋を追加">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="RoomGroup（RoomTypeはグループに従う・作成後は変更不可）">
                <select name="groupId" className={inputClass}>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}（{g.roomTypeName}）
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Room No.">
                <input
                  name="code"
                  required
                  maxLength={32}
                  placeholder="Room13"
                  className={inputClass}
                />
              </Field>
            </div>
            <RoomFields d={{ sortOrder: rooms.length + 1 }} />
          </ActionForm>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="RoomGroup（予約・在庫の単位）">
          <Table
            head={['コード', '名前', 'RoomType', '選択方式', '表示順', '部屋数', '状態', '']}
            rows={groups.map((g) => [
              g.code,
              g.name,
              g.roomTypeName,
              g.bookingMode === 'named' ? '部屋指名' : 'グループ',
              g.sortOrder,
              g.roomCount,
              g.isActive ? '有効' : '無効',
              <TextLink key="e" href={`${base}&group=${g.id}`}>
                編集
              </TextLink>,
            ])}
          />
          <h3 className="mb-2 mt-4 font-bold">
            {editGroup ? `グループを編集 — ${editGroup.code}` : 'グループを追加'}
          </h3>
          <ActionForm action={saveRoomGroupAction} submitLabel="保存する">
            <input type="hidden" name="storeId" value={store.id} />
            <input type="hidden" name="id" value={editGroup?.id ?? ''} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="コード">
                <input
                  name="code"
                  required={!editGroup}
                  disabled={!!editGroup}
                  defaultValue={editGroup?.code}
                  className={inputClass}
                />
              </Field>
              <Field label="名前">
                <input name="name" required defaultValue={editGroup?.name} className={inputClass} />
              </Field>
              <Field label="RoomType">
                <select
                  name="roomTypeId"
                  disabled={!!editGroup}
                  defaultValue={editGroup?.roomTypeId}
                  className={inputClass}
                >
                  {roomTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="選択方式">
                <select
                  name="bookingMode"
                  defaultValue={editGroup?.bookingMode ?? 'group'}
                  className={inputClass}
                >
                  <option value="group">グループ（空いている部屋を割当）</option>
                  <option value="named">部屋指名</option>
                </select>
              </Field>
              <Field label="表示順">
                <input
                  name="sortOrder"
                  inputMode="numeric"
                  defaultValue={editGroup?.sortOrder ?? groups.length + 1}
                  className={inputClass}
                />
              </Field>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={editGroup?.isActive ?? true} />
              有効
            </label>
          </ActionForm>
          {editGroup && (
            <p className="mt-2 text-xs">
              <TextLink href={base}>編集をやめて新規追加に戻る</TextLink>
            </p>
          )}
        </Card>

        <Card title="RoomType（全店共通）">
          <Table
            head={['コード', '名前', '定員', '状態', '']}
            rows={roomTypes.map((t) => [
              t.code,
              t.name,
              `${t.capacity}名`,
              t.isActive ? '有効' : '無効',
              allStores ? (
                <TextLink key="e" href={`${base}&type=${t.id}`}>
                  編集
                </TextLink>
              ) : (
                ''
              ),
            ])}
          />
          {allStores ? (
            <>
              <h3 className="mb-2 mt-4 font-bold">
                {editType ? `RoomTypeを編集 — ${editType.code}` : 'RoomTypeを追加'}
              </h3>
              <ActionForm action={saveRoomTypeAction} submitLabel="保存する">
                <input type="hidden" name="id" value={editType?.id ?? ''} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="コード">
                    <input
                      name="code"
                      required={!editType}
                      disabled={!!editType}
                      defaultValue={editType?.code}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="名前">
                    <input
                      name="name"
                      required
                      defaultValue={editType?.name}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="定員">
                    <input
                      name="capacity"
                      inputMode="numeric"
                      required
                      defaultValue={editType?.capacity ?? 4}
                      className={inputClass}
                    />
                  </Field>
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={editType?.isActive ?? true}
                  />
                  有効
                </label>
              </ActionForm>
            </>
          ) : (
            <p className="mt-2 text-xs text-sub">RoomType の変更は全店舗の管理権限が必要です。</p>
          )}
        </Card>
      </div>
      <p className="mt-4 rounded-lg bg-alert-pale p-3 text-xs text-alert">
        【要確認 CQ-84 / CQ-85】部屋写真 / 扉の表記 /
        フロア位置の一文を登録します。写真はアップロード機能（R2）実装までは画像URLで登録します。
      </p>
    </>
  )
}

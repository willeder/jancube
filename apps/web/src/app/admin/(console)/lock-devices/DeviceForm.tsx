import type { LockDevice } from '@jancube/application'
import Link from 'next/link'
import { buttonClass, Field, inputClass } from '@/components/admin/ui'
import { ActionForm } from '@/components/operations/ActionForm'
import { saveLockDeviceAction } from '@/server/operations-actions'

/** A-20 registration / edit form. The API token itself is never entered here (secret store only). */
export function DeviceForm({
  device,
  stores,
}: {
  device: LockDevice | null
  stores: readonly { id: number; code: string; name: string }[]
}) {
  return (
    <ActionForm action={saveLockDeviceAction} className="max-w-xl space-y-3">
      {device && <input type="hidden" name="id" value={device.id} />}
      <Field label="店舗">
        <select
          name="storeId"
          defaultValue={device?.storeId ?? stores[0]?.id}
          className={inputClass}
          required
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="デバイス名" hint="半角英数字（例: ENTRANCE-JC001）">
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={device?.name}
          className={inputClass}
        />
      </Field>
      <Field label="プロバイダ">
        <select
          name="provider"
          defaultValue={device?.provider ?? 'smartrooming'}
          className={inputClass}
        >
          <option value="smartrooming">
            smartrooming（NinjaLock M / SmartRooming Connect API）
          </option>
        </select>
      </Field>
      <Field label="事業者アカウント" hint="SmartRooming の管理会社アカウント識別子">
        <input
          name="providerAccountId"
          required
          maxLength={100}
          defaultValue={device?.providerAccountId}
          className={inputClass}
        />
      </Field>
      <Field label="外部ID（EntranceDoorApiKey）">
        <input
          name="externalDeviceId"
          required
          maxLength={191}
          defaultValue={device?.externalDeviceId}
          className={inputClass}
        />
      </Field>
      <Field
        label="認証情報の保管先"
        hint="APIトークンは入力せず、保管先の名前のみ記録します（例: SMARTROOMING_API_TOKEN）"
      >
        <input
          name="secretReference"
          maxLength={500}
          defaultValue={device?.secretReference ?? 'SMARTROOMING_API_TOKEN'}
          className={inputClass}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={device?.isActive ?? true}
          className="size-4 accent-brand"
        />
        有効（入室コードの発行に使用する）
      </label>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass.primary}>
          保存する
        </button>
        <Link href="/admin/lock-devices" className={buttonClass.secondary}>
          キャンセル
        </Link>
      </div>
    </ActionForm>
  )
}

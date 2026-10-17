'use client'

import { selectStoreAction } from '@/server/admin-auth-actions'

/** Auto-submit the existing server action; store permissions are still checked on the server. */
export function StoreSwitcher({
  choices,
  selected,
  allStores,
}: {
  choices: readonly { id: number; code: string; name: string }[]
  selected: number | null
  allStores: boolean
}) {
  return (
    <form action={selectStoreAction} className="admin-store-switcher">
      <input type="hidden" name="back" value="/admin" />
      <select
        name="store"
        defaultValue={selected === null ? 'all' : String(selected)}
        aria-label="店舗"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {allStores && <option value="all">全店舗</option>}
        {choices.map((store) => (
          <option key={store.id} value={store.id}>
            {store.code} {store.name}
          </option>
        ))}
      </select>
      <button type="submit" className="sr-only focus:not-sr-only">
        店舗を切り替える
      </button>
    </form>
  )
}

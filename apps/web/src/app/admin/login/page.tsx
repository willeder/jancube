import { redirect } from 'next/navigation'
import { Notice } from '@/components/admin/ui'
import { currentStaff } from '@/server/admin-session'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

/** A-01 管理画面ログイン */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string }>
}) {
  if (await currentStaff()) redirect('/admin')
  const { password } = await searchParams
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-white p-6">
        <div className="text-center">
          <h1 className="font-bold text-brand-dark">🀄 雀CUBE 予約システム 管理画面</h1>
          <p className="mt-1 text-xs text-sub">運営スタッフ専用</p>
        </div>
        {password === 'updated' && (
          <Notice tone="green">パスワードを設定しました。ログインしてください</Notice>
        )}
        <LoginForm />
      </div>
    </main>
  )
}

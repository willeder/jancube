import { ResetRequestForm } from './PasswordForms'

/** A-30 パスワード再設定（メール送信） */
export default function PasswordResetRequestPage() {
  return (
    <main className="admin-auth-page flex min-h-screen items-center justify-center px-4 py-6">
      <div className="w-full max-w-[420px] space-y-3 rounded-[14px] border border-line bg-white p-3.5">
        <h1 className="font-bold">パスワード再設定</h1>
        <p className="text-sm text-sub">
          登録済みのメールアドレスに、再設定用のリンク（60分有効）をお送りします
        </p>
        <ResetRequestForm />
      </div>
    </main>
  )
}

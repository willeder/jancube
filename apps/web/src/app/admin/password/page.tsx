import { ResetRequestForm } from './PasswordForms'

/** A-30 パスワード再設定（メール送信） */
export default function PasswordResetRequestPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-white p-6">
        <h1 className="font-bold">パスワード再設定</h1>
        <p className="text-sm text-sub">
          登録済みのメールアドレスに、再設定用のリンク（60分有効）をお送りします
        </p>
        <ResetRequestForm />
      </div>
    </main>
  )
}

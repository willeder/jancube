const STEPS = [
  '携帯電話番号を入力',
  'SMSの認証コードを入力',
  'お名前のご登録（新規の方のみ）',
  'LINEアカウントと紐づけ完了',
] as const

/** L-03 step list (Figma 152:91); the current step is highlighted (5 = all done). */
export function LinkSteps({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <ol className="divide-y divide-line rounded-xl border border-line bg-white px-4 text-sm">
      {STEPS.map((label, i) => {
        const step = i + 1
        const state = step < current ? 'done' : step === current ? 'current' : 'todo'
        return (
          <li key={label} className="flex items-center gap-3 py-2.5">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                state === 'todo' ? 'bg-paper text-sub' : 'bg-brand text-white'
              }`}
            >
              {state === 'done' ? '✓' : step}
            </span>
            <span className={state === 'current' ? 'font-bold' : 'text-sub'}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

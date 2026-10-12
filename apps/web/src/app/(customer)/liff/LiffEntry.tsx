'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import { liffSignInAction } from '@/server/line-actions'

/** Official LIFF SDK v2 (https://developers.line.biz/en/docs/liff/). */
const LIFF_SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js'

interface Liff {
  init(config: { liffId: string }): Promise<void>
  isLoggedIn(): boolean
  login(config?: { redirectUri?: string }): void
  getIDToken(): string | null
  getAccessToken(): string | null
}

declare global {
  interface Window {
    liff?: Liff
  }
}

function loadLiff(): Promise<Liff> {
  if (window.liff) return Promise.resolve(window.liff)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = LIFF_SDK
    script.async = true
    script.onload = () =>
      window.liff ? resolve(window.liff) : reject(new Error('LIFF SDK is not available'))
    script.onerror = () => reject(new Error('LIFF SDK could not be loaded'))
    document.head.appendChild(script)
  })
}

/** `next` arrives in the query after LIFF's own redirect (liff.state), so it is read after init. */
const currentNext = () => new URLSearchParams(window.location.search).get('next')

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'dev' }

/** L-02: LIFF init → ID token → server verification → booking flow or L-03 linking. */
export function LiffEntry({ liffId, devStandIn }: { liffId: string | null; devStandIn: boolean }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    if (devStandIn) {
      setState({ kind: 'dev' })
      return
    }
    if (!liffId) {
      setState({ kind: 'error', message: 'ただいまLINEからのご予約を準備中です' })
      return
    }
    let cancelled = false
    ;(async () => {
      const liff = await loadLiff()
      await liff.init({ liffId })
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href })
        return
      }
      const idToken = liff.getIDToken()
      if (!idToken) throw new Error('no ID token (the LIFF app needs the openid scope)')
      const result = await liffSignInAction({
        idToken,
        accessToken: liff.getAccessToken(),
        next: currentNext(),
      })
      if (cancelled) return
      if (result.ok) window.location.replace(result.redirect)
      else setState({ kind: 'error', message: result.error })
    })().catch((error: unknown) => {
      console.error(error)
      if (!cancelled) {
        setState({
          kind: 'error',
          message: 'LINEとの接続に失敗しました。LINEアプリからもう一度開いてください',
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [liffId, devStandIn])

  if (state.kind === 'dev') return <DevSignIn />
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h1 className="text-lg font-bold">LINEで予約</h1>
        <p className="mt-1 text-sm text-sub">
          {state.kind === 'loading'
            ? 'LINEアカウントを確認しています…'
            : 'LINEアカウントを確認できませんでした'}
        </p>
      </div>
      {state.kind === 'loading' && (
        <div
          aria-hidden
          className="mx-auto size-8 animate-spin rounded-full border-4 border-brand-pale border-t-brand"
        />
      )}
      {state.kind === 'error' && (
        <>
          <FormError message={state.message} />
          <Link
            href="/"
            className="block rounded-xl border border-brand bg-white py-3 text-center font-bold text-brand"
          >
            Webサイトで予約する
          </Link>
        </>
      )}
    </div>
  )
}

const randomLineUserId = () =>
  `U${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')}`

/** Development only (no LINE channel): pretend to be a LINE user. */
function DevSignIn() {
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => setUserId(randomLineUserId()), [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    const result = await liffSignInAction({
      idToken: `dev:${userId}`,
      accessToken: null,
      next: currentNext(),
    })
    setPending(false)
    if (result.ok) window.location.assign(result.redirect)
    else setError(result.error)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <h1 className="text-lg font-bold">LINEで予約（開発用）</h1>
        <p className="mt-1 text-sm text-sub">
          LINEチャネル未設定のため、LINEユーザーIDを入力してLIFFからの起動を再現します
        </p>
      </div>
      <label className="block rounded-xl border border-line bg-white p-4 text-sm">
        <span className="font-bold">LINEユーザーID</span>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value.trim())}
          pattern="U[0-9a-f]{32}"
          required
          className="mt-2 block w-full rounded-lg border border-line px-3 py-2.5 font-mono text-sm"
        />
        <span className="mt-2 block text-xs text-sub">
          同じIDを使うと「連携済み」のお客様として動作します
        </span>
      </label>
      <FormError message={error} />
      <SubmitButton pending={pending}>LINEでログイン</SubmitButton>
    </form>
  )
}

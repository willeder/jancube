# LINE 公式アカウント・LIFF 設定手順 (F-LINE-01〜05, L-01〜L-04)

LINE 側の設定と、本システムに設定する環境変数をまとめます。チャネルが未作成でも開発環境は
スタンドイン（後述）で動作し、本番は環境変数を設定した時点で有効になります。

## 1. 全体像

| 役割 | LINE のチャネル | 本システム側 |
|---|---|---|
| L-01 リッチメニュー / L-04 通知 / Webhook | Messaging API チャネル（公式アカウント） | `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `/api/line/webhook` |
| L-02 LIFF エントリ / ID トークン検証 | LINE ログインチャネル（LIFF アプリ） | `LINE_LOGIN_CHANNEL_ID`, `LIFF_ID`, `/liff` |

**2 つのチャネルは必ず同じプロバイダーに作成してください。** LINE のユーザー ID はプロバイダー単位で
同じ値になるため、LIFF で連携したユーザーと Webhook・プッシュ通知の宛先が一致します
（`member_line_links.provider_id` には LINE ログインチャネル ID を保存します）。

## 2. LINE Developers での作業

1. プロバイダー「雀CUBE」（名称は任意）を作成。
2. **Messaging API チャネル**を作成（LINE 公式アカウントと紐づく）。
   - チャネル基本設定 → **チャネルシークレット** → `LINE_CHANNEL_SECRET`
   - Messaging API 設定 → **チャネルアクセストークン（長期）** を発行 → `LINE_CHANNEL_ACCESS_TOKEN`
   - Messaging API 設定 → Webhook URL: `https://<本番ドメイン>/api/line/webhook`
     - 「Webhook の利用」ON、「検証」で 200 が返ることを確認
     - 「Webhook の再送」ON（処理失敗時に LINE が再送。重複は `webhook_events` で除外）
   - LINE Official Account Manager → 応答設定: 「Webhook」ON、「応答メッセージ」OFF
     （定型案内は本システムが返信します）。スタッフがトークで個別対応する場合は「チャット」ON（課題 #15）。
   - あいさつメッセージは Official Account Manager で設定（Figma L-01 の文面）。
3. **LINE ログインチャネル**を作成（同じプロバイダー）。
   - チャネル ID → `LINE_LOGIN_CHANNEL_ID`
   - 「リンクされた LINE 公式アカウント」に手順 2 の公式アカウントを設定
     （友だち追加オプション。友だち状態の取得と LIFF からの友だち追加に必要）
   - LIFF タブ → LIFF アプリを追加
     - サイズ: Full
     - エンドポイント URL: `https://<本番ドメイン>/liff`
     - Scope: `openid`（必須・ID トークン取得）, `profile`（友だち状態の取得）
     - 友だち追加オプション: On (Aggressive) を推奨
     - 発行された **LIFF ID** → `LIFF_ID`
4. チャネルを「公開」に切り替える（開発中は「開発中」のままテスターのみ利用可）。

## 3. 環境変数

web（`apps/web`）: `wrangler secret put <NAME>`（ローカルは `apps/web/.dev.vars`）

| 変数 | 内容 | 未設定時 |
|---|---|---|
| `LINE_LOGIN_CHANNEL_ID` | LINE ログインチャネル ID（ID トークンの aud 検証・provider_id） | 開発: スタンドイン / 本番: `/liff` が「準備中」 |
| `LIFF_ID` | LIFF アプリ ID（公開値。`/liff` ページで使用） | 同上 |
| `LINE_CHANNEL_SECRET` | Messaging API チャネルシークレット（Webhook 署名検証） | 開発: 固定の開発用値 / 本番: Webhook が 503 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API アクセストークン（Webhook の定型返信） | 開発: コンソール出力 / 本番: 返信不可（記録のみ） |

jobs（`apps/jobs`）: `LINE_CHANNEL_ACCESS_TOKEN`（L-04 通知のプッシュ送信。`wrangler secret put` で設定）。
未設定の場合、開発ではコンソール出力、本番では LINE 通知が失敗としてリトライ → アラートになります。

## 4. 動作の流れ

- **L-01 リッチメニュー**: `pnpm line:rich-menu --image <2500x843.png> --replace`
  （定義: `scripts/line-rich-menu.json`。予約する → `https://liff.line.me/<LIFF_ID>`、
  予約確認 → `https://liff.line.me/<LIFF_ID>?next=%2Fmypage`、お問い合わせ → メッセージ送信）。
  `--dry-run` で作成内容だけ確認できます。メニュー画像はデザイン素材が必要です（3 等分）。
- **L-02 `/liff`**: LIFF SDK（`https://static.line-scdn.net/liff/edge/2/sdk.js`）で初期化 →
  ID トークンをサーバーへ送信 → `https://api.line.me/oauth2/v2.1/verify` で検証
  （aud = `LINE_LOGIN_CHANNEL_ID`、iss、期限も再確認）。
  - 連携済み → 会員セッションを開始し、`next`（既定 `/` = C-01 店舗選択）へ。
  - 未連携 → 署名付き Cookie（40 分）に LINE ユーザー ID を保持して `/liff/link`（L-03）へ。
  - アクセストークンがあれば友だち状態を取得（`friendship/v1/status`）。友だちでない場合は
    `friend_status = blocked`（LINE 通知は送らず、メール等にもフォールバックしない＝トラッカー決定）。
- **L-03 `/liff/link`**: SMS 認証（C-05/C-06 と同じユースケース・同じ回数制限）→
  既存会員はそのまま連携、新規は C-07 と同じ登録（`registration_source = 'line'`, 同意チャネル `liff`）→ 連携。
  Web でログイン中の会員は SMS なしで「この会員情報と連携する」を選べます（C-17 からの連携）。
  連携・解除は監査ログ（`member.line_link` / `member.line_unlink`、LINE ユーザー ID は記録しない）に残ります。
- **C-17 解除**: サーバーアクション `unlinkLineAction`（`apps/web/src/server/line-actions.ts`）。
  C-17 の「LINE と連携する」ボタンは `/liff/link` にリンクしてください
  （未認証の場合は LINE ログインを経由して戻ります）。
- **予約の作成経路**: `/liff` を通ると Cookie `jc_channel=liff`（12 時間）が付きます。予約フローは
  `readBookingAttribution()`（`apps/web/src/server/booking-attribution.ts`）を `createHold` に渡すと
  `bookings.source = 'liff'`, `acquisition_source = 'line'` で保存されます:
  ```ts
  c.createHold({ ...input, ...(await readBookingAttribution()) })
  ```
  ※ `createHoldAction`（booking-actions.ts）への 1 行の組み込みは予約フロー担当側で行ってください。
- **Webhook `/api/line/webhook`**: `x-line-signature`（チャネルシークレットによる HMAC-SHA256・Base64）を
  生ボディで検証 → イベントごとに `webhook_events`（provider `line`、`webhookEventId` で重複排除）→
  follow = `friend` / unfollow = `blocked`（古いイベントで新しい状態を上書きしない）→
  メッセージには定型案内を返信（自然文での予約・L-05 チャット内予約は対象外）。
- **L-04 通知**: 通知エンジン（`makeNotify`）が「LINE 連携済み・ブロックなし」なら LINE を選び、jobs Worker が
  `LineMessagingSender` でプッシュ送信します。文面は A-21 通知テンプレートで管理します。

## 5. 開発環境（チャネル未作成）

- `APP_ENV=development` かつ `LINE_LOGIN_CHANNEL_ID` 未設定のとき、`/liff` は開発用フォームを表示し、
  任意の LINE ユーザー ID（`U` + 32 桁の 16 進）でログインを再現します（ID トークンの代わりに `dev:<ID>` を検証）。
- Webhook は開発用シークレット `dev-only-line-channel-secret` で署名したリクエストを受け付けます。
  ```bash
  BODY='{"destination":"Udev","events":[]}'
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac dev-only-line-channel-secret -binary | base64)
  curl -X POST http://localhost:3000/api/line/webhook -H "x-line-signature: $SIG" -d "$BODY"
  ```
- 返信・プッシュはサーバーのコンソールに出力されます。

## 6. 未決事項

- 課題 #12/#13（L-05 チャット内の選択式予約、電話番号なしの LINE 単独会員 `identity_kind = 'line'`）は
  方針のみで詳細未決のため未実装。現状の LINE 連携は SMS 認証で既存/新規の電話番号会員に紐づけます。
- FR-3.5 / CQ-26: LIFF 内から外部決済（Stripe Checkout）への遷移方式は未決。
- CQ-56: 公式アカウントのプラン・配信数（プッシュ通知の費用）。
- `coupon_versions.grant_trigger = 'line_friend'`（友だち追加クーポン）は未実装。

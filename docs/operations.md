# 運用手順（デプロイ・監視・バックアップ・ログ）

本番構成: Cloudflare Workers（web = Next.js/OpenNext、jobs = Cron Worker）→ Hyperdrive → TiDB Cloud Starter（東京）。
メール Resend、SMS SMSLINK、決済 Stripe、LINE Messaging API / LIFF。

## 1. 初回セットアップ

1. **TiDB Cloud**: Starter クラスタ（AWS Tokyo）を作成し、DB `jancube` を作成。
   - `SET GLOBAL tidb_enable_check_constraint = ON;`（OFF だと CHECK 制約が無視される。`db/migrate.ts` が検査します）
   - アプリ用ユーザーを作成（DDL 権限なし）。マイグレーション用ユーザーは別にする。
   - 接続: Hyperdrive は TiDB の公開エンドポイントに TLS で接続します。Cloudflare の送信元 IP は固定でないため、
     IP 制限ではなく強いパスワード + TLS 必須で保護します（Starter では Private Endpoint を使えない点に注意）。
2. **マイグレーション**（リポジトリのルートで、本番 DB の URL を指定）:
   ```bash
   DATABASE_URL='mysql://<migrator>:<password>@<host>:4000/jancube?ssl={"rejectUnauthorized":true}' pnpm db:migrate
   ```
   `db/migrations/*.sql` をファイル名順に一度だけ適用し `schema_migrations` に記録します（`--reset` はローカル専用）。
3. **Hyperdrive**:
   ```bash
   npx wrangler hyperdrive create jancube-tidb --connection-string='mysql://<app-user>:<password>@<host>:4000/jancube'
   ```
   出力された id を `apps/web/wrangler.jsonc` と `apps/jobs/wrangler.jsonc` の `hyperdrive[0].id` に設定。
4. **Workers の変数・シークレット**（下表）。`vars` は wrangler.jsonc（本番は `APP_ENV` を `production` に）、
   秘密情報は `npx wrangler secret put <NAME>`（`apps/web` / `apps/jobs` それぞれのディレクトリで実行）。
5. Stripe の Webhook エンドポイント `https://<ドメイン>/api/webhooks/stripe`、LINE の Webhook
   `https://<ドメイン>/api/line/webhook`（docs/line-setup.md）を登録。
6. カスタムドメインを web Worker に割り当て、`APP_URL` をそのドメインにする。

### 変数・シークレット一覧

| 名前 | web | jobs | 種別 | 内容 |
|---|:-:|:-:|---|---|
| `APP_ENV` | ✓ | ✓ | var | `production`（`development` の時だけ開発用の代替値・スタンドインが有効） |
| `APP_URL` | ✓ | ✓ | var | 公開 URL（メール・SMS・埋め込みコードのリンク） |
| `EMAIL_FROM` | ✓ | ✓ | var | 送信元（Resend で認証済みドメイン） |
| `AUTH_PEPPER` | ✓ | | secret | SMS コード・トークンのハッシュ用（16 文字以上） |
| `SESSION_SECRET` | ✓ | | secret | 会員・スタッフセッション Cookie の署名（32 文字以上） |
| `DATA_ENCRYPTION_KEY` | ✓ | ✓ | secret | 32 バイト base64。入室コード・通知宛先の暗号化。**web と jobs で同じ値**。紛失すると復号不可 |
| `RESEND_API_KEY` | ✓ | ✓ | secret | メール送信 |
| `SMSLINK_API_TOKEN` / `SMSLINK_ENDPOINT` | ✓ | ✓ | secret | SMS 送信 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_ACCOUNT_ID` | ✓ | | secret | 決済（本番は live キー） |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✓ | ✓ | secret | Messaging API（web: Webhook 返信、jobs: L-04 プッシュ通知） |
| `LINE_CHANNEL_SECRET` | ✓ | | secret | Webhook 署名検証 |
| `LINE_LOGIN_CHANNEL_ID` | ✓ | | var/secret | LIFF の ID トークン検証 |
| `LIFF_ID` | ✓ | | var | LIFF アプリ ID（公開値） |

本番で必須の秘密情報（`AUTH_PEPPER` 等）が無い場合はリクエスト時にエラーになります（黙って代替値を使うことはありません）。
LINE の値が無い場合は LINE 機能だけが「準備中」になり、他の機能は動作します。
他機能（スマートロック等）の追加分は各機能の README を参照し、この表に追記してください。

## 2. デプロイ

- CI（`.github/workflows/ci.yml`）: lint → typecheck → 依存境界 → テスト → OpenNext ビルド。
- OpenNext のビルドは Windows ネイティブでは動かないため、**Linux（CI / WSL / `pnpm preview:linux`）でビルド**します。
- 手順（main マージ後）:
  ```bash
  pnpm install --frozen-lockfile
  pnpm db:migrate                         # 本番 DATABASE_URL で（新しいマイグレーションがある場合のみ）
  pnpm --filter @jancube/web deploy       # opennextjs-cloudflare build && deploy
  pnpm --filter @jancube/jobs deploy      # wrangler deploy（Cron トリガーも更新）
  ```
- マイグレーションは**追加のみ**（列・テーブル追加）にし、古いコードでも動く順序で適用 → デプロイします。
- ロールバック: `npx wrangler rollback`（各 Worker ディレクトリで。直前のバージョンに戻す）。DB は戻さない前提。

## 3. 監視

- **Workers Observability**: 両 Worker で `observability.enabled = true`。Cloudflare ダッシュボード →
  Workers → 対象 Worker → Logs / Metrics で `console.*` の出力・例外・CPU 時間・リクエスト数を確認。
  リアルタイム確認は `npx wrangler tail`（web / jobs）。
- **アプリ内アラート（A-25）**: 通知の最終失敗、決済・鍵の異常などは `alerts` に記録され、管理画面に表示されます。
- 推奨アラート設定（Cloudflare Notifications / 外部監視）:

| 監視対象 | 条件 | 通知先 | 初動 |
|---|---|---|---|
| web 5xx 率 | 5 分間で 2% 超 | 開発・運用 | `wrangler tail` で例外確認、直前デプロイなら rollback |
| jobs Cron 失敗 | 毎分ジョブが 5 分連続失敗 / 前日バッチ（20:00 JST）失敗 | 開発・運用 | ログ確認、`batch_runs` の状態確認、必要なら手動再実行 |
| 外形監視 | `https://<ドメイン>/` が 3 回連続失敗 | 開発・運用 | Cloudflare / TiDB のステータス確認 |
| Hyperdrive / DB 接続 | 接続エラーのログ増加 | 開発 | TiDB Cloud コンソール（RU 上限・メンテナンス）確認 |
| TiDB Request Units | 月間上限の 80% | 開発・オーナー | 利用状況の確認、上限・プラン見直し |
| Stripe Webhook | Stripe ダッシュボードで失敗が継続 | 開発 | 署名シークレット・URL を確認 |
| LINE Webhook | LINE Developers の Webhook エラー統計 | 開発 | `LINE_CHANNEL_SECRET` と URL を確認 |
| A-25 未対応アラート | critical が 30 分未対応 | 店舗・本部 | 管理画面の復旧手順に従う |

## 4. バックアップ

- **TiDB Cloud Starter の自動バックアップ**（日次・保持期間はプランに依存）を有効のまま運用。
  リストアはコンソールから新しいクラスタ/時点へ復元 → Hyperdrive の接続先を切り替え。
- 重要な変更（マイグレーション・データ移行）の前には手動バックアップ、またはエクスポート
  （`mysqldump` 互換の Dumpling / TiDB Cloud Export）を取得。
- `DATA_ENCRYPTION_KEY` はパスワード管理ツール等に別保管（DB バックアップだけでは暗号化データを復号できません）。
- 復元手順は本番前に一度、検証用クラスタでリハーサルすること。

## 5. ログと保持期間（Q-06 未決）

| データ | 場所 | 現状の保持 | 備考 |
|---|---|---|---|
| Workers のログ | Cloudflare Observability | プランの既定（数日〜） | 長期保存が必要なら Logpush（有料）で R2 等へ |
| 監査ログ `audit_logs` | DB | 無期限（削除処理なし） | 保持期間が決まったら jobs に期限切れ削除を追加 |
| 外部イベント `webhook_events` | DB | 無期限 | 本文は保存せずハッシュと必要項目のみ |
| CSV 出力履歴 `report_exports` | DB | 無期限 | ファイル自体は保存しない |
| ファネル `funnel_events` | DB | 無期限 | 匿名キーのみ。13 か月程度での削除を推奨 |
| 通知 `notification_deliveries/attempts` | DB | 無期限 | 宛先・本文は暗号化 |

F-OPS-09（保持期間・粒度の設定）は Q-06 の回答待ちです。決定後、jobs Worker の日次バッチに
「期限切れ行の削除」を追加し、この表を更新してください。

## 6. レポート・CSV・監査ログ・計測（A-24, A-27, F-RPT-01〜07, F-PAY-09, F-CPN-10）

### 共通ルール

- 権限: A-27 は `reports.export`、A-24 と監査ログ CSV は `audit.view`（現状オーナー・本部管理者）。
  店舗限定の権限では、その店舗のデータだけが対象です（F-ADM-02）。全店舗の出力は全店舗権限が必要です。
- 期間: 開始日〜終了日（両端を含む・最長 1 年）。日付は日本時間。
  予約データ・稼働率・流入元は**利用日（営業日）**、売上・クーポン・清掃は**発生日時**、ファネルは仮押さえ作成日時。
- CSV: UTF-8（BOM 付き）・CRLF・ヘッダー行あり。Excel でそのまま開けます。
  `= + - @` で始まる文字列は先頭に `'` を付けます（CSV インジェクション対策）。数値はそのまま。
- 500 行ずつ読みながらストリーミングで返すため、長い期間でもメモリに全件を載せません。
- 出力のたびに `report_exports`（出力者・種別・期間・条件・件数・状態）と監査ログ `report.export` を記録します。
  ファイルは保存しません（`file_object_key` は空）。集計定義版 `v1`。
- URL: `GET /admin/reports/export?type=<種別>&from=YYYY-MM-DD&to=YYYY-MM-DD[&store=<店舗ID>]`
  （監査ログは `&actor=&action=&target=` も可）。開始前のエラー（権限・期間）は元の画面に `?error=` で戻ります。

### CSV の列（v1・Q-05 で確定するまで暫定）

| 種別 (`type`) | 1 行 | 列 |
|---|---|---|
| 予約データ `bookings` | 予約 1 件（確定・利用済・確定後キャンセル） | 予約番号, 店舗コード, 店舗名, 利用日, 開始, 終了, 利用時間(分), 部屋タイプ, 部屋（割当済または指名）, 会員番号, 状態, 予約経路, 流入元, utm_source/medium/campaign/content, 人数, 小計(税込), クーポン値引, 予約金額(税込), クーポンコード, 決済額, 返金額, キャンセル料, 予約確定日時, キャンセル日時, 作成日時 |
| 売上データ `sales` | 成功した決済・返金 1 件（決済→返金の順） | 計上日時, 区分(決済/返金), 店舗コード, 店舗名, 予約番号, 利用日, 決済方法, 決済代行, 金額(税込・返金はマイナス), 税率(%), うち消費税, 外部取引ID, 返金理由 |
| 稼働率 `occupancy` | 店舗×日×部屋タイプ | 日付, 店舗, 部屋タイプ, 部屋数, 営業時間(分), 提供室時間(分), 予約室時間(分), 空き室時間(分), 稼働率(%), 予約件数 |
| 流入元 `acquisition` | 経路×流入元×UTM | 予約経路, 流入元, utm_source/medium/campaign, 予約数, 売上(税込), 初回予約数, 初回率(%), 2回目予約数, 2回目転換率(%) |
| クーポン効果 `coupon_effect` | クーポン | コード, 名称, 配布数(期間内), うち利用済, 利用率(%), 利用件数(期間内), 割引総額, 利用予約の売上, 再予約数, 再予約率(%) |
| クーポン利用明細 `coupon_redemptions` | 適用 1 件（取消も含む） | 適用日時, コード, 名称, 予約番号, 店舗, 利用日, 会員番号, 利用回, 割引額, 予約金額, 状態(利用/取消) |
| 清掃実績 `cleaning` | 清掃完了 1 件 | 完了日時, 店舗, 部屋, 種別(開店前/スポット), 担当者, 開始日時, 所要時間(分), 期限, 期限超過, メモ |
| 予約ファネル `funnel` | 店舗 | 店舗選択・空き状況表示（訪問者数）, 仮押さえ, ログイン済み, 決済開始, 予約確定, 確定率(%) |
| 監査ログ `audit_logs` | 操作 1 件 | 日時, 操作者種別, 操作者, ロール, 店舗, 操作, 対象種別, 対象ID, 対象コード, 変更前, 変更後(JSON), 理由, IP, 追跡ID |

### 定義・前提（クライアント確認事項）

- **消費税額**は税込金額から `floor(金額 × 税率 / (100 + 税率))` で逆算（1 件ごと切り捨て）。税率は決済対象の
  料金計算スナップショット（`price_calculations.tax_rate`）。端数処理を会計・インボイスと合わせる必要があれば Q-05 で確認。
- **稼働率** = 予約室時間 ÷（営業時間 × 稼働中の部屋数）。部屋数は**現在の部屋マスタ**で数え、清掃バッファは提供時間に含みます。
  部屋の割当は前日確定のため**部屋タイプ別**に集計（Figma A-27 は「部屋×日」。部屋別が必要なら割当確定済みの過去日で出力可能）。
  時間帯別（F-RPT-02）は未対応。
- **初回**: その会員の最初の確定予約。**2 回目転換**: 初回予約の会員がその後に確定予約をしたか（期間外も含む）。
- **クーポン配布数**は店舗に紐づかないため、店舗を絞っても全店舗分です。
- **代理予約**（source=proxy）は予約データ・売上・流入元には含み、ファネルからは除外します。
- 画面の集計（F-RPT-07 は仮置き）は CSV と同じ定義で表示しています。

### A-24 監査ログ

`/admin/audit` — 期間（既定: 直近 7 日）、操作者（スタッフ氏名・メール・会員番号・`system`）、操作種別、
対象（対象コード・対象 ID・対象種別）で検索。新しい順に 50 件ずつ。変更前後の値は JSON 表示（記録時に秘密情報を
除去する前提）。店舗限定の権限では、その店舗に紐づくログだけを表示します。保持期間は 5. を参照。

### F-RPT-01 ファネル計測

追加テーブル `funnel_events`（migration `0007_line_reports_funnel_events.sql`）。

- ページ表示のみ記録: `store_selected`（C-02 日付選択）, `slots_viewed`（C-03 空き状況）, `liff_opened`（LIFF 起動）。
  `<FunnelBeacon>` が `/api/funnel` に送信し、匿名の訪問者キー（Cookie `jc_vid`・90 日・ランダム UUID）で訪問者数を数えます。
  同一オリジンのみ受け付け、失敗しても画面には影響しません。
- 仮押さえ・ログイン・決済開始・確定は予約／決済テーブルから数えるため二重記録しません
  （ステップの CHECK 制約には含めてあり、必要になればイベント記録を追加できます）。
- 予約ページ URL の UTM は Cookie `jc_acq`（30 日）に保存され、`readBookingAttribution()` で予約に引き継げます
  （docs/line-setup.md「予約の作成経路」）。
- Cookie の利用はプライバシーポリシーへの記載が必要です（クライアント確認）。

## 7. 埋め込みコード・WordPress（A-29, F-EMB-02）

- `/admin/embed`（権限 `stores.manage`）で店舗・表示方式（iframe / 予約ボタン）・初期表示日数（1/3/7）・テーマを選び、
  コードを発行します。iframe の参照先は `APP_URL/embed/availability/<店舗コード>?days=&theme=`（C-23 ウィジェット）。
  予約ボタンは `APP_URL/booking/<店舗コード>/date?utm_source=website&utm_medium=referral&utm_campaign=hp_button`。
- WordPress プラグイン: `integrations/wordpress/jancube-availability/`（readme.txt に設置手順）。
  ショートコード `[jancube_availability store="JC001"]`, `[jancube_booking_button store="JC001"]`、設定画面で予約サイト URL。
  ウィジェット側が `window.parent.postMessage({ type: 'jancube:resize', height }, '*')` を送ると高さを自動調整します（任意）。
- 埋め込み元サイトで iframe 表示するため、`/embed/*` は `X-Frame-Options` / `frame-ancestors` で拒否しないこと（ウィジェット担当）。

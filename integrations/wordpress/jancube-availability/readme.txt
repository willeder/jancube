=== 雀CUBE 空き状況 ===
Tags: booking, availability, iframe, shortcode
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPL-2.0-or-later

雀CUBE 予約システムの空き状況ウィジェット（C-23）と予約ボタンを、ショートコードで既存のホームページに表示します。

== Description ==

* 空き状況: [jancube_availability store="JC001"]
  予約システムの空き状況ページ（/embed/availability/JC001）を iframe で表示します。
  属性: store（必須・店舗コード）, days（初期表示日数 1〜14・既定 3）, theme（light / dark）, height（高さ px・既定 360）
* 予約ボタン: [jancube_booking_button store="JC001" label="ご予約はこちら"]
  店舗の予約ページへのリンクボタン。流入元計測のため utm_source=website を付けます。

店舗コードと貼り付け用コードは、予約システムの管理画面「埋め込みコード（A-29）」でも確認できます。
WordPress の設定やテーマを変更せずに使えます。プラグインを使わない場合は、管理画面で発行した HTML を
「カスタムHTML」ブロックに貼り付けても同じ表示になります。

== Installation ==

1. このフォルダ（jancube-availability）を zip にし、WordPress の「プラグイン > 新規追加 > プラグインのアップロード」からアップロードします。
   （または wp-content/plugins/ に配置します）
2. 「プラグイン」で「雀CUBE 空き状況」を有効化します。
3. 「設定 > 雀CUBE 予約」で予約サイトのURL（例: https://jancube.net）を確認します。
4. 固定ページ・投稿にショートコードを貼り付けます。

== Frequently Asked Questions ==

= 高さが合わない =
height 属性で調整してください。予約システム側が高さ通知（postMessage の jancube:resize）に対応している場合は自動で調整されます。

= 予約サイトのURLを変えたい =
「設定 > 雀CUBE 予約」で変更すると、すべてのショートコードに反映されます。

== Changelog ==

= 1.0.0 =
* 初版: 空き状況ショートコード、予約ボタンショートコード、設定画面。

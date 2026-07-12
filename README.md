# LINE CRM

自社専用の単一LINE公式アカウント向けマーケティング・CRMです。

## Milestone 0

今回実装した範囲は、運用機能を追加するための基盤だけです。

- Next.js App Router、React、TypeScript strict、Tailwind CSS
- Supabase Auth用のSSR/browser client
- `/admin` のproxy + server-side route protection
- Supabase未設定時の秘密情報不要なmock mode
- Supabase Authユーザーのprofile自動作成と組織RLS基礎
- Vitest、Playwright、lint、typecheck、buildの実行基盤

Inbox、配信、アンケート自動タグ、LIFF、予約、リッチメニュー、分析は後続マイルストーンです。

## Milestone 1: LINE接続とWebhook基盤

Milestone 1では、LINE Messaging APIからの受信を安全に保存する基盤までを実装しています。

- `POST /api/line/webhook` の raw body HMAC-SHA256署名検証（`x-line-signature`）
- 署名検証後のJSON検証、空イベント・未対応イベント・group/roomイベントの安全な無視
- `webhook_events` の `(organization_id, webhook_event_id)` claimによる再送・同時実行の重複排除
- `contacts` の友だち追加・ブロック・再追加・メッセージ受信時のprofile upsert
- `messages` への受信メッセージ保存（本文はtextだけ、replyTokenは保存・出力しない）
- unsend受信時の本文・payload匿名化
- `/admin/settings/line`、`/admin/contacts`、`/admin/contacts/[id]` の読み取り画面
- mock profileと署名付きローカルfixture送信。LINEからの返信・送信処理はまだありません。

### LINE環境変数

`LINE_CHANNEL_SECRET` はmock modeでも署名検証のため必須です。live modeでは、これに加えて
`LINE_ORGANIZATION_ID`、`LINE_CHANNEL_ID`、`LINE_CHANNEL_ACCESS_TOKEN` が必要です。
値は `.env.local` にだけ設定し、Gitへコミットしないでください。

### ローカルWebhook確認

開発サーバーを起動したあと、署名付きfixtureを送信できます。スクリプトは `.env.local` の値を読みますが、秘密値は表示しません。

```bash
pnpm dev
pnpm line:webhook:mock -- --fixture follow
pnpm line:webhook:mock -- --fixture follow-redelivery
pnpm line:webhook:mock -- --fixture text
pnpm line:webhook:mock -- --fixture unsend
```

利用できるfixtureは `empty`、`follow`、`follow-redelivery`、`unfollow`、`re-follow`、`text`、
`non-text`、`unsend`、`unsupported`、`group`、`malformed` です。`APP_ENV=production` では送信を拒否します。

### LINE Developers Console設定

1. Messaging APIチャネルのWebhook URLに、管理画面に表示される `/api/line/webhook` URLを設定します。
2. Webhookの利用を有効化し、応答メッセージの自動返信は無効化します。現在のサーバーは返信処理を持たないため、ここを有効にすると二重返信の原因になります。
3. LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN、LINE_CHANNEL_IDを`.env.local`または本番環境のsecret設定へ登録します。
4. LINE Developers Consoleの「Verify」は、live modeの実環境設定後にだけ実行してください。ローカル確認は上記fixtureを使います。

profile取得が一時失敗してもWebhook全体を落とさず、LINE user IDとイベント時刻を使ってcontactを保存します。イベント時刻が古い受信イベントは、友だち状態やprofile表示を新しい状態へ戻しません。未対応イベントは200で受理し、`webhook_events`へignoredとして記録します。

### LINE Developers設定手順

現在のLINE Developers Consoleでは、対象ProviderのMessaging API channelを開き、Messaging APIタブからWebhookを設定します。

1. `/admin/settings/line` のWebhook URLをコピーし、Messaging APIタブのWebhook URLへ登録します。本番URLはHTTPSである必要があります。
2. 「Use webhook」をONにします。再送を利用する場合は「Webhook redelivery」もONにします。本アプリは`webhookEventId`で再送を重複排除します。
3. Basic settingsでChannel Secretを確認し、`LINE_CHANNEL_SECRET`として本番環境のsecretへ登録します。値は管理画面やログへ表示しません。
4. Messaging API settingsでChannel access tokenを発行し、`LINE_CHANNEL_ACCESS_TOKEN`として本番環境のsecretへ登録します。Channel IDは`LINE_CHANNEL_ID`へ設定します。
5. Webhook URL欄の「Verify」を押します。LINE Platformは署名付きの`events: []`リクエストを送り、アプリがHTTP 200を返せば疎通確認できます。
6. 画面の「接続確認」を押すと、Environment Variable確認、live modeのLINE API認証確認、署名付きWebhook URL確認を実行できます。mock modeでは実LINE APIの認証確認を行わず、mock確認として表示します。
7. 返信送信はMilestone 2以降のため、不要なGreeting messages / Auto-reply messagesはOFFにします。

公式手順: [Verify webhook URL](https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/)、[Receive messages (webhook)](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)、[Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)。

## 起動

```bash
pnpm install
pnpm dev
```

ブラウザで `http://127.0.0.1:3000` を開きます。環境変数がない場合はmock modeでログインできます。

## 環境変数

`.env.example` を `.env.local` にコピーします。設計書第5章に定義された環境変数は、Milestone 0で全て名前と型を登録しています。後続機能の変数は、機能実装まで空欄のままにしてください。

### App

- `NEXT_PUBLIC_AUTH_MODE=auto`: Supabaseの公開URLとanon keyが揃えばSupabase Auth、それ以外はmock mode
- `NEXT_PUBLIC_AUTH_MODE=mock`: 常にmock mode
- `NEXT_PUBLIC_APP_URL`: アプリの公開URL。未設定でもローカル起動可能
- `APP_ENV`: `development` / `test` / `production`
- `APP_TIMEZONE`: 既定値 `Asia/Tokyo`
- `MOCK_LINE_API`: 既定値 `true`。Milestone 1以降のLINE mock切替用
- `ADMIN_EMAIL_ALLOWLIST`: 管理者メールアドレスのカンマ区切り。Milestone 0では表示・認証制御に未使用

### Supabase

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser/Auth用の公開値
- `SUPABASE_SERVICE_ROLE_KEY`: サーバー専用。ブラウザへ公開しない
- `SUPABASE_DB_URL`: サーバー・運用スクリプト専用。Milestone 0では未使用

### LINE・LIFF

`LINE_ORGANIZATION_ID`、`LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、
`LINE_ADMIN_USER_ID`、`NEXT_PUBLIC_LIFF_ID`、`LINE_LOGIN_CHANNEL_ID`、
`LINE_LOGIN_CHANNEL_SECRET` は、実際のLINE接続を行わない環境では空欄のままにします。Milestone 1のmock webhook確認では、`LINE_CHANNEL_SECRET`だけ任意のローカル専用値を設定してください。

### Cron・保持期限・容量上限（後続マイルストーン）

`CRON_SECRET`、`MEDIA_RETENTION_DAYS`、`WEBHOOK_RETENTION_DAYS`、
`MESSAGE_RETENTION_DAYS`、`DB_WARNING_BYTES`、`DB_STOP_BYTES`、
`STORAGE_WARNING_BYTES`、`STORAGE_STOP_BYTES`、`LINE_QUOTA_RESERVE_PERCENT`
は `.env.example` の安全側初期値を使用できます。

### Survey（後続マイルストーン）

`SURVEY_DEFAULT_SESSION_TTL_HOURS`、`SURVEY_MAX_QUESTIONS`、
`SURVEY_MAX_QUICK_REPLY_OPTIONS`、`SURVEY_POSTBACK_TOKEN_SECRET` を定義しています。

起動時にZodで全環境変数を検証します。設定値が不正な場合は起動/buildを失敗させ、未設定の任意値はmock modeと安全な既定値で動作します。確認用エンドポイントは `GET /api/health` です。秘密値そのものはレスポンスに含めません。

## Supabase設定

1. Supabaseプロジェクトを作成します。
2. Supabase Authでメール/パスワード認証を有効にします。
3. `supabase/migrations/20260712000000_milestone_0_auth_foundation.sql`、続けて `supabase/migrations/20260712010000_milestone_1_line_webhook.sql` をSQL EditorまたはSupabase CLIで適用します。
4. Authユーザーを作成し、`.env.local` に公開URLとanon keyを設定します。
5. `/login` からSupabase Authでログインします。

Supabase未設定時は、上記手順なしでmock modeのログインを確認できます。

## 検証

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

E2Eはmock modeの開発サーバーで、未認証の `/admin` リダイレクトとmockログインを確認します。Webhookの単体・統合テストは `pnpm test` に含まれます。RPCはservice roleだけが実行でき、管理画面の読み取りは組織RLSの範囲に限定されます。

## コスト方針

初期版ではVercelの従量課金アドオン、Supabase有料機能、AI API、メール/SMS、外部キューを追加しません。本番利用時のVercelプランやSupabase無料枠は、公開前に公式情報を再確認します。

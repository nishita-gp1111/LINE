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

LINE Webhook、友だち情報、Inbox、配信、アンケート自動タグ、LIFF、予約、リッチメニュー、分析は後続マイルストーンです。

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

### LINE・LIFF（後続マイルストーン）

`LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、
`LINE_ADMIN_USER_ID`、`NEXT_PUBLIC_LIFF_ID`、`LINE_LOGIN_CHANNEL_ID`、
`LINE_LOGIN_CHANNEL_SECRET` は、LINE接続実装まで空欄にします。

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
3. `supabase/migrations/20260712000000_milestone_0_auth_foundation.sql` をSQL EditorまたはSupabase CLIで適用します。
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

E2Eはmock modeの開発サーバーで、未認証の `/admin` リダイレクトとmockログインを確認します。

## コスト方針

初期版ではVercelの従量課金アドオン、Supabase有料機能、AI API、メール/SMS、外部キューを追加しません。本番利用時のVercelプランやSupabase無料枠は、公開前に公式情報を再確認します。

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

profile取得が一時失敗してもWebhook全体を落とさず、LINE user IDとイベント時刻を使ってcontactを保存します。イベント時刻が古い受信イベントは、友だち状態やprofile表示を新しい状態へ戻しません。未対応イベントは200で受理し、`webhook_events`へignoredとして記録します。

### LINE Developers Console設定手順

現在のLINE Developers Consoleでは、対象ProviderのMessaging API channelを開き、Messaging APIタブからWebhookを設定します。

1. `/admin/settings/line` のWebhook URLを確認します。本番コード・本番Supabase・本番環境変数の準備完了までは、運用中channelへ本番Webhook URLを登録しないでください。本番URLはHTTPSである必要があります。
2. 「Use webhook」をONにします。再送を利用する場合は「Webhook redelivery」もONにします。本アプリは`webhookEventId`で再送を重複排除します。
3. Basic settingsでChannel Secretを確認し、`LINE_CHANNEL_SECRET`として本番環境のsecretへ登録します。値は管理画面やログへ表示しません。
4. Messaging API settingsでChannel access tokenを発行し、`LINE_CHANNEL_ACCESS_TOKEN`として本番環境のsecretへ登録します。Channel IDは`LINE_CHANNEL_ID`へ設定します。
5. Webhook URL欄の「Verify」を押します。LINE Platformは署名付きの`events: []`リクエストを送り、アプリがHTTP 200を返せば疎通確認できます。
6. 画面の「接続確認」を押すと、Environment、LINE API、接続先アカウント、Webhook到達、未署名401、不正署名401、正しい署名200を個別に確認できます。署名確認はメッセージを含まない`events: []`だけで行い、LINE user IDやsecretは返しません。mock modeではWebhook URLの到達確認だけを行います。
7. CRM側で応答を管理するため、Greeting messages / Auto-reply messagesはOFFにします。

公式手順: [Verify webhook URL](https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/)、[Receive messages (webhook)](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)、[Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)。

## Milestone 2: Inboxと手動テキスト返信

Milestone 2では、1対1トークの会話確認とCRM内の対応管理、管理画面からのテキスト返信を実装します。

- `/admin/inbox`: 会話一覧、会話詳細、CRM内未確認・確認済み、対応中・保留・完了、担当者、優先度、内部メモ
- `/admin/settings/quick-replies`: テキストクイック返信の作成・編集・有効/無効・削除
- Push APIによる1人宛てテキスト送信。replyTokenは保存・利用しません。
- `X-Line-Retry-Key`、`clientRequestId`、送信状態、限定再試行、Mock送信
- 送信状態は「LINE受付済み」であり、到達・既読を意味しません。

実LINEへの手動送信は `LINE_MANUAL_SEND_ENABLED=false` が既定です。`MOCK_LINE_API=true` ではこのゲートに関係なくMock送信を確認できます。live modeで送信する場合だけ、管理者が `LINE_MANUAL_SEND_ENABLED=true` を設定してください。送信は常にサーバーでcontactを解決し、viewer、他organization、blocked contactからの送信を拒否します。

本文上限はLINE公式仕様に合わせて5000文字です。LINEの文字数はUTF-16 code unitsで数えられるため、絵文字などでは画面の見た目の文字数と異なる場合があります。

### Inbox運用上の注意

- 「CRM内未確認・確認済み」は管理画面ごとの状態であり、LINEユーザーの既読状態ではありません。
- Milestone 2ではLINEのMark as read APIや`markAsReadToken`を利用しません。CRM内確認済み操作とLINE Official Account Manager上の既読は別概念です。
- CRM接続前の過去トーク履歴は自動取得しません。
- LINE Official Account Managerから送った手動メッセージとCRMの履歴が完全一致するとは限りません。CRMが把握する送信履歴は原則としてCRM自身がMessaging APIで送ったものです。
- group、room、複数人トーク、画像・動画・音声・スタンプ・Flex、一斉配信、予約配信、自動応答、タグ、アンケート、予約、分析、AIはMilestone 2の対象外です。

### Mock送信fixture

`MOCK_LINE_SEND_OUTCOME`で`success`、`409`、`429`、`500`、`timeout`を選択できます。成功と409は「LINE受付済み」、429は再試行しない送信失敗、500/timeoutは同じRetry Keyで限定再試行後に「再試行待ち」になります。

## Milestone 3 Launch foundation

Milestone 3は3A〜3Gの安全基盤を実装しています。タグの付与元、型付きカスタム項目、SQLを受け付けないセグメントDSL、配信抑止、公開LINEメディア、テンプレート、500件batch、quota reserve、Retry Key、version固定automation、opaque survey postback、API/externalを区別するrich menu、deterministic/estimated attribution、daily analytics、scheduler heartbeatとlaunch checklistを含みます。

本番で送信・自動処理・リッチメニュー変更を行うflagは既定OFFです。Mock modeではflag OFFでもpayload、batch、署名、validationを確認できます。LINE APIの200/409は「LINE受付済み」であり、到達・既読を意味しません。Supabase migration、Storage bucket/RLS、Cron、LINE Developers Console、商用ホスティング確認は人間が実施してください。

運用資料は [docs/milestone-3-overview.md](docs/milestone-3-overview.md)、[docs/milestone-3-completion-audit.md](docs/milestone-3-completion-audit.md)、[docs/migrations.md](docs/migrations.md)、[docs/launch-runbook.md](docs/launch-runbook.md)、[docs/rollback.md](docs/rollback.md) から確認できます。

### Minimum Production Launchの5機能

初回の限定運用では、次の5機能だけをローンチ対象にします。

1. `/admin/contacts/[id]` で顧客へタグを付与・解除します。付与元はmanual / surveyごとに保持し、最後の付与元が解除された時だけタグなしになります。
2. `/admin/surveys` で1つの有効なアンケートを「友だち追加時」に指定し、follow webhook直後に対象者1名へ送信します。
3. 選択肢ごとの付与タグを設定します。回答は署名付きpostbackで受信し、同じ質問の再送は1件へ集約して、付与元`survey`のタグを保存します。
4. `/admin/automations` で「タグ付与直後に1通送信」を作成して有効化します。同じタグには1つの有効設定だけを許可し、同じタグ付与の再処理では送信履歴を再利用します。
5. `/admin/rich-menus` で画像、タップ動作、条件タグを登録します。条件一致時はその顧客だけへ紐付け、条件がなくなると元のユーザー別メニューへ戻します。デフォルトリッチメニュー変更APIはサーバー側で常に拒否します。

Live modeでは `LINE_MANUAL_SEND_ENABLED`、`LINE_AUTOMATION_SEND_ENABLED`、`LINE_RICH_MENU_MUTATION_ENABLED` を運用対象環境だけで有効にし、`SURVEY_POSTBACK_TOKEN_SECRET` に32文字以上のランダム値を設定します。実LINEへの送信とユーザー別リッチメニュー変更は、サーバー側のControlled Launch allowlist 1名だけに制限します。0名または複数名なら一致候補があっても全件を拒否します。

Sho本人の登録にBusiness IDやfollower一覧APIは使いません。`LINE_CONTROLLED_LAUNCH_ENROLLMENT_ENABLED=true`と、十分に長い一回限りメッセージのSHA-256を`LINE_CONTROLLED_LAUNCH_ENROLLMENT_TOKEN_HASH`へ設定したうえで、Sho本人がそのメッセージをLINE公式アカウントへ送ります。署名検証済みWebhookがcontactを作成・更新し、organizationごとに最初の1名だけを`controlled_launch_recipients`へ原子的に登録します。DBへ保存するのはLINE User IDのSHA-256だけで、登録メッセージ本文もInbox・webhook payload・ログへ残しません。登録後はDBの1名を正本とし、環境変数の候補より優先します。

管理者専用の`GET /api/line/recipient-candidates`は診断用の任意機能です。LINE follower ID APIが使えないアカウントでも、上記の署名済みWebhook登録だけでControlled Launchを開始できます。

`LINE_BULK_SEND_ENABLED`、`LINE_SCHEDULED_SEND_ENABLED`、`LINE_AUTO_REPLY_ENABLED`、`LINE_MEDIA_SEND_ENABLED`はfalseのままにします。一斉配信、予約配信、時間差配信、Cron、Scheduler heartbeat、高度な分析、バックアップ自動化はMinimum Production Launchの合否には含めません。

### 本番切替順序

Production webhookは最終的に `https://line-gp-1111.vercel.app/api/line/webhook` を使用します。ただし、次の1〜5が完了するまでLINE Developersへ登録しません。

1. Production Supabaseの論理バックアップを取得し、checksumと対象範囲を記録します。
2. Productionへlinkした隔離作業ディレクトリで`supabase migration list`と`supabase db push --dry-run`を実行します。
3. Production環境変数を監査し、`APP_ENV=production`、`MOCK_LINE_API=false`、Production Supabase、固定Production URL、想定LINEアカウント、Sho本人1名のallowlist、安全flagを確認します。
4. 1回の本番変更許可後に、PRのmerge、Production migration、Production deploymentを順に行います。
5. `/api/health`、LINE bot info、未署名401、不正署名401、正しい署名200を確認します。Vercel Deployment ProtectionがWebhookを遮断している場合は、LINEから到達できる状態へ変更してから検証します。
6. ここまで成功してから、LINE DevelopersのWebhook URLへ本番URLを登録してUse webhookをONにし、Greeting messagesとAuto-reply messagesをOFFにします。

### Milestone 3 Completion setup

本番適用前に、既存migrationから順番に確認してください。

```bash
npx supabase db push --dry-run
npx supabase db push
```

`db push`はProduction対象、バックアップ、dry-run結果を確認し、明示的な本番変更許可を得てから実行します。Storageは`line-media` private bucketとmigrationのStorage RLSを使い、ファイル本体はSupabase Storage APIで扱います。CronはMinimum Production Launchの対象外です。

Minimum Production Launchの自動判定は、対象organization、5機能に必要なmigration、LINE接続設定、Sho本人1名のallowlist、必須flagと禁止flagだけを確認します。Mock環境は`INTERNAL TEST ONLY`と表示します。

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
- `LINE_MANUAL_SEND_ENABLED`: 既定値 `false`。live modeの手動Push送信ゲート。mock modeではfalseでもMock送信可能
- `MOCK_LINE_SEND_OUTCOME`: 既定値 `success`。Mock送信の結果fixture
- `LINE_CONTROLLED_LAUNCH_ENROLLMENT_ENABLED`: 既定値 `false`。署名済みWebhookからの一回限り本人登録ゲート
- `LINE_CONTROLLED_LAUNCH_ENROLLMENT_TOKEN_HASH`: 本人登録メッセージをSHA-256した64文字の小文字hex。平文は保存しない
- `ADMIN_EMAIL_ALLOWLIST`: 管理者メールアドレスのカンマ区切り。Milestone 0では表示・認証制御に未使用

### Supabase

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser/Auth用の公開値
- `SUPABASE_SERVICE_ROLE_KEY`: サーバー専用。ブラウザへ公開しない
- `SUPABASE_DB_URL`: サーバー・運用スクリプト専用。Milestone 0では未使用

### LINE・LIFF

`LINE_ORGANIZATION_ID`、`LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、
`LINE_EXPECTED_BASIC_ID`、`LINE_EXPECTED_DISPLAY_NAME`、`LINE_ADMIN_USER_ID`、`NEXT_PUBLIC_LIFF_ID`、`LINE_LOGIN_CHANNEL_ID`、
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
3. `supabase/migrations` をファイル名順にSupabase CLIで適用します。Controlled Launchでは `20260714013000_controlled_launch_recipient_bootstrap.sql` まで必要です。
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

E2Eはmock modeの開発サーバーで、未認証の `/admin` リダイレクトとmockログインを確認します。WebhookとInboxの単体・統合テストは `pnpm test` に含まれます。RPCはservice roleだけが実行でき、管理画面の読み取りは組織RLSの範囲に限定されます。macOSのChromium sandbox権限でE2Eが起動できない場合は、OSのセキュリティ設定を弱めず、HTTP確認と単体・統合テストを代替確認として区別してください。

## コスト方針

初期版ではVercelの従量課金アドオン、Supabase有料機能、AI API、メール/SMS、外部キューを追加しません。本番利用時のVercelプランやSupabase無料枠は、公開前に公式情報を再確認します。

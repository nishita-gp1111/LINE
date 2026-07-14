# Minimum Production Launch runbook

初回Production Launchの対象は、手動タグ、友だち追加時アンケート、回答タグ、タグ起点即時1通、ユーザー単位リッチメニュー切替だけです。一斉・予約・時間差配信、Cron、Scheduler heartbeat、media、高度な分析、バックアップ自動化は合否に含めません。

## 本番変更前

1. Production Supabaseのrole、public schema、public data、Auth user、Storage inventoryを所有者限定ディレクトリへ保存し、SHA-256を確認します。
2. Production専用の隔離作業ディレクトリで`supabase migration list --linked`と`supabase db push --linked --dry-run`を実行します。repositoryの通常linkはstagingのまま維持します。
3. Production Vercel環境変数にProduction Supabase、`APP_ENV=production`、`MOCK_LINE_API=false`、固定Production URL、LINE接続情報、想定アカウント、32文字以上のsurvey secretを準備します。
4. Business IDは使いません。一回限り本人登録メッセージのSHA-256だけを`LINE_CONTROLLED_LAUNCH_ENROLLMENT_TOKEN_HASH`へ設定し、`LINE_CONTROLLED_LAUNCH_ENROLLMENT_ENABLED=true`にします。平文はGit、DB、ログへ保存しません。
5. 手動送信・automation・rich menu mutationだけをONにし、bulk・scheduled・auto reply・mediaをOFFにします。
6. PR checksとPreviewを確認してから、merge・Production migration・Production deployment・Deployment Protection変更を1回の許可にまとめます。

## 本番変更後

1. Production HealthがSupabase auth、Production、Live mode、Production URL、allowlist 1件、安全flag、blocker 0件を示すことを確認します。
2. `/admin/settings/line`の接続確認で、想定LINE公式アカウント、未署名401、不正署名401、正しい署名200を確認します。すべて空イベントで、メッセージは送信しません。
3. Production webhookがVercel Deployment Protectionに遮断されていないことを確認します。
4. ここまで成功してから、LINE Developersへ`https://line-gp-1111.vercel.app/api/line/webhook`を登録し、Use webhookをONにします。
5. LINE Official Account ManagerのGreeting messagesとAuto-reply messagesをOFFにします。

## Sho本人のWebhook登録

1. Webhook URL、署名検証、対象organization、`20260714013000_controlled_launch_recipient_bootstrap.sql`の適用を先に確認します。
2. Sho本人が指定された一回限りメッセージを1通送ります。
3. 署名済みWebhookだけがcontact作成・更新後に登録RPCを呼びます。organizationごとのトランザクションロックにより、最初の1名だけを登録し、同じ本人の再送は`already_enrolled`、別ユーザーは`locked`になります。
4. `controlled_launch_recipients`にはcontact参照とLINE User IDのSHA-256だけを保存します。受信メッセージ本文は固定の伏字へ置換します。
5. 登録後は手動タグ、友だち追加時アンケート、回答タグ、タグ起点即時1通、ユーザー別rich menuの全経路が同じDB allowlistを使います。未登録・DB不明・他ユーザーではfail-closedです。

デフォルトリッチメニューは変更しません。アプリは`/v2/bot/user/all/richmenu`をサーバー側で拒否し、ユーザー単位endpointだけを使用します。

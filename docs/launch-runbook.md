# Minimum Production Launch runbook

初回Production Launchの対象は、手動タグ、友だち追加時アンケート、回答タグ、タグ起点即時1通、ユーザー単位リッチメニュー切替だけです。一斉・予約・時間差配信、Cron、Scheduler heartbeat、media、高度な分析、バックアップ自動化は合否に含めません。

## 本番変更前

1. Production Supabaseのrole、public schema、public data、Auth user、Storage inventoryを所有者限定ディレクトリへ保存し、SHA-256を確認します。
2. Production専用の隔離作業ディレクトリで`supabase migration list --linked`と`supabase db push --linked --dry-run`を実行します。repositoryの通常linkはstagingのまま維持します。
3. Production Vercel環境変数にProduction Supabase、`APP_ENV=production`、`MOCK_LINE_API=false`、固定Production URL、LINE接続情報、想定アカウント、32文字以上のsurvey secretを準備します。
4. 許可先は`LINE_TEST_USER_IDS`または`LINE_TEST_USER_HASHES`のどちらか1件だけにします。未設定・複数・不一致ではサーバーが全送信とユーザー別rich menu変更を拒否します。
5. 手動送信・automation・rich menu mutationだけをONにし、bulk・scheduled・auto reply・mediaをOFFにします。
6. PR checksとPreviewを確認してから、merge・Production migration・Production deployment・Deployment Protection変更を1回の許可にまとめます。

## 本番変更後

1. Production HealthがSupabase auth、Production、Live mode、Production URL、allowlist 1件、安全flag、blocker 0件を示すことを確認します。
2. `/admin/settings/line`の接続確認で、想定LINE公式アカウント、未署名401、不正署名401、正しい署名200を確認します。すべて空イベントで、メッセージは送信しません。
3. Production webhookがVercel Deployment Protectionに遮断されていないことを確認します。
4. ここまで成功してから、LINE Developersへ`https://line-gp-1111.vercel.app/api/line/webhook`を登録し、Use webhookをONにします。
5. LINE Official Account ManagerのGreeting messagesとAuto-reply messagesをOFFにします。

デフォルトリッチメニューは変更しません。アプリは`/v2/bot/user/all/richmenu`をサーバー側で拒否し、ユーザー単位endpointだけを使用します。

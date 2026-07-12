# Supabase Cron setup

既定providerは`supabase_cron`です。本番URLとsecretはSQLへ直書きせず、人間がSupabase Vaultへ保存してください。

1. Supabase Dashboardでpg_cron/pg_netを有効化し、Vault secretへ`CRON_SECRET`を登録する。
2. [supabase/manual/scheduler.sql.example](../supabase/manual/scheduler.sql.example) のVault keyを環境に合わせて設定する。
3. 1分ごとのPOSTを`/api/cron/dispatch`へ設定し、AuthorizationはVaultから取得する。
4. `/api/cron/health`でheartbeatとstale thresholdを確認する。
5. 障害時はcron jobをpauseし、管理画面のkill switchを確認する。再開はownerが行う。

同じSQLを複数回実行しても、先に同名jobを解除してから再登録するためCronが重複しません。状態は`cron.job`、実行結果は`cron.job_run_details`、アプリ側の最新状態は`scheduler_heartbeats`で確認します。

Vercel CronはPro等の商用利用可能プランを人間が確認した場合だけ代替利用し、未確認の状態で`vercel.json`へ1分cronを追加しません。Manual providerは開発・障害対応用です。secret rotate時はVaultとVercel/Supabase側を同時に更新し、旧値でのhealth失敗を確認してから再開します。

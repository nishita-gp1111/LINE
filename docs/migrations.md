# Migration and rollback audit

適用順は次の通りです。

1. `20260712000000_milestone_0_auth_foundation.sql`
2. `20260712010000_milestone_1_line_webhook.sql`
3. `20260712020000_milestone_2_inbox.sql`
4. `20260713030000_milestone_3a_segmentation_foundation.sql`
5. `20260713031000_milestone_3b_delivery.sql`
6. `20260713032000_milestone_3c_automations.sql`
7. `20260713033000_milestone_3d_surveys.sql`
8. `20260713034000_milestone_3e_rich_menus.sql`
9. `20260713035000_milestone_3f_attribution_analytics.sql`
10. `20260713036000_milestone_3g_launch_hardening.sql`
11. `20260713037000_milestone_3h_runtime_hardening.sql`

3Aは顧客データとRLS、3Bはmedia/template/campaign/job、3Cはautomation、3Dはsurvey、3Eはrich menu、3Fはtracking/analytics、3Gはlaunch状態、3Hはprivate Storage/RLSとruntime RPCを追加します。既存テーブルのbackfillは3A〜3Bに限定し、3Hは既存migrationを変更しません。

想定ロックは新規table/index/policy作成と`media_assets.storage_bucket` default変更です。大規模本番ではmaintenance window、dry-run、backup後に適用してください。`pg_cron`/`pg_net`や`storage.buckets`が管理権限で利用できない環境では、先にDashboardでextensionを有効化します。

適用前:

```bash
npx supabase db push --dry-run
```

適用後は `select count(*) from public.scheduled_jobs;`、`select * from public.scheduler_heartbeats;`、`select id,public from storage.buckets where id = 'line-media';`、`select jobid,jobname,active from cron.job where jobname like 'line-crm-%';` を人間が確認します。

ロールバックはflag OFF→cron停止→未送信job/campaign停止→原因確認の順です。migrationを逆順に自動dropしません。Storage objectやsurvey回答、audit logを破壊する変更はrollback不能としてbackup/restore計画を先に確認します。

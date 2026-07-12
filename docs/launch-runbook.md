# Launch runbook

人間が行う順序: migration適用→Storage bucket/RLS→secret rotate→Channel Secret/Access Token→Webhook URL/Verify/Use ON/Redelivery ON→Cron heartbeat→OA Manager応答確認→test userで個別media/campaign/予約/step/keyword/survey/tag/rich menu/linkを確認→quota/storage/backup→kill switch確認。

flagは一度に全ONにせず、media→scheduled→automation→auto reply→bulk→rich menu mutationの順に、各段階で停止確認します。Hobby商用利用、未適用migration、未確認のWebhook/backup/rollbackはローンチblockerです。

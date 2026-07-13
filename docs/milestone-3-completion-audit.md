# Milestone 3 code audit

「foundation」「placeholder」は完成扱いにしていません。

|機能|DB|API/Server|管理画面|Mock操作|Live|自動テスト|阻害要因|
|---|---|---|---|---|---|---|---|
|タグ|○|Mock API|○|○|Live DB待ち|○|排他/CRUDのLive確認|
|カスタム項目|○|Mock API|○|○|Live DB待ち|○|CSV/Live確認|
|セグメント|○|Mock API|○|○|Live query待ち|○|複合条件のLive preview|
|一斉配信|○|Mock campaign API|○|○|multicast adapter|○|campaign DB/Live送信の結線|
|予約配信|○|job/Mock dispatcher|○|○|Live scheduler待ち|○|Cron実環境確認|
|ステップ配信|○|Mock execution API|○|○|Webhook/Live待ち|○|待機jobのLive結線|
|キーワード応答|○|Mock preview API|○|○|reply adapter待ち|○|Webhook reply結線|
|アンケート|○|Mock answer API|○|○|Webhook/Live待ち|○|本番postback結線|
|リッチメニュー|○|Mock validate/link API|○|○|Live API adapter待ち|○|LINE API接続確認|
|流入経路|○|DB/Mock API|○|○|○|○|source analyticsの実DB確認|
|分析|○|DB/Mock query API|○|○|○|○|期間/権限の実DB確認|
|メディア|○|FormData/Storage API|○|○|upload adapter|○|private signed URL/Live送信確認|

この表はコード側の残課題を隠さないためのものです。PRはDraftを維持し、上記未接続部分を完成扱いにしません。

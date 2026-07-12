# Milestone 3 code audit

「foundation」「placeholder」は完成扱いにしていません。

|機能|DB|API/Server|管理画面|Mock操作|Live|自動テスト|阻害要因|
|---|---|---|---|---|---|---|---|
|タグ|○|×|×|×|×|DSL/provenanceのみ|CRUD・顧客操作未接続|
|カスタム項目|○|×|×|型schemaのみ|×|型検証|CRUD未接続|
|セグメント|○|×|表示のみ|DSLのみ|×|DSL/SQL安全性|preview query未接続|
|一斉配信|○|dispatcher基盤|表示のみ|batch/分類|×|batch/quota|campaign送信API未接続|
|予約配信|○|job基盤|表示のみ|job遷移|×|idempotency基盤|campaign scheduler未接続|
|ステップ配信|○|×|表示のみ|schema/validation|×|循環/抑止|Webhook/enrollment未接続|
|キーワード応答|○|×|表示のみ|priority/regex|×|priority/regex|Webhook reply未接続|
|アンケート|○|×|表示のみ|token/selection|×|token/action基盤|postback処理未接続|
|リッチメニュー|○|×|表示のみ|validation|×|bounds/flag|LINE API未接続|
|流入経路|○|route/DB adapter|表示のみ|mock link|DB route実装|redirect/dedupe|source CRUD未接続|
|分析|○|×|表示のみ|×|×|なし|rollup/query未接続|
|メディア|○|payload/validation|×|payloadのみ|×|MIME/size|Storage upload/send未接続|

この表はコード側の残課題を隠さないためのものです。PRはDraftを維持し、上記未接続部分を完成扱いにしません。

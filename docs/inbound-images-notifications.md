# 受信写真と管理画面の新着通知

## 使い方

- お客様からの画像メッセージを1対1トーク内に表示。「写真を拡大」で別タブ表示。
- 上部のベルから新着LINEを確認し、該当トークに移動できる。
- 「デスクトップ通知をONにする」を押して、各端末のブラウザで通知を許可する。
- 許可しない場合も画面内のベル・新着カードは利用可能。デスクトップ通知に本文や画像は出さない。
- 管理画面を開いている間のみ動作。通常約8秒間隔で確認し、バックグラウンドではブラウザの制限により遅れる場合がある。タブを閉じた状態・スリープ中のWeb Pushは対象外。
- 新規ログイン時に過去のメッセージをまとめて通知しない。通知一覧は現在の管理画面セッションの直近30件。
- 複数タブの場合、Web Locksと端末内のメッセージID履歴でデスクトップ通知の重複を防ぐ。別端末にはそれぞれ通知する。Web Locks非対応ブラウザは履歴による抑止のみ。
- 新着時はトークを再取得するが、入力中の本文・内部メモ・選択済み送信ファイルは保持する。バックグラウンドのトークは自動既読にしない。

## 画像の保護・保存

- `/api/inbox/messages/[id]/image` はログインとorganization所属を毎回確認する。メッセージIDからLINE側IDをサーバーで照合し、クライアント指定の外部URLにはアクセスしない。
- LINEの固定content APIから取得。APIトークンはブラウザ・ログに出さない。
- 最大20MBまで読み、実体を画像としてデコード。EXIFを除去し、縦横2560px以下・3MB以下の表示用JPEGにする（原本ファイルの無加工保存ではない）。
- 新しい受信画像はWebhook応答後に非同期取得し、既存のprivate `LINE_MEDIA_BUCKET` 内の `organization/inbound/message/display.jpg` に保存。公開バケットにはアップロードしない。
- 既存メッセージは表示時に取得・保存。LINE側で削除済みの内容は復元できないため、期限切れの案内を表示する。
- 送信取消は表示対象から除外し、private保存画像の削除も試みる。取得中の取消を再確認。取消後は認証済みcontent APIでも返さない。
- 一時的な取得エラー時は再読み込みできる。画像は画面付近までスクロールした時点で読み込む。
- 新しい環境変数・migration・外部サービス契約は不要。既存の送信・自動アクション設定は変更しない。

## 検証項目

| 要件 | 実装箇所 | 検証 |
| --- | --- | --- |
| 受信画像・拡大・期限切れ・再試行 | ReceivedImage / image API | 画像変換unit、PC・390px幅E2E、画像描画寸法 |
| 匿名・別organization・取消画像の拒否 | getReceivedImage | 認証・query条件・取消競合unit、未ログインAPI E2E |
| private保存・トークン非露出・Mockで外部呼出しなし | received-image modules | 保存先公開設定、キャッシュ、Mock停止、エラーunit |
| 管理画面共通通知・通知からトーク遷移 | AdminShell / InboxNotifications | 署名付きローカルmock WebhookからE2E |
| 過去の新着通知抑止・重複・ページ継続 | notifications API | カーソル精度・再送・65件ページングunit |
| 通知権限・複数タブ・下書き保持・背景既読防止 | InboxNotifications / InboxClient | OS通知面のみ代替したE2E、実際の通知API・トーク更新処理 |
| 長い会話の最新200件 | SupabaseInboxStore | 新しい順に200件取得して時系列表示するunit |

テストでは顧客へのLINE送信はしない。OSの実通知は端末の許可・集中モードなどの設定にも依存する。

## 参考仕様

- [LINE: 受信コンテンツ取得と保存期限](https://developers.line.biz/ja/docs/messaging-api/receiving-messages/)
- [MDN: Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)

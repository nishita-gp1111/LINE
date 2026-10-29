# 無料運用の検証記録（2026-10-29）

## 本番停止と復旧日

本番 `line-gp-1111.vercel.app` のhealth、login、inbox、3つの担当者別add URLはいずれもHTTP 402 `DEPLOYMENT_DISABLED`。
ログイン済みVercel GP1111画面では、HobbyのFluid Active CPU上限超過により10月29日停止、解除予定11月28日と表示。
月初11月1日の復旧ではない。設定変更やコード軽量化だけでは発生済みの停止は解除されない。解除予定は復旧保証ではなく、当日の公開状態再確認が必要。
Hobbyは非商用個人向けのため、業務CRMを無料Hobbyで継続することは推奨できない。

## 同期負荷削減

- トーク同期: 5秒 → 60秒。非表示タブでは停止。
- 新着通知: 8秒 → 60秒。非表示では300秒（デスクトップ通知機能自体は維持）。
- 変更なし時の補完的ページ再取得: 60秒 → 300秒。
- 通信エラー・認証再確認でも高速リトライしない。
- 通常の確認リクエスト計算: 毎時720+450=1,170回/タブ → 60+60=120回/タブ（約90%減）。初回、タブ復帰、手動更新、通知ページングは除く。CPU時間・料金の削減率を実測した値ではない。
- 本人の送信後は即時表示。他担当者からの更新は通常約1分＋通信時間。手動「今すぐ更新」あり。

## Cloudflareへの単純移転: 不合格（未公開）

本番の秘密情報・顧客データを含めない独立したローカルcloneで確認。
移行元コミット: `67bdc94903cb5300222efbe63aa9965daa2a53fc`。
同期頻度の変更とは独立したランタイム互換性の検証であり、本番受け入れテストではない。

構成: Next.js 16.2.10 / OpenNext Cloudflare 1.20.13 / Wrangler 4.154.0 / sharp 0.34.5。
Wranglerは `--local` と `deploy --dry-run` のみ実行。Cloudflareのアカウント作成、課金、外部リソース作成、公開、秘密情報登録は行っていない。
Mock認証、Mock LINE、APP_ENV=test、ローカルURL、ダミーLINE ID/署名キーのみ使用。

| 確認 | 結果 | 証拠・制約 |
| --- | --- | --- |
| OpenNext変換ビルド | PASS | Worker生成成功 |
| Wrangler dry-run | PASS | gzip約1,823 KiB、公開なし |
| health | PASS | 200、authMode=mock、mockLineApi=true |
| ログイン画面・Mockログイン | PASS | 200、テスト用Cookie発行 |
| 未ログイン管理画面 | PASS | 307 → /login |
| 未ログイン同期API | PASS | 401 |
| Mockログイン後のトーク画面 | PASS | 200、顧客とのトークを描画 |
| Mockログイン後の同期・通知API | PASS | 200、revision/cursorあり |
| 今福・志水・魚井のaddページ | PASS（表示のみ） | 各200、正しい担当者名とダミーLINE URL。LINE実機遷移・LIFF認証・本番タグ付与は未検証 |
| Webhook署名なし拒否 | **FAIL** | 401が期待値だが500。sharp読み込みで署名検証前にエラー |
| 添付送信API初期化 | **FAIL** | sharp読み込みで500。テスト用不正payloadのみ、実送信なし |
| 本番Supabase認証・RLS・実データ | 未実施 | 本番情報を試験環境へ入れていない |
| 無料枠CPU上限への適合 | 未検証 | ローカルの応答時間はCPU時間ではない。Free 10ms/リクエスト以内を保証できない |

エラー: `Could not load the "sharp" module using the linuxnull-x64 runtime` / native moduleのdynamic require未対応。
該当箇所は `src/lib/line/received-image.ts` と `src/lib/inbox/attachment-file.ts`。既存のNode向け画像処理をそのままWorkersへ持ち込めない。
Vercel上の停止原因はCPU枠超過であり、この画像処理エラーは移行試験で初めて発生した別問題。

## 移行する場合に必要な次の作業

1. 画像受信・添付の変換をWorkers互換へ置換、または別の無料実行環境へ分離。EXIF除去、画像サイズ制限、非公開保存、認証を維持する。写真機能を黙って無効化しない。
2. 実ランタイムで署名検証・画像受信・送信・アンケート・タグ・担当者割当を再検証する。CPU、リクエスト、ストレージなど各無料枠へ収まることを確認する。
3. 接続先変更の許可後にのみ本番秘密情報を設定し、LINE Webhook・LIFF・Supabase redirect URLを新ホストへ切り替える。
4. 現在のVercel提供ドメインは移転先へ持ち出せない。既存配布URLの更新が必要。`/add/meeting-*` のパスと担当者ルールは維持する。

無料での即時復旧または長期安定運用を確認できた状態ではない。本番・main・DB・LINE設定は未変更。今後別途移行実装と検証が必要。

## 公式資料

- [Vercel Hobby: 上限と非商用条件](https://vercel.com/docs/plans/hobby)
- [Vercel公開停止](https://vercel.com/docs/errors/deployment_disabled)
- [Cloudflare OpenNext](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)
- [Cloudflare Free上限: 10万リクエスト/日、CPU 10ms/リクエスト](https://developers.cloudflare.com/workers/platform/limits/)

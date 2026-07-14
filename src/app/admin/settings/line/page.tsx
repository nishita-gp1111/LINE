import Link from "next/link";
import ConnectionActions from "@/app/admin/settings/line/connection-actions";
import { getServerEnv } from "@/lib/env/server";
import { getWebhookMetrics } from "@/lib/contacts/queries";
import { getWebhookUrl } from "@/lib/line/webhook-url";

function formatDate(value: string | null, timezone: string): string {
  if (!value) return "未受信";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone
  }).format(new Date(value));
}

export default async function LineSettingsPage() {
  const env = getServerEnv();
  const metrics = await getWebhookMetrics();
  const webhookUrl = getWebhookUrl(env.NEXT_PUBLIC_APP_URL);
  const liveReady = Boolean(
    env.LINE_CHANNEL_ID && env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN
  );
  const configuration = [
    { label: "Channel ID", configured: Boolean(env.LINE_CHANNEL_ID) },
    { label: "Channel Secret", configured: Boolean(env.LINE_CHANNEL_SECRET) },
    { label: "Channel Access Token", configured: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN) }
  ];

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/admin" className="text-sm font-bold text-moss hover:underline">
          ← 管理画面
        </Link>
        <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-moss">LINE connection</p>
            <h1 className="mt-2 text-3xl font-black">LINE接続状態</h1>
          </div>
          <span className="rounded-full border border-line bg-white px-3 py-2 text-sm font-bold">
            {env.MOCK_LINE_API ? "mock mode" : "live mode"}
          </span>
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-5">
          <article className="rounded-xl border border-line bg-white p-5">
            <p className="text-xs font-bold text-ink/50">Environment</p>
            <p className="mt-3 text-lg font-black text-moss">{env.APP_ENV}</p>
          </article>
          <article className="rounded-xl border border-line bg-white p-5">
            <p className="text-xs font-bold text-ink/50">Mode</p>
            <p className="mt-3 text-lg font-black text-moss">{env.MOCK_LINE_API ? "Mock" : "Live"}</p>
          </article>
          {configuration.map(({ label, configured }) => (
            <article key={label} className="rounded-xl border border-line bg-white p-5">
              <p className="text-xs font-bold text-ink/50">{label}</p>
              <p className={`mt-3 text-lg font-black ${configured ? "text-moss" : "text-coral"}`}>
                {configured ? "設定済み" : "未設定"}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-4 rounded-xl border border-line bg-white p-6">
          <div>
            <p className="text-xs font-bold text-ink/50">Webhook URL</p>
            <code className="mt-2 block break-all rounded-lg bg-paper px-3 py-2 text-sm">{webhookUrl}</code>
          </div>
          <div>
            <p className="text-xs font-bold text-ink/50">接続状態</p>
            <p className="mt-2 font-bold">
              {env.MOCK_LINE_API
                ? "mock modeでWebhook処理を確認できます。接続確認はURL到達のみ行います。"
                : liveReady
                  ? "設定済み（接続テストによるメッセージ送信は行っていません）"
                  : "LINE環境変数が不足しています。"}
            </p>
          </div>
        </section>

        <ConnectionActions webhookUrl={webhookUrl} />

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <article className="rounded-xl border border-line bg-white p-6">
            <p className="text-xs font-bold text-ink/50">Webhook Verify手順</p>
            <h2 className="mt-2 text-xl font-black">LINE Developers Consoleでの確認</h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-ink/75">
              <li>対象ProviderのMessaging API channelを開き、Messaging APIタブを表示します。</li>
              <li>本番コード・DB・環境変数の準備完了後にだけ、Webhook URLへ上記URLを登録し、「Use webhook」を有効にします。</li>
              <li>Webhook URL欄の「Verify」を押します。LINE Platformが署名付きリクエストを送り、HTTP 200を確認します。</li>
              <li>この画面の「接続確認」で、接続先アカウント、未署名401、不正署名401、正しい署名200まで個別に確認します。</li>
            </ol>
            <a className="mt-5 inline-block text-sm font-bold text-moss hover:underline" href="https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/" target="_blank" rel="noreferrer">
              LINE公式: Verify webhook URL →
            </a>
          </article>
          <article className="rounded-xl border border-line bg-white p-6">
            <p className="text-xs font-bold text-ink/50">LINE Developers Consoleで設定する内容</p>
            <h2 className="mt-2 text-xl font-black">Minimum Production Launch設定</h2>
            <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-ink/75">
              <li>Messaging APIタブ: Webhook URLを設定し、「Use webhook」をONにします。</li>
              <li>再送を利用する場合は「Webhook redelivery」をONにします。本システムはwebhookEventIdで重複排除します。</li>
              <li>Basic settings: Channel Secretを本番環境のsecretへ登録します。画面には値を表示しません。</li>
              <li>Messaging API settings: Channel access tokenを発行し、本番環境のsecretへ登録します。</li>
              <li>CRM側の個別処理と重複しないよう、Greeting messages / Auto-reply messagesはOFFにします。</li>
            </ul>
            <a className="mt-5 inline-block text-sm font-bold text-moss hover:underline" href="https://developers.line.biz/en/docs/messaging-api/receiving-messages/" target="_blank" rel="noreferrer">
              LINE公式: Receive messages (webhook) →
            </a>
          </article>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-4">
          {[
            ["最終Webhook受信", formatDate(metrics.lastWebhookAt, env.APP_TIMEZONE)],
            ["最終正常処理", formatDate(metrics.lastProcessedAt, env.APP_TIMEZONE)],
            ["直近の失敗件数", String(metrics.failedCount)],
            ["署名エラー件数", String(metrics.signatureErrorCount)]
          ].map(([label, value]) => (
            <article key={label} className="rounded-xl border border-line bg-white p-5">
              <p className="text-xs font-bold text-ink/50">{label}</p>
              <p className="mt-3 text-sm font-black">{value}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

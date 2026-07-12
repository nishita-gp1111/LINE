import Link from "next/link";
import { getServerEnv } from "@/lib/env/server";
import { getWebhookMetrics } from "@/lib/contacts/queries";

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
  const webhookUrl = env.NEXT_PUBLIC_APP_URL
    ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/line/webhook`
    : "/api/line/webhook";
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

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
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
                ? "mock modeで署名検証・Webhook処理を確認できます。"
                : liveReady
                  ? "設定済み（接続テストによるメッセージ送信は行っていません）"
                  : "LINE環境変数が不足しています。"}
            </p>
          </div>
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

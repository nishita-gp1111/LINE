"use client";

import { useState } from "react";
import type { ConnectionCheck, LineConnectionTestResult } from "@/lib/line/connection-test";

type Props = { webhookUrl: string };

function statusLabel(status: ConnectionCheck["status"]): string {
  if (status === "ok") return "OK";
  if (status === "ng") return "NG";
  if (status === "warn") return "確認要";
  return "対象外";
}

function statusClass(status: ConnectionCheck["status"]): string {
  if (status === "ok") return "text-moss";
  if (status === "ng") return "text-coral";
  return "text-ink/55";
}

export default function LineConnectionActions({ webhookUrl }: Props) {
  const [copyMessage, setCopyMessage] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<LineConnectionTestResult | null>(null);
  const [error, setError] = useState<string>("");

  async function copyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopyMessage("コピーしました");
    } catch {
      setCopyMessage("コピーできませんでした。URLを選択してコピーしてください。");
    }
  }

  async function runConnectionTest() {
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/line/connection-test", { method: "POST" });
      const body = (await response.json()) as LineConnectionTestResult & { error?: string };
      if (!response.ok || !body.checks) {
        setResult(null);
        setError(body.error || "接続確認に失敗しました。");
        return;
      }
      setResult(body);
    } catch {
      setResult(null);
      setError("接続確認に失敗しました。ネットワークを確認してください。");
    } finally {
      setChecking(false);
    }
  }

  const checks: Array<{ label: string; check: ConnectionCheck }> = result
    ? [
        { label: "Environment", check: result.checks.environment },
        { label: "LINE API", check: result.checks.lineApi },
        { label: "Webhook到達", check: result.checks.webhook },
        { label: "署名保護", check: result.checks.signatureProtection }
      ]
    : [];

  return (
    <section className="mt-6 rounded-xl border border-line bg-white p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-bold text-ink/50">Webhook疎通確認</p>
          <h2 className="mt-2 text-xl font-black">接続確認</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
            Environment、LINE API、Webhook到達、署名保護を個別に確認します。Webhookには署名なしのプローブを送り、秘密情報やLINE APIのレスポンス本文は表示しません。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={copyWebhookUrl} className="focus-ring min-h-10 rounded-lg border border-line bg-paper px-4 text-sm font-bold">
            Webhook URLをコピー
          </button>
          <button type="button" onClick={runConnectionTest} disabled={checking} className="focus-ring min-h-10 rounded-lg bg-ink px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-50">
            {checking ? "確認中…" : "接続確認"}
          </button>
        </div>
      </div>
      {copyMessage ? <p className="mt-3 text-sm font-bold text-moss" aria-live="polite">{copyMessage}</p> : null}
      {error ? <p className="mt-4 rounded-lg bg-coral/10 p-3 text-sm font-bold text-coral" role="alert">{error}</p> : null}
      {result ? (
        <div className="mt-5 rounded-lg border border-line bg-paper p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-black">結果: <span className={result.ok ? "text-moss" : "text-coral"}>{result.ok ? "OK" : "NG"}</span></p>
            <p className="text-xs font-bold text-ink/55">Environment: {result.environment} / {result.mode === "mock" ? "Mock Mode" : "Live Mode"}</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {checks.map(({ label, check }) => (
              <article key={label} className="rounded-lg border border-line bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-ink/60">{label}</p>
                  <span className={`text-sm font-black ${statusClass(check.status)}`}>{statusLabel(check.status)}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-ink/65">{check.detail}</p>
              </article>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-ink/60">
            {result.mode === "live"
              ? "Live modeの署名付き確認は、LINE Developers ConsoleのWebhook URL欄にあるVerifyを実行してください。未署名プローブのHTTP 401は署名保護として正常です。"
              : "Mock modeではWebhook URLの到達確認のみを行い、LINE APIと署名保護の確認は対象外です。"}
          </p>
        </div>
      ) : null}
    </section>
  );
}

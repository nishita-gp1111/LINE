"use client";

import type { Liff } from "@line/liff";
import { useCallback, useEffect, useRef, useState } from "react";
import { acquisitionRouteBySlug, type AcquisitionRouteSlug } from "@/lib/acquisition/routes";

type SourceSlug = AcquisitionRouteSlug;

type ViewState =
  | { phase: "loading" | "friendship" | "saving"; title: string; detail: string; source?: SourceSlug }
  | { phase: "success"; source: SourceSlug; tagName: string; duplicate: boolean }
  | { phase: "friend_required"; source: SourceSlug }
  | { phase: "fallback"; title: string; detail: string; source?: SourceSlug };

type ClaimResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  tagName?: string;
  duplicate?: boolean;
};

class AcquisitionUiError extends Error {}

export function LiffAcquisitionClient({
  liffId,
  friendUrl,
  fallbackMessageUrls
}: {
  liffId: string;
  friendUrl: string;
  fallbackMessageUrls: Partial<Record<SourceSlug, string>>;
}) {
  const started = useRef(false);
  const liffRef = useRef<Liff | null>(null);
  const [state, setState] = useState<ViewState>({
    phase: "loading",
    title: "LINEを確認しています",
    detail: "この画面を閉じずに、そのままお待ちください。"
  });

  const begin = useCallback(async () => {
    if (!liffId) {
      setState({
        phase: "fallback",
        title: "登録機能を準備中です",
        detail: "恐れ入りますが、元のページからLINEを開いてください。"
      });
      return;
    }

    let source: SourceSlug | undefined;
    try {
      setState({
        phase: "loading",
        title: "LINEを確認しています",
        detail: "この画面を閉じずに、そのままお待ちください。"
      });
      const { default: liff } = await import("@line/liff");
      liffRef.current = liff;
      await liff.init({ liffId, withLoginOnExternalBrowser: true });

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const route = acquisitionRouteBySlug(new URLSearchParams(window.location.search).get("source") || "");
      if (!route) {
        setState({
          phase: "fallback",
          title: "案内元を確認できませんでした",
          detail: "最初に開いた案内ページへ戻り、もう一度お試しください。"
        });
        return;
      }
      source = route.slug;

      let friendship = await liff.getFriendship();
      if (!friendship.friendFlag) {
        if (!liff.isApiAvailable("requestFriendship")) {
          setState({
            phase: "fallback",
            title: "LINEアプリの更新が必要です",
            detail: "下の予備ボタンから友だち追加後、入力済みメッセージを送ると登録できます。",
            source
          });
          return;
        }
        setState({
          phase: "friendship",
          title: "友だち追加をお願いします",
          detail: "表示されるLINEの確認画面で、友だち追加を選んでください。",
          source
        });
        await liff.requestFriendship();
        friendship = await liff.getFriendship();
      }

      if (!friendship.friendFlag) {
        setState({ phase: "friend_required", source });
        return;
      }

      const idToken = liff.getIDToken();
      const accessToken = liff.getAccessToken();
      if (!idToken || !accessToken) {
        throw new AcquisitionUiError("LINEの認証情報を取得できませんでした。もう一度お試しください。");
      }

      setState({
        phase: "saving",
        title: "登録を仕上げています",
        detail: "友だち追加を確認できました。あと少しで完了します。",
        source
      });
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch("/api/line/acquisition/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source, idToken, accessToken }),
          cache: "no-store",
          signal: controller.signal
        });
      } finally {
        window.clearTimeout(timeout);
      }
      const result = await response.json().catch(() => ({})) as ClaimResponse;
      if (!response.ok || result.ok !== true || !result.tagName) {
        if (response.status === 409 && result.code === "friendship_required") {
          setState({ phase: "friend_required", source });
          return;
        }
        throw new AcquisitionUiError(result.error || "登録を完了できませんでした。");
      }
      setState({
        phase: "success",
        source,
        tagName: result.tagName,
        duplicate: result.duplicate === true
      });
    } catch (error) {
      setState({
        phase: "fallback",
        title: "自動登録を完了できませんでした",
        detail: error instanceof AcquisitionUiError
          ? error.message
          : "LINEの確認に失敗しました。再試行するか、下の予備ボタンから登録してください。",
        source
      });
    }
  }, [liffId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  function closeWindow() {
    const liff = liffRef.current;
    if (liff?.isInClient()) {
      liff.closeWindow();
      return;
    }
    if (friendUrl) window.location.assign(friendUrl);
  }

  const route = state.source ? acquisitionRouteBySlug(state.source) : null;
  const messageUrl = state.source ? fallbackMessageUrls[state.source] : undefined;

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,_#eafff1_0,_#f7fbf8_48%,_#edf3ef_100%)] px-4 py-8 text-slate-900">
      <section className="w-full max-w-md overflow-hidden rounded-[28px] border border-emerald-950/10 bg-white shadow-[0_24px_70px_rgba(20,83,45,0.14)]">
        <div className="bg-[#06c755] px-6 pb-7 pt-7 text-center text-white">
          <div className="mx-auto grid size-16 place-items-center rounded-[22px] bg-white shadow-lg shadow-emerald-950/15" aria-hidden="true">
            <svg viewBox="0 0 48 48" className="size-10 fill-[#06c755]">
              <path d="M42 21.1C42 11.7 33.9 4 24 4S6 11.7 6 21.1c0 8.4 6.7 15.5 15.7 16.9.6.1 1.4.4 1.6.9.2.4.1 1.1.1 1.5l-.3 2.8c-.1.8-.4 3.1 2.7 1.7 3.1-1.3 16.7-9.8 16.7-23.8H42Z" />
            </svg>
          </div>
          <p className="mt-4 text-xs font-bold tracking-[0.18em] text-white/80">GP PRモニター窓口</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            {state.phase === "success" ? "登録が完了しました" : "友だち追加を確認"}
          </h1>
        </div>

        <div className="px-6 py-7 text-center sm:px-8">
          {route ? <p className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{route.label}</p> : null}

          {state.phase === "loading" || state.phase === "friendship" || state.phase === "saving" ? (
            <StatusPanel title={state.title} detail={state.detail} />
          ) : null}

          {state.phase === "success" ? (
            <div className="mt-2">
              <div className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700" aria-hidden="true">✓</div>
              <h2 className="mt-5 text-xl font-black">ありがとうございます！</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">ご案内経路を登録しました。メッセージを送る必要はありません。</p>
              <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">登録タグ: {state.tagName}</p>
              <button type="button" onClick={closeWindow} className="focus-ring mt-6 min-h-14 w-full rounded-2xl bg-[#06c755] px-5 py-4 text-base font-black text-white">LINEに戻る</button>
            </div>
          ) : null}

          {state.phase === "friend_required" ? (
            <div className="mt-2">
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-amber-100 text-2xl" aria-hidden="true">👋</div>
              <h2 className="mt-5 text-xl font-black">友だち追加を完了してください</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">追加をキャンセルした場合は、もう一度確認ボタンを押してください。</p>
              <button type="button" onClick={() => void begin()} className="focus-ring mt-6 min-h-14 w-full rounded-2xl bg-[#06c755] px-5 py-4 text-base font-black text-white">もう一度確認する</button>
              <FallbackLinks friendUrl={friendUrl} messageUrl={messageUrl} />
            </div>
          ) : null}

          {state.phase === "fallback" ? (
            <div className="mt-2">
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-amber-100 text-2xl" aria-hidden="true">!</div>
              <h2 className="mt-5 text-xl font-black">{state.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{state.detail}</p>
              <button type="button" onClick={() => void begin()} className="focus-ring mt-6 min-h-12 w-full rounded-2xl border border-emerald-600 bg-white px-5 py-3 text-sm font-black text-emerald-700">自動登録を再試行</button>
              <FallbackLinks friendUrl={friendUrl} messageUrl={messageUrl} />
            </div>
          ) : null}

          <p className="mt-6 text-[11px] leading-5 text-slate-400">LINEが発行した認証情報は、友だち状態と登録先をサーバーで確認するためだけに使用し、画面やログには表示しません。</p>
        </div>
      </section>
    </main>
  );
}

function StatusPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-5">
      <span className="mx-auto block size-11 animate-spin rounded-full border-4 border-emerald-100 border-t-[#06c755]" aria-hidden="true" />
      <h2 className="mt-5 text-xl font-black">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{detail}</p>
    </div>
  );
}

function FallbackLinks({ friendUrl, messageUrl }: { friendUrl: string; messageUrl?: string }) {
  if (!friendUrl && !messageUrl) return null;
  return (
    <details className="mt-5 rounded-2xl bg-slate-50 px-4 py-1 text-left text-sm">
      <summary className="focus-ring flex min-h-12 items-center justify-between rounded-xl font-bold text-slate-700">予備の登録方法<span aria-hidden="true">＋</span></summary>
      <div className="border-t border-slate-200 pb-4 pt-4">
        <div className="grid gap-2">
          {friendUrl ? <a href={friendUrl} className="focus-ring rounded-xl border border-[#06c755] bg-white px-4 py-3 text-center text-sm font-black text-[#079447]">1. 友だち追加画面を開く</a> : null}
          {messageUrl ? <a href={messageUrl} className="focus-ring rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-black text-slate-700">2. 入力済みメッセージを送る</a> : null}
        </div>
      </div>
    </details>
  );
}

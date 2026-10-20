"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

export function InboxSync({ revision, userKey }: { revision: string | null; userKey: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("同期を確認中");
  const renderedRevision = useRef(revision);
  const refreshing = useRef(false);
  const retry = useRef<() => void>(() => {});
  useEffect(() => { renderedRevision.current = revision; }, [revision]);
  useEffect(() => { refreshing.current = pending; }, [pending]);

  useEffect(() => {
    let stopped = false;
    let active = false;
    let wakeAgain = false;
    let lastRefresh = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(() => void poll(), delay);
    };
    async function poll(force = false) {
      if (stopped || document.visibilityState !== "visible") return;
      if (active) { wakeAgain ||= force; return; }
      // Coalesce overlapping focus/visibility signals and in-flight RSC refreshes.
      if (refreshing.current && Date.now() - lastRefresh < 15_000) { schedule(1_000); return; }
      clearTimeout(timer);
      active = true;
      let delay = 5_000;
      try {
        const response = await fetch("/api/inbox/sync", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        if (stopped) return;
        // An auth service interruption can also return 401. Keep retrying slowly
        // so an otherwise valid session does not require a browser reload.
        if (response.status === 401) { setStatus("ログイン状態を再確認中"); delay = 30_000; return; }
        if (!response.ok) throw new Error("sync_failed");
        const result = await response.json() as { revision?: unknown };
        if (typeof result.revision !== "string" || !/^[a-f0-9]{64}$/.test(result.revision)) throw new Error("invalid_revision");
        if (stopped || document.visibilityState !== "visible") return;
        // Acknowledge changes only when refreshed server props reach this browser.
        // Periodic reconciliation also catches late commits / equal timestamps.
        if (force || result.revision !== renderedRevision.current || Date.now() - lastRefresh >= 60_000) {
          lastRefresh = Date.now();
          refreshing.current = true;
          setStatus("トークを更新中");
          startTransition(() => router.refresh());
        } else setStatus("自動更新中（約5秒ごと）");
      } catch {
        if (!stopped) { setStatus("通信を再確認中・自動で再接続します"); delay = 10_000; }
      } finally {
        active = false;
        if (wakeAgain && !stopped) { wakeAgain = false; void poll(true); }
        else schedule(delay);
      }
    }
    const wake = () => { if (document.visibilityState === "visible") void poll(true); else clearTimeout(timer); };
    retry.current = () => void poll(true);
    void poll();
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true; clearTimeout(timer); controller.abort(); retry.current = () => {};
      window.removeEventListener("focus", wake); window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [router, userKey]);

  return <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-ink/50">
    <span role="status" aria-label="トーク同期状態">{pending ? "トークを更新中" : status}{status === "ログイン状態を再確認中" ? <> · <Link href="/login" className="underline">再ログイン</Link></> : null}</span>
    <button type="button" onClick={() => retry.current()} disabled={pending} className="focus-ring shrink-0 rounded px-1.5 py-1 font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">今すぐ更新</button>
  </div>;
}

"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { notificationText, type InboxNotification, type InboxNotificationFeed } from "@/lib/notifications/inbox-feed";

export function InboxNotifications({ userKey }: { userKey: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const [connection, setConnection] = useState("新着を確認中");
  const [toast, setToast] = useState<InboxNotification | null>(null);
  const settingKey = `line-crm:desktop-notifications:${userKey}`;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function syncPermission() {
      const current = "Notification" in window ? Notification.permission : "unsupported";
      setPermission(current);
      let optedIn = false;
      try { optedIn = localStorage.getItem(settingKey) === "on"; } catch { /* Storage is optional. */ }
      enabledRef.current = current === "granted" && optedIn;
      setEnabled(enabledRef.current);
    }
    syncPermission();
    window.addEventListener("focus", syncPermission);
    window.addEventListener("storage", syncPermission);
    return () => { window.removeEventListener("focus", syncPermission); window.removeEventListener("storage", syncPermission); };
  }, [settingKey]);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) { if (!panel.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8_000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let stopped = false;
    let active = false;
    let cursor = "";
    let scope = "";
    let timer: ReturnType<typeof setTimeout>;
    const seen = new Set<string>();
    const controller = new AbortController();
    const desktop = new Set<Notification>();
    async function notify(item: InboxNotification, currentScope: string) {
      if (!enabledRef.current || !("Notification" in window) || Notification.permission !== "granted" || stopped) return;
      const show = () => {
        if (stopped || currentScope !== scope) return;
        const key = `line-crm:notified:${currentScope}`;
        try {
          const ids: string[] = JSON.parse(localStorage.getItem(key) || "[]") as string[];
          if (Array.isArray(ids) && ids.includes(item.id)) return;
          localStorage.setItem(key, JSON.stringify([...(Array.isArray(ids) ? ids : []), item.id].slice(-200)));
        } catch { /* Notifications still work if storage is disabled. */ }
        try {
          // No message body/photo appears on the OS lock screen.
          const notification = new Notification(`${item.displayName}さんからLINE`, { body: notificationText(item.messageType), tag: `line-crm:${item.id}` });
          desktop.add(notification);
          notification.onclick = () => { window.focus(); router.push(`/admin/inbox?conversation=${encodeURIComponent(item.conversationId)}`); notification.close(); setOpen(false); };
          notification.onclose = () => desktop.delete(notification);
        } catch { setConnection("画面内通知は有効・このブラウザではデスクトップ通知を表示できません"); }
      };
      // Same shared login with multiple tabs: one OS notification per message/device.
      if (navigator.locks) await navigator.locks.request(`line-crm-notify:${currentScope}`, show);
      else show();
    }
    async function poll() {
      if (stopped || active) return;
      clearTimeout(timer);
      active = true;
      let delay = 8_000;
      try {
        const response = await fetch(`/api/inbox/notifications${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        if (response.status === 401) { stopped = true; setItems([]); setUnseen(0); setToast(null); desktop.forEach(item => item.close()); setConnection("再ログインが必要です"); return; }
        if (!response.ok) throw new Error("poll_failed");
        const result = await response.json() as InboxNotificationFeed;
        if (stopped) return;
        if (scope && result.scope !== scope) { cursor = ""; scope = result.scope; seen.clear(); setItems([]); setUnseen(0); setToast(null); delay = 250; return; }
        scope = result.scope;
        cursor = result.cursor;
        setConnection("新着通知を受信中");
        const fresh = result.items.filter(item => !seen.has(item.id));
        fresh.forEach(item => seen.add(item.id));
        if (seen.size > 500) { const keep = [...seen].slice(-200); seen.clear(); keep.forEach(id => seen.add(id)); }
        if (fresh.length) {
          setItems(previous => [...fresh].reverse().concat(previous).slice(0, 30));
          setUnseen(count => count + fresh.length);
          setToast(fresh.at(-1)!);
          for (const item of fresh) void notify(item, result.scope);
          if (pathnameRef.current === "/admin/inbox") router.refresh();
        }
        if (result.hasMore) delay = 250;
      } catch { if (!stopped) { setConnection("接続を再確認中…"); delay = 15_000; } }
      finally { active = false; if (!stopped) timer = setTimeout(() => void poll(), delay); }
    }
    const wake = () => { if (document.visibilityState === "visible") void poll(); };
    void poll();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); desktop.forEach(item => item.close()); window.removeEventListener("online", wake); document.removeEventListener("visibilitychange", wake); };
  }, [userKey, router]);

  async function toggleDesktop() {
    if (!("Notification" in window)) return;
    try {
      const nextPermission = enabled ? Notification.permission : await Notification.requestPermission();
      setPermission(nextPermission);
      const next = !enabled && nextPermission === "granted";
      enabledRef.current = next; setEnabled(next);
      try { localStorage.setItem(settingKey, next ? "on" : "off"); } catch { /* Optional preference persistence. */ }
    } catch { setPermission("unsupported"); }
  }
  return <div ref={panel} className="relative mx-2 shrink-0">
    <button type="button" aria-label={unseen ? `新着通知 ${unseen}件` : "新着通知"} aria-expanded={open} aria-controls="inbox-notification-panel" onClick={() => { setOpen(value => !value); setUnseen(0); }} className="focus-ring relative flex h-10 items-center gap-1 rounded-xl border border-line bg-white px-3 text-xs font-bold hover:bg-emerald-50">
      <span aria-hidden="true">🔔</span><span className="hidden lg:inline">通知</span>{unseen > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] text-white">{unseen > 99 ? "99+" : unseen}</span> : null}
    </button>
    {open ? <section id="inbox-notification-panel" aria-label="新着LINE通知" className="fixed right-3 top-[70px] z-50 w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-line bg-white shadow-xl sm:absolute sm:right-0 sm:top-12">
      <div className="border-b border-line p-4"><h2 className="text-sm font-black">新着LINE通知</h2><p role="status" className="mt-1 text-xs text-ink/50">{connection}</p>
        <p className="mt-3 text-xs leading-5 text-ink/65">管理画面を開いている間、すべてのお客様からの新着をお知らせします。</p>
        {permission === "unsupported" ? <p className="mt-2 text-xs text-ink/55">この端末では画面内通知をご利用ください。</p> : <button type="button" disabled={permission === "denied"} onClick={() => void toggleDesktop()} className="focus-ring mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">{enabled ? "デスクトップ通知をOFFにする" : "デスクトップ通知をONにする"}</button>}
        {permission === "denied" ? <p className="mt-2 text-xs text-ink/55">ブラウザのサイト設定で通知を許可すると、デスクトップ通知を使えます。画面内通知は有効です。</p> : null}
        <p className="mt-2 text-[10px] leading-4 text-ink/45">通知許可は端末ごとに必要です。画面を閉じている間や端末のスリープ中は通知されません。</p>
      </div>
      <div className="max-h-80 overflow-y-auto">{items.length ? items.map(item => <Link key={item.id} href={`/admin/inbox?conversation=${encodeURIComponent(item.conversationId)}`} onClick={() => { setOpen(false); setToast(null); }} className="block border-b border-line/60 px-4 py-3 hover:bg-emerald-50"><p className="truncate text-xs font-black">{item.displayName}</p><p className="mt-1 text-xs text-ink/60">{notificationText(item.messageType)}</p><time className="mt-1 block text-[10px] text-ink/40">{new Date(item.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })}</time></Link>) : <p className="p-6 text-center text-xs text-ink/45">この画面を開いてからの新着はありません</p>}</div>
    </section> : null}
    {toast && !open ? <div role="status" className="fixed bottom-5 right-3 z-50 flex w-80 max-w-[calc(100vw-24px)] items-start gap-3 rounded-2xl border border-emerald-200 bg-white p-4 shadow-xl">
      <Link className="min-w-0 flex-1" href={`/admin/inbox?conversation=${encodeURIComponent(toast.conversationId)}`} onClick={() => setToast(null)}><p className="truncate text-sm font-black">{toast.displayName}さんからLINE</p><p className="mt-1 text-xs text-ink/60">{notificationText(toast.messageType)} → トークを開く</p></Link><button type="button" aria-label="通知を閉じる" onClick={() => setToast(null)} className="focus-ring px-2 text-ink/45">×</button>
    </div> : null}
  </div>;
}

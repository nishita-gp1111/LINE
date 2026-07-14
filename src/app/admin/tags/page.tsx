"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useEffect, useState } from "react";

type Tag = { id: string; name: string; isActive: boolean };

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const response = await fetch("/api/milestone3/foundation?resource=tags");
    const data = await response.json() as { tags?: Tag[] };
    setTags(data.tags ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    if (!name.trim()) return;
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/milestone3/foundation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tag_create", name })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || `「${name.trim()}」を作成しました。`);
      if (!data.error) { setName(""); await load(); }
    } finally { setWorking(false); }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">顧客分類</span><h1 className="mt-2 text-3xl font-black tracking-tight">タグ管理</h1><p className="mt-1 text-sm text-ink/55">顧客の分類、自動メッセージ、リッチメニュー切替に使うラベルです。</p></div>
          <Link href="/admin/inbox" className="focus-ring rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm">顧客へタグを付ける →</Link>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">New tag</p>
            <h2 className="mt-1 text-lg font-black">新しいタグを作成</h2>
            <p className="mt-2 text-xs leading-5 text-ink/45">用途が一目で分かる短い名前がおすすめです。例：Web広告、既存顧客、資料請求</p>
            <div className="mt-5 flex gap-2">
              <input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder="例：Web広告" className="focus-ring min-h-12 min-w-0 flex-1 rounded-xl border border-line px-3 text-sm" />
              <button type="button" onClick={() => void create()} disabled={working || !name.trim()} className="focus-ring rounded-xl bg-[#263331] px-5 text-sm font-black text-white disabled:opacity-35">{working ? "作成中…" : "作成"}</button>
            </div>
            {message ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs font-bold text-emerald-800">{message}</p> : null}
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-line bg-[#fafcfb] px-5 py-4 sm:px-6"><div><h2 className="text-lg font-black">利用中のタグ</h2><p className="mt-1 text-xs text-ink/40">{tags.length}件</p></div><span className="text-2xl">🏷</span></div>
            <div className="grid gap-2 p-5 sm:grid-cols-2 sm:p-6">
              {tags.map((tag) => <div key={tag.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3"><div className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full bg-emerald-500" /><span className="truncate text-sm font-black text-emerald-900">{tag.name}</span></div><span className="shrink-0 rounded-full bg-white px-2 py-1 text-[9px] font-black text-emerald-700">{tag.isActive ? "有効" : "無効"}</span></div>)}
              {!tags.length ? <div className="col-span-full grid min-h-36 place-items-center text-center"><div><p className="text-3xl">🏷</p><p className="mt-2 text-sm font-bold text-ink/50">タグはまだありません</p></div></div> : null}
            </div>
          </section>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          {[{ number: "1", title: "顧客へ手動付与", note: "1対1トーク右側の「タグ」から選択", href: "/admin/inbox" }, { number: "2", title: "回答で自動付与", note: "アンケートの回答ボタンごとに選択", href: "/admin/surveys" }, { number: "3", title: "次の処理へ連動", note: "即時メッセージ・個別リッチメニュー", href: "/admin/automations" }].map((item) => <Link key={item.number} href={item.href} className="rounded-xl border border-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-emerald-600 text-xs font-black text-white">{item.number}</span><h3 className="text-sm font-black">{item.title}</h3></div><p className="mt-2 pl-9 text-xs leading-5 text-ink/45">{item.note}</p></Link>)}
        </section>
      </div>
    </main>
  );
}

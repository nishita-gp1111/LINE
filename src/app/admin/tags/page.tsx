"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useEffect, useState } from "react";
import { TagDeleteDialog } from "@/components/tag-delete-dialog";

type Tag = { id: string; name: string; isActive: boolean };

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoadError("");
      const response = await fetch("/api/milestone3/foundation?resource=tags");
      const data = await response.json() as { tags?: Tag[]; canDelete?: boolean };
      if (!response.ok) throw new Error("タグを取得できませんでした。再読み込みしてください。");
      setTags(data.tags ?? []); setCanDelete(data.canDelete === true);
    } catch { setLoadError("タグを取得できませんでした。再読み込みしてください。"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    if (!name.trim() || working) return;
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/milestone3/foundation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tag_create", name })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "タグを作成できませんでした。");
      setMessage(`「${name.trim()}」を作成しました。`);
      setName(""); await load();
    } catch (error) { setLoadError(error instanceof Error ? error.message : "通信に失敗しました。");
    } finally { setWorking(false); }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">顧客分類</span><h1 className="mt-2 text-3xl font-black tracking-tight">タグ管理</h1><p className="mt-1 text-sm text-ink/55">顧客の分類、自動メッセージ、リッチメニュー切替に使うラベルです。</p></div>
          <Link href="/admin/inbox" className="focus-ring rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm">顧客へタグを付ける →</Link>
        </header>
        {message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{message}</p> : null}
        {loadError ? <div role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{loadError} <button type="button" onClick={() => void load()} className="focus-ring underline">再読み込み</button></div> : null}
        {deleteTarget ? <TagDeleteDialog key={deleteTarget.id} tag={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => {
          setTags(current => current.filter(tag => tag.id !== deleteTarget.id));
          setMessage(`「${deleteTarget.name}」を削除しました。`); setDeleteTarget(null); void load();
        }} /> : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">New tag</p>
            <h2 className="mt-1 text-lg font-black">新しいタグを作成</h2>
            <p className="mt-2 text-xs leading-5 text-ink/45">用途が一目で分かる短い名前がおすすめです。例：Web広告、既存顧客、資料請求</p>
            <div className="mt-5 flex gap-2">
              <input aria-label="新しいタグ名" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void create(); }} placeholder="例：Web広告" className="focus-ring min-h-12 min-w-0 flex-1 rounded-xl border border-line px-3 text-sm" />
              <button type="button" onClick={() => void create()} disabled={working || !name.trim()} className="focus-ring rounded-xl bg-[#263331] px-5 text-sm font-black text-white disabled:opacity-35">{working ? "作成中…" : "作成"}</button>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-line bg-[#fafcfb] px-5 py-4 sm:px-6"><div><h2 className="text-lg font-black">利用中のタグ</h2><p className="mt-1 text-xs text-ink/40">{tags.length}件</p></div><span className="text-2xl">🏷</span></div>
            <div className="grid gap-2 p-5 sm:grid-cols-2 sm:p-6">
              {tags.map((tag) => <div key={tag.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3"><div className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full bg-emerald-500" /><span className="break-all text-sm font-black text-emerald-900">{tag.name}</span></div>{canDelete ? <button type="button" aria-label={`「${tag.name}」を削除`} onClick={() => { setMessage(""); setDeleteTarget(tag); }} className="focus-ring min-h-11 shrink-0 rounded-lg border border-red-100 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50">削除</button> : <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[9px] font-black text-emerald-700">有効</span>}</div>)}
              {loading ? <p role="status" className="col-span-full py-8 text-center text-sm text-ink/50">タグを読み込み中…</p> : null}
              {!loading && !loadError && !tags.length ? <div className="col-span-full grid min-h-36 place-items-center text-center"><div><p className="text-3xl">🏷</p><p className="mt-2 text-sm font-bold text-ink/50">タグはまだありません</p></div></div> : null}
            </div>
            <p className="border-t border-line px-5 py-3 text-xs leading-5 text-ink/55">削除は管理者のみ可能です。アンケートや配信条件で使用中のタグは保護されます。</p>
          </section>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          {[{ number: "1", title: "顧客へ手動付与", note: "1対1トーク右側の「タグ」から選択", href: "/admin/inbox" }, { number: "2", title: "回答で自動付与", note: "アンケートの回答ボタンごとに選択", href: "/admin/surveys" }, { number: "3", title: "次の処理へ連動", note: "即時メッセージ・個別リッチメニュー", href: "/admin/automations" }].map((item) => <Link key={item.number} href={item.href} className="rounded-xl border border-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-emerald-600 text-xs font-black text-white">{item.number}</span><h3 className="text-sm font-black">{item.title}</h3></div><p className="mt-2 pl-9 text-xs leading-5 text-ink/45">{item.note}</p></Link>)}
        </section>
      </div>
    </main>
  );
}

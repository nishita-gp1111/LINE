"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { QuickReplyTemplate } from "@/lib/inbox/types";

type Props = {
  initialItems: QuickReplyTemplate[];
  draft: string;
  canManage: boolean;
  disabled: boolean;
  onInsert: (text: string) => boolean;
};

export function InboxTextTemplates({ initialItems, draft, canManage, disabled, onInsert }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  const [items, setItems] = useState(initialItems);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{ item: QuickReplyTemplate | null } | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  async function load() {
    const version = ++requestVersion.current;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/inbox/quick-replies", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { ok?: boolean; items?: QuickReplyTemplate[]; error?: string };
      if (!response.ok || !data.ok || !data.items) throw new Error(data.error || "テンプレートを読み込めませんでした。");
      if (version === requestVersion.current) setItems(data.items);
    } catch (cause) {
      if (version === requestVersion.current) {
        setItems([]);
        setError(cause instanceof Error && cause.name === "Error" ? cause.message : "読み込めませんでした。もう一度お試しください。");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  function open() {
    setSearch(""); setEditor(null); setNotice("");
    dialog.current?.showModal();
    void load();
  }

  function edit(item: QuickReplyTemplate | null) {
    setError(""); setNotice(""); setEditor({ item });
    setName(item?.name || ""); setBody(item?.textContent ?? draft);
  }

  async function save() {
    if (saving || !canManage || !editor || !name.trim() || !body.trim()) return;
    setSaving(true); setError("");
    try {
      const item = editor.item;
      const response = await fetch("/api/inbox/quick-replies", {
        method: item ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ name, textContent: body, sortOrder: item?.sortOrder ?? 0, ...(item ? { id: item.id, isActive: item.isActive } : {}) })
      });
      const data = await response.json() as { ok?: boolean; item?: QuickReplyTemplate; error?: string };
      if (!response.ok || !data.ok || !data.item) throw new Error(data.error || "保存できませんでした。");
      const saved = data.item;
      setItems(current => [...current.filter(candidate => candidate.id !== saved.id), saved].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja")));
      setEditor(null); setSearch(""); setNotice("保存しました。テンプレートを選ぶと入力欄に入ります。");
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "Error" ? cause.message : "保存結果を確認できませんでした。一覧を読み直してから再試行してください。");
    } finally { setSaving(false); }
  }

  const keyword = search.trim().toLocaleLowerCase("ja");
  const visibleItems = items.filter(item => item.isActive && `${item.name}\n${item.textContent}`.toLocaleLowerCase("ja").includes(keyword));

  return <>
    <button type="button" onClick={open} disabled={disabled} aria-haspopup="dialog" className="focus-ring rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-black text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-35">📝 テンプレート</button>
    <dialog ref={dialog} aria-labelledby="inbox-templates-title" onCancel={event => { if (saving) event.preventDefault(); }} className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-white p-5">
        <div><h2 id="inbox-templates-title" className="text-lg font-black">文章テンプレート</h2><p className="mt-1 text-xs text-ink/55">選ぶと入力欄に入ります。この操作では送信されません。</p></div>
        <button type="button" aria-label="テンプレートを閉じる" disabled={saving} onClick={() => dialog.current?.close()} className="focus-ring shrink-0 rounded-lg px-2 py-1 text-lg hover:bg-paper disabled:opacity-40">×</button>
      </div>
      <div className="p-5">
        {error ? <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
        {editor ? <form onSubmit={event => { event.preventDefault(); void save(); }} className="grid gap-4">
          <h3 className="text-sm font-black">{editor.item ? "テンプレートを編集" : "新しいテンプレート"}</h3>
          <label className="grid gap-1.5 text-xs font-bold">テンプレート名<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={saving} placeholder="例：面談のお礼" className="focus-ring min-h-11 rounded-lg border border-line px-3 text-sm font-normal" /></label>
          <label className="grid gap-1.5 text-xs font-bold">メッセージ本文<textarea required maxLength={5000} rows={7} value={body} onChange={event => setBody(event.target.value)} disabled={saving} placeholder="よく使う文章を入力してください" className="focus-ring resize-y rounded-lg border border-line p-3 text-sm font-normal" /></label>
          <p className="-mt-2 text-right text-xs text-ink/45">{body.length}/5000文字</p>
          <p className="text-xs text-ink/55">同じ組織のスタッフで共有されます。お客様の個人情報は保存しないでください。</p>
          <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => { setEditor(null); setError(""); }} className="focus-ring rounded-lg border border-line px-4 py-2 text-sm font-bold">一覧に戻る</button><button type="submit" disabled={saving || !name.trim() || !body.trim()} className="focus-ring rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">{saving ? "保存中…" : "テンプレートを保存"}</button></div>
        </form> : <>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="テンプレートを検索" value={search} onChange={event => setSearch(event.target.value)} placeholder="名前・本文で検索" className="focus-ring min-h-11 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm" />
            {canManage ? <button type="button" disabled={loading} onClick={() => edit(null)} className="focus-ring min-h-11 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-40">＋ 新規作成</button> : null}
          </div>
          {loading ? <p role="status" className="py-10 text-center text-sm text-ink/55">読み込み中…</p> : <div className="mt-4 grid gap-2">
            {visibleItems.map(item => <article key={item.id} className="overflow-hidden rounded-xl border border-line">
              <button type="button" aria-label={`${item.name}を入力欄に入れる`} disabled={disabled} onClick={() => {
                if (onInsert(item.textContent)) dialog.current?.close();
                else setError("追加すると5000文字を超えます。入力中の文章を短くしてから選んでください。");
              }} className="focus-ring block w-full p-4 text-left hover:bg-emerald-50 disabled:opacity-40">
                <span className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm font-black">{item.name}</span><span className="shrink-0 text-xs font-bold text-emerald-700">＋ 差し込む</span></span>
                <span className="mt-2 line-clamp-3 block whitespace-pre-wrap break-words text-xs leading-5 text-ink/65">{item.textContent}</span>
              </button>
              {canManage ? <div className="flex justify-end border-t border-line/60 px-3 py-1"><button type="button" aria-label={`${item.name}を編集`} onClick={() => edit(item)} className="focus-ring rounded px-2 py-1 text-xs font-bold text-ink/55 hover:bg-paper">編集</button></div> : null}
            </article>)}
            {!visibleItems.length && !error ? <p className="rounded-xl bg-paper px-4 py-8 text-center text-sm text-ink/55">{keyword ? "一致するテンプレートはありません。" : canManage ? "まだテンプレートがありません。\n「＋ 新規作成」から登録できます。" : "まだテンプレートがありません。管理者に登録を依頼してください。"}</p> : null}
          </div>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <button type="button" disabled={loading} onClick={() => void load()} className="focus-ring rounded py-2 font-bold text-ink/55">一覧を再読み込み</button>
            {canManage ? <Link href="/admin/settings/quick-replies" target="_blank" rel="noreferrer" className="font-bold text-emerald-700 hover:underline">並び順・無効化・削除 ↗</Link> : <span className="text-ink/45">作成・編集は管理者が行えます。</span>}
          </div>
        </>}
      </div>
    </dialog>
  </>;
}

"use client";

import { useState } from "react";
import type { QuickReplyTemplate } from "@/lib/inbox/types";

export default function QuickRepliesClient({ initialItems, canManage }: { initialItems: QuickReplyTemplate[]; canManage: boolean }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function create() {
    setWorking(true); setError("");
    const response = await fetch("/api/inbox/quick-replies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, textContent: text, sortOrder: Number(sortOrder) }) });
    const result = await response.json() as { ok: boolean; error?: string };
    if (!result.ok) setError(result.error || "作成できませんでした。"); else window.location.reload();
    setWorking(false);
  }

  async function remove(id: string) {
    if (!window.confirm("このクイック返信を削除しますか？")) return;
    setWorking(true); setError("");
    const response = await fetch("/api/inbox/quick-replies", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const result = await response.json() as { ok: boolean; error?: string };
    if (!result.ok) setError(result.error || "削除できませんでした。"); else window.location.reload();
    setWorking(false);
  }

  function startEdit(item: QuickReplyTemplate) {
    setEditingId(item.id); setName(item.name); setText(item.textContent); setSortOrder(String(item.sortOrder));
  }

  async function update(item: QuickReplyTemplate) {
    setWorking(true); setError("");
    const response = await fetch("/api/inbox/quick-replies", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, name, textContent: text, sortOrder: Number(sortOrder), isActive: item.isActive }) });
    const result = await response.json() as { ok: boolean; error?: string };
    if (!result.ok) setError(result.error || "更新できませんでした。"); else window.location.reload();
    setWorking(false);
  }

  async function toggle(item: QuickReplyTemplate) {
    setWorking(true); setError("");
    const response = await fetch("/api/inbox/quick-replies", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, name: item.name, textContent: item.textContent, sortOrder: item.sortOrder, isActive: !item.isActive }) });
    const result = await response.json() as { ok: boolean; error?: string };
    if (!result.ok) setError(result.error || "有効状態を更新できませんでした。"); else window.location.reload();
    setWorking(false);
  }

  return <div className="mt-8 grid gap-6"><section className="rounded-xl border border-line bg-white p-6"><h2 className="text-lg font-black">{editingId ? "クイック返信を編集" : "新規作成"}</h2><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px]"><input value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage || working} placeholder="名前" maxLength={100} className="focus-ring min-h-10 rounded border border-line px-3 text-sm" /><input value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} disabled={!canManage || working} type="number" min={0} max={10000} placeholder="順序" className="focus-ring min-h-10 rounded border border-line px-3 text-sm" /><textarea value={text} onChange={(event) => setText(event.target.value)} disabled={!canManage || working} maxLength={5000} rows={3} placeholder="送信テキスト" className="focus-ring rounded border border-line p-3 text-sm sm:col-span-2" /><button type="button" onClick={() => editingId ? update(initialItems.find((item) => item.id === editingId)!) : create()} disabled={!canManage || working || !name.trim() || !text.trim()} className="focus-ring rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40 sm:col-span-2">{editingId ? "更新" : "作成"}</button>{editingId ? <button type="button" onClick={() => { setEditingId(null); setName(""); setText(""); setSortOrder("0"); }} className="text-sm font-bold text-moss sm:col-span-2">編集をキャンセル</button> : null}</div>{!canManage ? <p className="mt-3 text-sm font-bold text-ink/55">クイック返信の管理はadmin / ownerのみ可能です。</p> : null}{error ? <p className="mt-3 text-sm font-bold text-coral">{error}</p> : null}</section><section className="rounded-xl border border-line bg-white p-6"><h2 className="text-lg font-black">一覧</h2><div className="mt-4 grid gap-3">{initialItems.map((item) => <article key={item.id} className="rounded-lg border border-line p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-black">{item.name} {!item.isActive ? <span className="ml-2 rounded bg-paper px-2 py-1 text-[10px]">無効</span> : null}</p><p className="mt-2 whitespace-pre-wrap text-sm text-ink/70">{item.textContent}</p></div><div className="text-right text-xs text-ink/55"><p>順序 {item.sortOrder}</p>{canManage ? <div className="mt-2 flex gap-2"><button type="button" onClick={() => startEdit(item)} disabled={working} className="font-bold text-moss hover:underline">編集</button><button type="button" onClick={() => toggle(item)} disabled={working} className="font-bold text-moss hover:underline">{item.isActive ? "無効化" : "有効化"}</button><button type="button" onClick={() => remove(item.id)} disabled={working} className="font-bold text-coral hover:underline">削除</button></div> : null}</div></div></article>)}{!initialItems.length ? <p className="py-8 text-center text-sm text-ink/50">登録されたクイック返信はありません。</p> : null}</div></section></div>;
}

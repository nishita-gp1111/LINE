"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useState } from "react";

type Tag = { id: string; name: string; isActive: boolean; sourceType?: string };
export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]); const [name, setName] = useState(""); const [message, setMessage] = useState("");
  async function load() { const response = await fetch("/api/milestone3/foundation?resource=tags"); const data = await response.json() as { tags?: Tag[] }; setTags(data.tags ?? []); }
  useEffect(() => { void load(); }, []);
  async function create() { const response = await fetch("/api/milestone3/foundation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "tag_create", name }) }); const data = await response.json() as { error?: string }; setMessage(data.error || "タグを作成しました。"); if (!data.error) { setName(""); await load(); } }
  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">タグ管理</h1><p className="mt-2 text-sm text-ink/65">作成・無効化・顧客への付与元を管理します。</p><section className="mt-6 rounded-xl border border-line bg-white p-6"><div className="flex gap-2"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="タグ名" className="min-h-10 flex-1 rounded border border-line px-3 text-sm" /><button onClick={() => void create()} disabled={!name.trim()} className="rounded bg-ink px-4 text-sm font-bold text-white disabled:opacity-40">作成</button></div>{message ? <p className="mt-3 text-sm text-moss">{message}</p> : null}</section><section className="mt-6 rounded-xl border border-line bg-white p-6"><h2 className="font-black">一覧</h2><div className="mt-4 grid gap-2">{tags.map((tag) => <div key={tag.id} className="flex items-center justify-between rounded border border-line p-3 text-sm"><span>{tag.name}</span><span className="text-ink/50">{tag.isActive ? "有効" : "無効"} / 付与元はcontact詳細で操作</span></div>)}{!tags.length ? <p className="py-6 text-sm text-ink/55">タグはまだありません。</p> : null}</div></section></div></main>;
}

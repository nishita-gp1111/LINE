"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useState } from "react";

type Tag = { id: string; name: string };
type Scenario = { id: string; name: string; status: string; triggerType: string };

export default function AutomationsPage() {
  const [items, setItems] = useState<Scenario[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: "", tagId: "", text: "" });
  const [message, setMessage] = useState("");

  async function load() {
    const [scenarioResponse, tagResponse] = await Promise.all([
      fetch("/api/milestone3/interactive?resource=scenarios"),
      fetch("/api/milestone3/foundation?resource=tags")
    ]);
    const scenarioData = await scenarioResponse.json() as { scenarios?: Scenario[] };
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    setItems(scenarioData.scenarios ?? []);
    setTags(tagData.tags ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    const data = await (await fetch("/api/milestone3/interactive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "scenario_create", name: form.name, tagId: form.tagId, text: form.text }) })).json() as { error?: string };
    setMessage(data.error || "タグ起点の即時メッセージを作成しました。");
    if (!data.error) { setForm({ name: "", tagId: "", text: "" }); await load(); }
  }

  async function activate(id: string) {
    const data = await (await fetch("/api/milestone3/interactive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "scenario_activate", id }) })).json() as { error?: string };
    setMessage(data.error || "automationを有効化しました。");
    await load();
  }

  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">タグ起点の即時メッセージ</h1><p className="mt-2 text-sm text-ink/65">タグ付与直後に、許可されたテストユーザーへ1通だけ送信します。時間差配信はこのローンチ対象外です。</p><section className="mt-6 rounded-xl border border-line bg-white p-6"><div className="grid gap-2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="automation名" className="rounded border border-line px-3 py-2 text-sm" /><select value={form.tagId} onChange={(event) => setForm({ ...form, tagId: event.target.value })} className="rounded border border-line px-3 py-2 text-sm"><option value="">起点タグを選択</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} placeholder="即時送信する本文" className="min-h-20 rounded border border-line px-3 py-2 text-sm" /><button onClick={() => void create()} disabled={!form.name.trim() || !form.tagId || !form.text.trim()} className="rounded bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40">作成</button></div>{message ? <p className="mt-3 text-sm text-moss">{message}</p> : null}</section><section className="mt-6 rounded-xl border border-line bg-white p-6"><h2 className="font-black">一覧</h2>{items.map((item) => <div key={item.id} className="mt-2 flex flex-wrap justify-between gap-2 rounded border border-line p-3 text-sm"><span>{item.name} / {item.triggerType} / {item.status}</span>{item.status !== "active" ? <button onClick={() => void activate(item.id)} className="font-bold text-moss">有効化</button> : null}</div>)}</section></div></main>;
}

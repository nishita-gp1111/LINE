"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useEffect, useState } from "react";

type Tag = { id: string; name: string };
type Scenario = { id: string; name: string; status: string; triggerType: string; tagId: string | null; text: string };

export default function AutomationsPage() {
  const [items, setItems] = useState<Scenario[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: "", tagId: "", text: "" });
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const [scenarioResponse, tagResponse] = await Promise.all([fetch("/api/milestone3/interactive?resource=scenarios"), fetch("/api/milestone3/foundation?resource=tags")]);
    const scenarioData = await scenarioResponse.json() as { scenarios?: Scenario[] };
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    setItems(scenarioData.scenarios ?? []);
    setTags(tagData.tags ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    setWorking(true);
    try {
      const data = await (await fetch("/api/milestone3/interactive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "scenario_create", ...form }) })).json() as { error?: string };
      setMessage(data.error || "タグ起点の即時配信を作成しました。有効化すると動作します。");
      if (!data.error) { setForm({ name: "", tagId: "", text: "" }); await load(); }
    } finally { setWorking(false); }
  }

  async function activate(id: string) {
    setWorking(true);
    try {
      const data = await (await fetch("/api/milestone3/interactive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "scenario_activate", id }) })).json() as { error?: string };
      setMessage(data.error || "即時配信を有効化しました。同じタグの旧設定は停止しました。");
      await load();
    } finally { setWorking(false); }
  }

  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">タグ起点の即時配信</h1><p className="mt-2 text-sm text-ink/65">タグが未付与から付与済みに変わった直後、その顧客へ1通送ります。同じ処理の再実行では二重送信しません。</p><section className="mt-6 rounded-xl border border-line bg-white p-6"><div className="grid gap-2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="設定名" className="rounded border border-line px-3 py-2 text-sm" /><select value={form.tagId} onChange={(event) => setForm({ ...form, tagId: event.target.value })} className="rounded border border-line px-3 py-2 text-sm"><option value="">起点タグを選択</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} maxLength={5000} placeholder="即時送信する本文" className="min-h-24 rounded border border-line px-3 py-2 text-sm" /><button onClick={() => void create()} disabled={working || !form.name.trim() || !form.tagId || !form.text.trim()} className="rounded bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40">下書きを作成</button></div>{message ? <p className="mt-3 text-sm text-moss">{message}</p> : null}</section><section className="mt-6 rounded-xl border border-line bg-white p-6"><h2 className="font-black">設定一覧</h2>{items.map((item) => <div key={item.id} className="mt-2 flex flex-wrap justify-between gap-3 rounded border border-line p-3 text-sm"><div><p className="font-bold">{item.name} / {item.status}</p><p className="mt-1 text-xs text-ink/60">{tags.find((tag) => tag.id === item.tagId)?.name || "タグ未取得"} → {item.text}</p></div>{item.status !== "active" ? <button disabled={working} onClick={() => void activate(item.id)} className="font-bold text-moss disabled:opacity-40">有効化</button> : <span className="font-bold text-moss">稼働中</span>}</div>)}</section></div></main>;
}

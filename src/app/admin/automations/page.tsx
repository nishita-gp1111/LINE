"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useEffect, useState } from "react";

type Tag = { id: string; name: string };
type Scenario = { id: string; name: string; status: "draft" | "active" | "paused"; triggerType: string; tagId: string | null; text: string };

const statusLabel: Record<Scenario["status"], string> = {
  active: "稼働中",
  paused: "無効",
  draft: "下書き"
};

export default function AutomationsPage() {
  const [items, setItems] = useState<Scenario[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: "", tagId: "", text: "" });
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);

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
    setWorking(true);
    try {
      const response = await fetch("/api/milestone3/interactive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "scenario_create", ...form })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || "タグ起点の即時配信を作成しました。有効化すると動作します。");
      if (response.ok && !data.error) {
        setForm({ name: "", tagId: "", text: "" });
        await load();
      }
    } finally {
      setWorking(false);
    }
  }

  async function changeStatus(item: Scenario, action: "scenario_activate" | "scenario_deactivate") {
    if (action === "scenario_deactivate" && !window.confirm(`「${item.name}」を無効にしますか？\n今後このタグが付いた顧客への自動送信を停止します。`)) return;
    setWorkingId(item.id);
    try {
      const response = await fetch("/api/milestone3/interactive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id: item.id })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || (action === "scenario_deactivate"
        ? "即時配信を無効にしました。今後のタグ付与では送信されません。"
        : "即時配信を有効化しました。同じタグの旧設定は停止しました。"));
      if (response.ok && !data.error) await load();
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/admin" className="text-sm text-moss">← 管理画面</Link>
        <h1 className="mt-5 text-3xl font-black">タグ起点の即時配信</h1>
        <p className="mt-2 text-sm text-ink/65">タグが未付与から付与済みに変わった直後、その顧客へ1通送ります。同じ処理の再実行では二重送信しません。</p>

        <section className="mt-6 rounded-xl border border-line bg-white p-6">
          <div className="grid gap-2">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="設定名" className="rounded border border-line px-3 py-2 text-sm" />
            <select value={form.tagId} onChange={(event) => setForm({ ...form, tagId: event.target.value })} className="rounded border border-line px-3 py-2 text-sm">
              <option value="">起点タグを選択</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
            <textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} maxLength={5000} placeholder="即時送信する本文" className="min-h-24 rounded border border-line px-3 py-2 text-sm" />
            <button onClick={() => void create()} disabled={working || Boolean(workingId) || !form.name.trim() || !form.tagId || !form.text.trim()} className="rounded bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40">下書きを作成</button>
          </div>
          {message ? <p className="mt-3 text-sm text-moss" role="status">{message}</p> : null}
        </section>

        <section className="mt-6 rounded-xl border border-line bg-white p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-black">設定一覧</h2>
            <p className="text-xs text-ink/55">無効化しても設定と送信履歴は残ります。</p>
          </div>
          {items.map((item) => {
            const active = item.status === "active";
            const busy = workingId === item.id;
            return (
              <div key={item.id} className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded border border-line p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{item.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${active ? "bg-emerald-100 text-emerald-800" : item.status === "paused" ? "bg-slate-100 text-slate-700" : "bg-amber-100 text-amber-800"}`}>{statusLabel[item.status]}</span>
                  </div>
                  <p className="mt-2 break-words text-xs leading-5 text-ink/60">{tags.find((tag) => tag.id === item.tagId)?.name || "タグ未取得"} → {item.text}</p>
                </div>
                {active ? (
                  <button disabled={Boolean(workingId) || working} onClick={() => void changeStatus(item, "scenario_deactivate")} className="rounded border border-red-200 bg-red-50 px-4 py-2 font-bold text-red-700 hover:bg-red-100 disabled:opacity-40">{busy ? "無効化中…" : "無効にする"}</button>
                ) : (
                  <button disabled={Boolean(workingId) || working} onClick={() => void changeStatus(item, "scenario_activate")} className="rounded bg-moss px-4 py-2 font-bold text-white hover:opacity-90 disabled:opacity-40">{busy ? "有効化中…" : item.status === "paused" ? "再度有効化" : "有効化"}</button>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}

"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useEffect, useState } from "react";

type Tag = { id: string; name: string };
type Survey = { id: string; name: string; status: string; question: { title: string; options: Array<{ key: string; label: string; token: string }> } };

export default function SurveysPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: "", title: "", options: "Web広告", tagId: "" });
  const [message, setMessage] = useState("");

  async function load() {
    const [surveyResponse, tagResponse] = await Promise.all([
      fetch("/api/milestone3/interactive?resource=surveys"),
      fetch("/api/milestone3/foundation?resource=tags")
    ]);
    const surveyData = await surveyResponse.json() as { surveys?: Survey[] };
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    setSurveys(surveyData.surveys ?? []);
    setTags(tagData.tags ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    const options = form.options.split(",").map((label, index) => ({ key: `option_${index + 1}`, label: label.trim(), tagId: index === 0 ? form.tagId || undefined : undefined })).filter((item) => item.label);
    const data = await (await fetch("/api/milestone3/interactive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "survey_create", name: form.name, questionTitle: form.title, options }) })).json() as { error?: string };
    setMessage(data.error || "アンケートを作成しました。");
    if (!data.error) { setForm({ name: "", title: "", options: "Web広告", tagId: "" }); await load(); }
  }

  async function send(surveyId: string) {
    const data = await (await fetch("/api/milestone3/interactive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "survey_send", surveyId }) })).json() as { error?: string };
    setMessage(data.error || "テストユーザーへアンケートを送信しました。");
  }

  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">アンケート</h1><p className="mt-2 text-sm text-ink/65">LiveではLINE_TEST_USER_IDSの1名だけへ送信します。選択肢の先頭へ回答タグを設定できます。</p><section className="mt-6 rounded-xl border border-line bg-white p-6"><div className="grid gap-2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="アンケート名" className="rounded border border-line px-3 py-2 text-sm" /><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="質問" className="rounded border border-line px-3 py-2 text-sm" /><input value={form.options} onChange={(event) => setForm({ ...form, options: event.target.value })} placeholder="選択肢をカンマ区切り" className="rounded border border-line px-3 py-2 text-sm" /><select value={form.tagId} onChange={(event) => setForm({ ...form, tagId: event.target.value })} className="rounded border border-line px-3 py-2 text-sm"><option value="">先頭の回答にタグを付与しない</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button onClick={() => void create()} disabled={!form.name || !form.title || !form.options.trim()} className="rounded bg-ink px-3 py-2 text-sm font-bold text-white disabled:opacity-40">作成</button></div>{message ? <p className="mt-3 text-sm text-moss">{message}</p> : null}</section><section className="mt-6 rounded-xl border border-line bg-white p-6"><h2 className="font-black">一覧 / テスト送信</h2>{surveys.map((survey) => <div key={survey.id} className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded border border-line p-3 text-sm"><div><p className="font-bold">{survey.name} / {survey.status}</p><p className="mt-1">{survey.question.title}: {survey.question.options.map((option) => option.label).join(", ")}</p></div><button onClick={() => void send(survey.id)} className="rounded bg-moss px-3 py-2 font-bold text-white">テストユーザーへ送信</button></div>)}</section></div></main>;
}

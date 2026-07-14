"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import Link from "next/link";
import { useEffect, useState } from "react";

type Tag = { id: string; name: string };
type Contact = { id: string; displayName: string; friendStatus: string };
type SurveyOption = { id: string; key: string; label: string; tagId: string | null };
type Survey = { id: string; name: string; status: string; sendOnFollow: boolean; question: { title: string; options: SurveyOption[] } };
type OptionForm = { key: string; label: string; tagId: string };

export default function SurveysPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [targetContactId, setTargetContactId] = useState("");
  const [form, setForm] = useState({ name: "", title: "", sendOnFollow: false });
  const [options, setOptions] = useState<OptionForm[]>([{ key: crypto.randomUUID(), label: "Web広告", tagId: "" }]);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const [surveyResponse, tagResponse, contactResponse] = await Promise.all([
      fetch("/api/milestone3/interactive?resource=surveys"),
      fetch("/api/milestone3/foundation?resource=tags"),
      fetch("/api/milestone3/interactive?resource=contacts")
    ]);
    const surveyData = await surveyResponse.json() as { surveys?: Survey[] };
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    const contactData = await contactResponse.json() as { contacts?: Contact[] };
    setSurveys(surveyData.surveys ?? []);
    setTags(tagData.tags ?? []);
    setContacts(contactData.contacts ?? []);
    if (!targetContactId && contactData.contacts?.length === 1) setTargetContactId(contactData.contacts[0].id);
  }

  useEffect(() => { void load(); }, []);

  function updateOption(key: string, patch: Partial<OptionForm>) {
    setOptions((current) => current.map((option) => option.key === key ? { ...option, ...patch } : option));
  }

  async function create() {
    setWorking(true);
    try {
      const response = await fetch("/api/milestone3/interactive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "survey_create",
          name: form.name,
          questionTitle: form.title,
          sendOnFollow: form.sendOnFollow,
          options: options.map((option, index) => ({ key: `option_${index + 1}`, label: option.label, tagId: option.tagId || undefined }))
        })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || (form.sendOnFollow ? "アンケートを作成し、友だち追加時の自動送信に設定しました。" : "アンケートを作成しました。"));
      if (!data.error) {
        setForm({ name: "", title: "", sendOnFollow: false });
        setOptions([{ key: crypto.randomUUID(), label: "Web広告", tagId: "" }]);
        await load();
      }
    } finally {
      setWorking(false);
    }
  }

  async function send(surveyId: string) {
    if (!targetContactId) return;
    setWorking(true);
    try {
      const response = await fetch("/api/milestone3/interactive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "survey_send", surveyId, contactId: targetContactId })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || "選択した顧客へアンケートを送信しました。");
    } finally {
      setWorking(false);
    }
  }

  async function setFollowSurvey(surveyId: string | null) {
    setWorking(true);
    try {
      const response = await fetch("/api/milestone3/interactive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "survey_follow_set", surveyId })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || (surveyId ? "友だち追加時に送るアンケートを設定しました。" : "友だち追加時の自動送信を解除しました。"));
      if (!data.error) await load();
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/admin" className="text-sm text-moss">← 管理画面</Link>
        <h1 className="mt-5 text-3xl font-black">アンケート</h1>
        <p className="mt-2 text-sm text-ink/65">選択肢ごとに回答タグを設定できます。手動送信に加え、1つのアンケートを友だち追加時に自動送信できます。</p>

        <section className="mt-6 rounded-xl border border-line bg-white p-6">
          <div className="grid gap-3">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="アンケート名" className="rounded border border-line px-3 py-2 text-sm" />
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="質問" className="rounded border border-line px-3 py-2 text-sm" />
            <div className="grid gap-2">
              <p className="text-xs font-bold text-ink/60">選択肢と回答タグ</p>
              {options.map((option, index) => (
                <div key={option.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input value={option.label} onChange={(event) => updateOption(option.key, { label: event.target.value })} placeholder={`選択肢 ${index + 1}`} maxLength={20} className="rounded border border-line px-3 py-2 text-sm" />
                  <select value={option.tagId} onChange={(event) => updateOption(option.key, { tagId: event.target.value })} className="rounded border border-line px-3 py-2 text-sm">
                    <option value="">タグを付与しない</option>
                    {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}を付与</option>)}
                  </select>
                  <button type="button" disabled={options.length === 1} onClick={() => setOptions((current) => current.filter((item) => item.key !== option.key))} className="rounded border border-line px-3 py-2 text-xs font-bold disabled:opacity-30">削除</button>
                </div>
              ))}
            </div>
            <button type="button" disabled={options.length >= 13} onClick={() => setOptions((current) => [...current, { key: crypto.randomUUID(), label: "", tagId: "" }])} className="rounded border border-line px-3 py-2 text-sm font-bold disabled:opacity-40">選択肢を追加</button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.sendOnFollow} onChange={(event) => setForm({ ...form, sendOnFollow: event.target.checked })} />
              このアンケートを友だち追加時に自動送信する
            </label>
            <button onClick={() => void create()} disabled={working || !form.name.trim() || !form.title.trim() || options.some((option) => !option.label.trim())} className="rounded bg-ink px-3 py-2 text-sm font-bold text-white disabled:opacity-40">作成</button>
          </div>
          {message ? <p className="mt-3 text-sm text-moss">{message}</p> : null}
        </section>

        <section className="mt-6 rounded-xl border border-line bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-black">アンケート一覧</h2>
            <select value={targetContactId} onChange={(event) => setTargetContactId(event.target.value)} className="min-w-64 rounded border border-line px-3 py-2 text-sm">
              <option value="">手動送信先の顧客を選択</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName} / {contact.friendStatus}</option>)}
            </select>
          </div>
          {surveys.map((survey) => (
            <div key={survey.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-line p-3 text-sm">
              <div>
                <p className="font-bold">{survey.name} / {survey.status}{survey.sendOnFollow ? " / 友だち追加時に送信" : ""}</p>
                <p className="mt-1">{survey.question.title}</p>
                <p className="mt-1 text-xs text-ink/55">{survey.question.options.map((option) => `${option.label}${option.tagId ? ` → ${tags.find((tag) => tag.id === option.tagId)?.name || "タグ"}` : ""}`).join(" / ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void setFollowSurvey(survey.sendOnFollow ? null : survey.id)} disabled={working} className="rounded border border-moss px-3 py-2 font-bold text-moss disabled:opacity-40">{survey.sendOnFollow ? "自動送信を解除" : "友だち追加時に送る"}</button>
                <button onClick={() => void send(survey.id)} disabled={working || !targetContactId} className="rounded bg-moss px-3 py-2 font-bold text-white disabled:opacity-40">選択顧客へ送信</button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

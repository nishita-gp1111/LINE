"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Tag = { id: string; name: string };
type Contact = { id: string; displayName: string; friendStatus: string };
type SurveyOption = { id: string; key: string; label: string; tagId: string | null };
type Survey = { id: string; name: string; status: string; sendOnFollow: boolean; question: { title: string; options: SurveyOption[] } };
type OptionForm = { key: string; label: string; tagId: string };

function tagName(tags: Tag[], tagId: string | null): string {
  return tags.find((tag) => tag.id === tagId)?.name || "タグなし";
}

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

  const previewTitle = form.title.trim() || "どこで私たちを知りましたか？";
  const createDisabled = working || !form.name.trim() || !form.title.trim() || options.some((option) => !option.label.trim());
  const mappedCount = useMemo(() => options.filter((option) => option.tagId).length, [options]);

  function updateOption(key: string, patch: Partial<OptionForm>) {
    setOptions((current) => current.map((option) => option.key === key ? { ...option, ...patch } : option));
  }

  async function create() {
    setWorking(true); setMessage("");
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
      setMessage(data.error || (form.sendOnFollow ? "作成完了。友だち追加時に、この質問をLINEトークへ自動送信します。" : "アンケートを作成しました。"));
      if (!data.error) {
        setForm({ name: "", title: "", sendOnFollow: false });
        setOptions([{ key: crypto.randomUUID(), label: "Web広告", tagId: "" }]);
        await load();
      }
    } catch {
      setMessage("アンケートを作成できませんでした。通信状態を確認してください。");
    } finally {
      setWorking(false);
    }
  }

  async function send(surveyId: string) {
    if (!targetContactId) return;
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/milestone3/interactive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "survey_send", surveyId, contactId: targetContactId })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || "選択した顧客1名のLINEトークへ回答ボタンを送信しました。");
    } finally {
      setWorking(false);
    }
  }

  async function setFollowSurvey(surveyId: string | null) {
    setWorking(true); setMessage("");
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
    <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">LINEトーク内で回答</span><span className="text-[10px] text-ink/40">回答は1タップ</span></div>
            <h1 className="mt-2 text-3xl font-black tracking-tight">アンケート</h1>
            <p className="mt-1 text-sm text-ink/55">選択肢をタップした顧客へ、設定したタグを自動で付与します。</p>
          </div>
          <Link href="/admin/tags" className="focus-ring rounded-xl border border-line bg-white px-4 py-2.5 text-xs font-black shadow-sm hover:bg-paper">先にタグを作成する →</Link>
        </header>

        <section aria-label="アンケートの動作" className="mt-6 grid gap-2 sm:grid-cols-4">
          {[
            ["1", "質問を送信", "LINEトークに表示"],
            ["2", "選択肢をタップ", "文字入力は不要"],
            ["3", "回答を保存", "同じ回答は重複しない"],
            ["4", "タグを自動付与", "即時配信・メニューへ連動"]
          ].map(([number, label, note], index) => (
            <div key={number} className="relative rounded-xl border border-line bg-white p-3 shadow-sm">
              {index < 3 ? <span className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-lg text-emerald-400 sm:block">›</span> : null}
              <div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-emerald-600 text-xs font-black text-white">{number}</span><p className="text-xs font-black">{label}</p></div>
              <p className="mt-1 pl-9 text-[10px] text-ink/40">{note}</p>
            </div>
          ))}
        </section>

        {message ? <div role="status" className={`mt-5 rounded-xl border px-4 py-3 text-sm font-bold ${message.includes("できません") || message.includes("確認してください") ? "border-red-200 bg-red-50 text-coral" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div> : null}

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
          <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="border-b border-line bg-[#fafcfb] px-5 py-4 sm:px-6">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">新しいアンケート</p>
              <h2 className="mt-1 text-lg font-black">質問と回答ボタンを設定</h2>
            </div>
            <div className="grid gap-6 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-black text-ink/65">管理用の名前<span className="font-normal text-ink/40">顧客には表示されません</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例：流入経路アンケート" className="focus-ring min-h-11 rounded-xl border border-line px-3 text-sm font-normal" /></label>
                <label className="grid gap-1.5 text-xs font-black text-ink/65">LINEに表示する質問<span className="font-normal text-ink/40">短く、答えやすい文章にします</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例：どこで私たちを知りましたか？" maxLength={500} className="focus-ring min-h-11 rounded-xl border border-line px-3 text-sm font-normal" /></label>
              </div>

              <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div><h3 className="text-sm font-black">回答ボタンと付与タグ</h3><p className="mt-1 text-xs text-ink/45">左がトークに出る文言、右がタップ後に付くタグです。</p></div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${mappedCount ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{mappedCount}/{options.length}件にタグ設定</span>
                </div>
                <div className="mt-3 grid gap-3">
                  {options.map((option, index) => (
                    <div key={option.key} className="rounded-xl border border-line bg-[#fafcfb] p-3">
                      <div className="grid items-center gap-2 sm:grid-cols-[32px_minmax(0,1fr)_24px_minmax(0,1fr)_auto]">
                        <span className="grid size-8 place-items-center rounded-lg bg-[#263331] text-xs font-black text-white">{index + 1}</span>
                        <input value={option.label} onChange={(event) => updateOption(option.key, { label: event.target.value })} placeholder={`回答ボタン ${index + 1}`} maxLength={20} className="focus-ring min-h-11 min-w-0 rounded-xl border border-line bg-white px-3 text-sm" />
                        <span className="text-center text-emerald-500">→</span>
                        <select value={option.tagId} onChange={(event) => updateOption(option.key, { tagId: event.target.value })} className={`focus-ring min-h-11 min-w-0 rounded-xl border px-3 text-sm font-bold ${option.tagId ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                          <option value="">タグを付与しない</option>
                          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name} を付与</option>)}
                        </select>
                        <button type="button" aria-label={`選択肢${index + 1}を削除`} disabled={options.length === 1} onClick={() => setOptions((current) => current.filter((item) => item.key !== option.key))} className="focus-ring rounded-lg border border-line bg-white px-3 py-2 text-xs font-black text-coral disabled:opacity-25">削除</button>
                      </div>
                      <p className="mt-2 pl-10 text-[10px] text-ink/40">「{option.label || `回答${index + 1}`}」をタップ → <span className={option.tagId ? "font-black text-emerald-700" : "font-bold text-amber-700"}>{option.tagId ? `「${tagName(tags, option.tagId)}」タグを付与` : "タグは付与しない"}</span></p>
                    </div>
                  ))}
                </div>
                <button type="button" disabled={options.length >= 13} onClick={() => setOptions((current) => [...current, { key: crypto.randomUUID(), label: "", tagId: "" }])} className="focus-ring mt-3 w-full rounded-xl border-2 border-dashed border-emerald-200 px-3 py-3 text-xs font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">＋ 回答ボタンを追加</button>
              </div>

              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${form.sendOnFollow ? "border-emerald-300 bg-emerald-50" : "border-line bg-white"}`}>
                <input type="checkbox" checked={form.sendOnFollow} onChange={(event) => setForm({ ...form, sendOnFollow: event.target.checked })} className="mt-0.5 size-5 accent-emerald-600" />
                <span><span className="block text-sm font-black">友だち追加時に自動で送る</span><span className="mt-1 block text-xs leading-5 text-ink/50">友だち追加Webhookを受け取った直後、またはSho本人の初回登録直後に、この質問を1回送信します。</span></span>
              </label>

              {!tags.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">付与できるタグがありません。<Link href="/admin/tags" className="ml-1 underline">タグを作成してください。</Link></div> : null}
              <button type="button" onClick={() => void create()} disabled={createDisabled} className="focus-ring min-h-12 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-35">{working ? "保存中…" : form.sendOnFollow ? "作成して友だち追加時に設定" : "アンケートを作成"}</button>
            </div>
          </section>

          <aside className="xl:sticky xl:top-20">
            <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-4 py-3"><div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">LINE Preview</p><h2 className="mt-0.5 text-sm font-black">顧客からの見え方</h2></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-700">回答ボタン</span></div>
              <div className="bg-[#dce8e2] px-4 py-6">
                <div className="mx-auto max-w-sm">
                  <div className="flex items-end gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-xs font-black text-white">L</span>
                    <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm"><p className="text-sm font-bold leading-6">{previewTitle}</p><p className="mt-2 text-[10px] text-ink/35">下のボタンから1つ選んでください</p></div>
                  </div>
                  <div className="mt-4 rounded-2xl bg-white p-2 shadow-sm">
                    {options.map((option) => <button type="button" tabIndex={-1} key={option.key} className="mb-2 block w-full rounded-xl border border-emerald-400 bg-white px-3 py-2.5 text-center text-xs font-black text-emerald-700 last:mb-0">{option.label || "回答ボタン"}</button>)}
                  </div>
                </div>
              </div>
              <div className="p-4">
                <p className="text-xs font-black">タップ後の処理</p>
                <div className="mt-2 grid gap-2">
                  {options.map((option) => <div key={option.key} className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2 text-[10px]"><span className="truncate font-bold">{option.label || "回答ボタン"}</span><span className={option.tagId ? "shrink-0 font-black text-emerald-700" : "shrink-0 text-ink/35"}>→ {tagName(tags, option.tagId)}</span></div>)}
                </div>
                <p className="mt-3 text-[10px] leading-5 text-ink/45">実際の送信では、LINEのpostback回答ボタンを使用します。回答をDBへ1件保存してからタグを付与し、同じタップが再送されても重複処理しません。</p>
              </div>
            </div>
          </aside>
        </div>

        <section className="mt-8 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-[#fafcfb] px-5 py-4 sm:px-6">
            <div><h2 className="text-lg font-black">作成済みアンケート</h2><p className="mt-1 text-xs text-ink/45">友だち追加時の自動送信は1件だけ有効にできます。</p></div>
            <select value={targetContactId} onChange={(event) => setTargetContactId(event.target.value)} className="focus-ring min-h-10 min-w-64 rounded-xl border border-line bg-white px-3 text-xs font-bold">
              <option value="">手動送信先の顧客を選択</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName} / {contact.friendStatus}</option>)}
            </select>
          </div>
          <div className="divide-y divide-line">
            {surveys.map((survey) => (
              <article key={survey.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center sm:p-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{survey.name}</h3><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">{survey.status}</span>{survey.sendOnFollow ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-black text-sky-700">友だち追加時に送信</span> : null}</div>
                  <p className="mt-2 text-sm font-bold">{survey.question.title}</p>
                  <div className="mt-3 flex flex-wrap gap-2">{survey.question.options.map((option) => <span key={option.id} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[10px]"><span className="font-bold">{option.label}</span><span className="mx-1 text-emerald-500">→</span><span className={option.tagId ? "font-black text-emerald-700" : "text-ink/35"}>{tagName(tags, option.tagId)}</span></span>)}</div>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button type="button" onClick={() => void setFollowSurvey(survey.sendOnFollow ? null : survey.id)} disabled={working} className={`focus-ring rounded-xl border px-3 py-2.5 text-xs font-black disabled:opacity-40 ${survey.sendOnFollow ? "border-sky-200 bg-sky-50 text-sky-700" : "border-line bg-white text-ink/70"}`}>{survey.sendOnFollow ? "自動送信を解除" : "友だち追加時に送る"}</button>
                  <button type="button" onClick={() => void send(survey.id)} disabled={working || !targetContactId} className="focus-ring rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-35">選択顧客1名へ送信</button>
                </div>
              </article>
            ))}
            {!surveys.length ? <div className="grid min-h-48 place-items-center p-8 text-center"><div><p className="text-3xl">☑</p><p className="mt-3 text-sm font-bold text-ink/55">アンケートはまだありません</p><p className="mt-1 text-xs text-ink/35">上のフォームから最初の質問を作成してください。</p></div></div> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

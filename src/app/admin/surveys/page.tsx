"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GP_AFTER_SURVEY_PRESET, gpAfterSurveyTagNames } from "@/lib/minimum-launch/survey-preset";

type Tag = { id: string; name: string };
type Contact = { id: string; displayName: string; friendStatus: string };
type RichMenu = { id: string; name: string; status: string };
type SurveyOption = { id?: string; key: string; label: string; tagId: string | null };
type SurveyQuestion = { id?: string; key?: string; title: string; options: SurveyOption[] };
type Survey = { id: string; name: string; status: string; sendOnFollow: boolean; greetingMessage?: string; completionMessage?: string; postSurveyRichMenuId?: string | null; richMenuFallbackMinutes?: number; question?: SurveyQuestion | null; questions?: SurveyQuestion[] };
type OptionForm = { key: string; label: string; tagId: string };
type QuestionForm = { key: string; title: string; options: OptionForm[] };

function makeOption(label = ""): OptionForm {
  return { key: crypto.randomUUID(), label, tagId: "" };
}

function makeQuestion(first = false): QuestionForm {
  return { key: crypto.randomUUID(), title: "", options: [makeOption(first ? "Web広告" : "")] };
}

function tagName(tags: Tag[], tagId: string | null): string {
  return tags.find((tag) => tag.id === tagId)?.name || "タグなし";
}

function richMenuName(menus: RichMenu[], menuId?: string | null): string {
  if (!menuId) return "設定なし";
  return menus.find((menu) => menu.id === menuId)?.name || "削除・停止済みメニュー";
}

function questionsOf(survey: Survey): SurveyQuestion[] {
  if (survey.questions?.length) return survey.questions;
  return survey.question ? [survey.question] : [];
}

export default function SurveysPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [menus, setMenus] = useState<RichMenu[]>([]);
  const [targetContactId, setTargetContactId] = useState("");
  const [form, setForm] = useState({ name: "", sendOnFollow: false, greetingMessage: "友だち追加ありがとうございます！\nかんたんなアンケートにご協力ください。", completionMessage: "ご回答ありがとうございました。内容を確認してご連絡します。", postSurveyRichMenuId: "", richMenuFallbackMinutes: 30 });
  const [questions, setQuestions] = useState<QuestionForm[]>(() => [makeQuestion(true)]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewCompleted, setPreviewCompleted] = useState(false);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const [surveyResponse, tagResponse, contactResponse, menuResponse] = await Promise.all([
      fetch("/api/milestone3/interactive?resource=surveys"),
      fetch("/api/milestone3/foundation?resource=tags"),
      fetch("/api/milestone3/interactive?resource=contacts"),
      fetch("/api/milestone3/interactive?resource=menus")
    ]);
    const surveyData = await surveyResponse.json() as { surveys?: Survey[] };
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    const contactData = await contactResponse.json() as { contacts?: Contact[] };
    const menuData = await menuResponse.json() as { menus?: RichMenu[] };
    setSurveys(surveyData.surveys ?? []);
    setTags(tagData.tags ?? []);
    setContacts(contactData.contacts ?? []);
    setMenus((menuData.menus ?? []).filter((menu) => menu.status === "active"));
    if (!targetContactId && contactData.contacts?.length === 1) setTargetContactId(contactData.contacts[0].id);
  }

  useEffect(() => { void load(); }, []);

  const totalOptions = useMemo(() => questions.reduce((sum, question) => sum + question.options.length, 0), [questions]);
  const mappedCount = useMemo(() => questions.reduce((sum, question) => sum + question.options.filter((option) => option.tagId).length, 0), [questions]);
  const previewQuestion = questions[Math.min(previewIndex, questions.length - 1)];
  const createDisabled = working || !form.name.trim() || !form.completionMessage.trim() || (form.sendOnFollow && !form.greetingMessage.trim()) || questions.some((question) => !question.title.trim() || question.options.some((option) => !option.label.trim()));

  function updateQuestion(questionKey: string, patch: Partial<QuestionForm>) {
    setQuestions((current) => current.map((question) => question.key === questionKey ? { ...question, ...patch } : question));
  }

  function updateOption(questionKey: string, optionKey: string, patch: Partial<OptionForm>) {
    setQuestions((current) => current.map((question) => question.key === questionKey ? { ...question, options: question.options.map((option) => option.key === optionKey ? { ...option, ...patch } : option) } : question));
  }

  function removeQuestion(questionKey: string) {
    if (questions.length === 1) return;
    const next = questions.filter((question) => question.key !== questionKey);
    setQuestions(next);
    setPreviewIndex((index) => Math.min(index, next.length - 1));
    setPreviewCompleted(false);
  }

  function resetForm() {
    setForm({ name: "", sendOnFollow: false, greetingMessage: "友だち追加ありがとうございます！\nかんたんなアンケートにご協力ください。", completionMessage: "ご回答ありがとうございました。内容を確認してご連絡します。", postSurveyRichMenuId: "", richMenuFallbackMinutes: 30 });
    setQuestions([makeQuestion(true)]);
    setPreviewIndex(0);
    setPreviewCompleted(false);
  }

  function applyAfterSurveyPreset() {
    const missingTags = gpAfterSurveyTagNames().filter((name) => !tags.some((tag) => tag.name === name));
    if (missingTags.length) {
      setMessage(`必要なタグが不足しています：${missingTags.join("、")}`);
      return;
    }
    const richMenu = menus.find((menu) => menu.name === GP_AFTER_SURVEY_PRESET.richMenuName);
    setForm({
      name: GP_AFTER_SURVEY_PRESET.name,
      sendOnFollow: GP_AFTER_SURVEY_PRESET.sendOnFollow,
      greetingMessage: GP_AFTER_SURVEY_PRESET.greetingMessage,
      completionMessage: GP_AFTER_SURVEY_PRESET.completionMessage,
      postSurveyRichMenuId: richMenu?.id ?? "",
      richMenuFallbackMinutes: GP_AFTER_SURVEY_PRESET.richMenuFallbackMinutes
    });
    setQuestions(GP_AFTER_SURVEY_PRESET.questions.map((question) => ({
      key: crypto.randomUUID(),
      title: question.title,
      options: question.options.map((option) => ({
        key: crypto.randomUUID(),
        label: option.label,
        tagId: tags.find((tag) => tag.name === option.tagName)?.id ?? ""
      }))
    })));
    setPreviewIndex(0);
    setPreviewCompleted(false);
    setMessage(richMenu ? "アフターアンケートの全設定を入力しました。内容を確認して作成してください。" : "質問とタグを入力しました。完了後のリッチメニューを選択してください。");
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
          sendOnFollow: form.sendOnFollow,
          greetingMessage: form.greetingMessage,
          completionMessage: form.completionMessage,
          postSurveyRichMenuId: form.postSurveyRichMenuId || undefined,
          richMenuFallbackMinutes: form.richMenuFallbackMinutes,
          questions: questions.map((question, questionIndex) => ({
            key: `question_${questionIndex + 1}`,
            title: question.title,
            options: question.options.map((option, optionIndex) => ({ key: `option_${optionIndex + 1}`, label: option.label, tagId: option.tagId || undefined }))
          }))
        })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) {
        setMessage(data.error || "アンケートを作成できませんでした。");
        return;
      }
      setMessage(`${questions.length}問のアンケートシナリオを作成しました。${form.sendOnFollow ? "友だち追加時は質問1から自動で始まります。" : ""}`);
      resetForm();
      await load();
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
      setMessage(data.error || "選択した顧客1名へ質問1を送信しました。回答後は次の質問が自動表示されます。");
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
      setMessage(data.error || (surveyId ? "友だち追加時に質問1から始めるアンケートを設定しました。" : "友だち追加時の自動送信を解除しました。"));
      if (!data.error) await load();
    } finally {
      setWorking(false);
    }
  }

  async function updateSurveyExperience(survey: Survey, patch: Partial<Pick<Survey, "postSurveyRichMenuId" | "richMenuFallbackMinutes">>) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/milestone3/interactive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "survey_experience_update",
          surveyId: survey.id,
          greetingMessage: survey.greetingMessage || "",
          completionMessage: survey.completionMessage || "回答ありがとうございました。",
          postSurveyRichMenuId: patch.postSurveyRichMenuId === undefined ? survey.postSurveyRichMenuId : patch.postSurveyRichMenuId,
          richMenuFallbackMinutes: patch.richMenuFallbackMinutes ?? survey.richMenuFallbackMinutes ?? 30
        })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || "アンケート完了後のリッチメニュー設定を保存しました。");
      if (!data.error) await load();
    } finally {
      setWorking(false);
    }
  }

  function previewAnswer() {
    if (previewIndex < questions.length - 1) {
      setPreviewIndex((index) => index + 1);
      setPreviewCompleted(false);
    } else {
      setPreviewCompleted(true);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">LINEトーク内で順番に回答</span><span className="text-[10px] text-ink/40">アンケートシナリオ</span></div>
            <h1 className="mt-2 text-3xl font-black tracking-tight">アンケート</h1>
            <p className="mt-1 text-sm text-ink/55">回答をタップするとタグを付与し、そのまま次の質問を自動表示します。</p>
          </div>
          <Link href="/admin/tags" className="focus-ring rounded-xl border border-line bg-white px-4 py-2.5 text-xs font-black shadow-sm hover:bg-paper">先にタグを作成する →</Link>
        </header>

        <section aria-label="アンケートシナリオの動作" className="mt-6 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["1", "挨拶を表示", "友だち追加直後"],
            ["2", "質問を表示", "LINEカードで送信"],
            ["3", "回答をタップ", "文字入力は不要"],
            ["4", "タグを付与", "回答ごとに即時"],
            ["5", "回答完了", "お礼を表示"],
            ["6", "メニュー表示", "完了時／30分後"]
          ].map(([number, label, note], index) => (
            <div key={number} className="relative rounded-xl border border-line bg-white p-3 shadow-sm">
              {index < 5 ? <span className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-lg text-emerald-400 xl:block">›</span> : null}
              <div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-emerald-600 text-xs font-black text-white">{number}</span><p className="text-xs font-black">{label}</p></div>
              <p className="mt-1 pl-9 text-[10px] text-ink/40">{note}</p>
            </div>
          ))}
        </section>

        {message ? <div role="status" className={`mt-5 rounded-xl border px-4 py-3 text-sm font-bold ${message.includes("できません") || message.includes("確認してください") ? "border-red-200 bg-red-50 text-coral" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div> : null}

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
          <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="border-b border-line bg-[#fafcfb] px-5 py-4 sm:px-6">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">新しいアンケートシナリオ</p>
              <h2 className="mt-1 text-lg font-black">質問を順番につなげる</h2>
            </div>
            <div className="grid gap-6 p-5 sm:p-6">
              <button type="button" onClick={applyAfterSurveyPreset} disabled={working} className="focus-ring rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-black text-sky-900 shadow-sm transition hover:bg-sky-100 disabled:opacity-40">✨ GPアフターアンケートを自動入力</button>
              <p className="-mt-4 text-center text-[11px] leading-relaxed text-ink/45">挨拶・5問・28タグ・完了文・30分後のリッチメニューをまとめて設定します。</p>
              <label className="grid gap-1.5 text-xs font-black text-ink/65">管理用の名前<span className="font-normal text-ink/40">顧客には表示されません</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例：初回ヒアリング" maxLength={150} className="focus-ring min-h-11 rounded-xl border border-line px-3 text-sm font-normal" /></label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-black text-ink/65">友だち追加後の挨拶<span className="font-normal text-ink/40">CRMからアンケートの前にカード表示</span><textarea value={form.greetingMessage} onChange={(event) => setForm({ ...form, greetingMessage: event.target.value })} maxLength={500} rows={4} className="focus-ring resize-y rounded-xl border border-line px-3 py-3 text-sm font-normal leading-6" /></label>
                <label className="grid gap-1.5 text-xs font-black text-ink/65">最後に表示するメッセージ<span className="font-normal text-ink/40">全質問が終わった後にカード表示</span><textarea value={form.completionMessage} onChange={(event) => setForm({ ...form, completionMessage: event.target.value })} maxLength={300} rows={4} className="focus-ring resize-y rounded-xl border border-line px-3 py-3 text-sm font-normal leading-6" /></label>
              </div>

              <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
                <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">▦</span><div><h3 className="text-sm font-black">アンケート後のリッチメニュー</h3><p className="mt-1 text-xs leading-5 text-ink/50">完了者には即時、未完了者にも開始から指定時間後にユーザー単位で表示します。全体デフォルトは変更しません。</p></div></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <label className="grid gap-1.5 text-xs font-black text-ink/65">表示するリッチメニュー<select value={form.postSurveyRichMenuId} onChange={(event) => setForm({ ...form, postSurveyRichMenuId: event.target.value })} className="focus-ring min-h-11 rounded-xl border border-violet-200 bg-white px-3 text-sm font-bold"><option value="">設定しない</option>{menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}</select></label>
                  <label className="grid gap-1.5 text-xs font-black text-ink/65">未完了時の表示時間<select value={form.richMenuFallbackMinutes} onChange={(event) => setForm({ ...form, richMenuFallbackMinutes: Number(event.target.value) })} disabled={!form.postSurveyRichMenuId} className="focus-ring min-h-11 rounded-xl border border-violet-200 bg-white px-3 text-sm font-bold disabled:opacity-45"><option value={30}>30分後</option><option value={60}>1時間後</option><option value={180}>3時間後</option><option value={1440}>24時間後</option></select></label>
                </div>
                {!menus.length ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">有効なリッチメニューがありません。<Link href="/admin/rich-menus" className="ml-1 underline">先にリッチメニューを作成してください。</Link></p> : null}
              </div>

              <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div><h3 className="text-sm font-black">質問フロー</h3><p className="mt-1 text-xs text-ink/45">上から順番にLINEトークへ表示されます。各回答でタグを設定できます。</p></div>
                  <div className="flex gap-2"><span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-black text-sky-700">{questions.length}問</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${mappedCount ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{mappedCount}/{totalOptions}回答にタグ設定</span></div>
                </div>

                <div className="mt-4 grid gap-0">
                  {questions.map((question, questionIndex) => (
                    <div key={question.key}>
                      <article className={`rounded-2xl border bg-white shadow-sm ${previewIndex === questionIndex && !previewCompleted ? "border-emerald-400 ring-2 ring-emerald-100" : "border-line"}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b border-line bg-[#f7faf8] px-4 py-3">
                          <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-[#263331] text-xs font-black text-white">Q{questionIndex + 1}</span><div><p className="text-xs font-black">質問 {questionIndex + 1}</p><p className="text-[10px] text-ink/40">{questionIndex ? `質問${questionIndex}の回答後に自動表示` : "最初に表示"}</p></div></div>
                          <div className="flex gap-2"><button type="button" onClick={() => { setPreviewIndex(questionIndex); setPreviewCompleted(false); }} className="focus-ring rounded-lg border border-line bg-white px-3 py-2 text-[10px] font-black text-emerald-700">プレビュー</button><button type="button" aria-label={`質問${questionIndex + 1}を削除`} disabled={questions.length === 1} onClick={() => removeQuestion(question.key)} className="focus-ring rounded-lg border border-line bg-white px-3 py-2 text-[10px] font-black text-coral disabled:opacity-25">削除</button></div>
                        </div>
                        <div className="grid gap-4 p-4">
                          <label className="grid gap-1.5 text-xs font-black text-ink/65">LINEに表示する質問
                            <input value={question.title} onChange={(event) => updateQuestion(question.key, { title: event.target.value })} placeholder={questionIndex === 0 ? "例：どこで私たちを知りましたか？" : `例：質問${questionIndex + 1}を入力`} maxLength={500} className="focus-ring min-h-11 rounded-xl border border-line px-3 text-sm font-normal" />
                          </label>
                          <div><p className="text-xs font-black text-ink/65">回答ボタン → 付与するタグ</p><div className="mt-2 grid gap-2">
                            {question.options.map((option, optionIndex) => (
                              <div key={option.key} className="grid items-center gap-2 rounded-xl border border-line bg-[#fafcfb] p-2 sm:grid-cols-[30px_minmax(0,1fr)_20px_minmax(0,1fr)_auto]">
                                <span className="grid size-7 place-items-center rounded-lg bg-emerald-100 text-[10px] font-black text-emerald-700">{optionIndex + 1}</span>
                                <input value={option.label} onChange={(event) => updateOption(question.key, option.key, { label: event.target.value })} placeholder={`回答ボタン ${optionIndex + 1}`} maxLength={20} className="focus-ring min-h-10 min-w-0 rounded-lg border border-line bg-white px-3 text-xs" />
                                <span className="text-center text-emerald-500">→</span>
                                <select value={option.tagId} onChange={(event) => updateOption(question.key, option.key, { tagId: event.target.value })} className={`focus-ring min-h-10 min-w-0 rounded-lg border px-3 text-xs font-bold ${option.tagId ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}><option value="">タグを付与しない</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name} を付与</option>)}</select>
                                <button type="button" aria-label={`質問${questionIndex + 1}の選択肢${optionIndex + 1}を削除`} disabled={question.options.length === 1} onClick={() => updateQuestion(question.key, { options: question.options.filter((item) => item.key !== option.key) })} className="focus-ring rounded-lg border border-line bg-white px-2.5 py-2 text-[10px] font-black text-coral disabled:opacity-25">削除</button>
                              </div>
                            ))}
                          </div><button type="button" disabled={question.options.length >= 13} onClick={() => updateQuestion(question.key, { options: [...question.options, makeOption()] })} className="focus-ring mt-2 w-full rounded-xl border border-dashed border-emerald-200 px-3 py-2.5 text-[10px] font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">＋ この質問に回答ボタンを追加</button></div>
                        </div>
                      </article>
                      {questionIndex < questions.length - 1 ? <div className="flex h-14 flex-col items-center justify-center text-emerald-600"><span className="text-xl leading-none">↓</span><span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black">どの回答でも質問{questionIndex + 2}へ</span></div> : null}
                    </div>
                  ))}
                </div>
                <button type="button" disabled={questions.length >= 10} onClick={() => { setQuestions((current) => [...current, makeQuestion()]); setPreviewIndex(questions.length); setPreviewCompleted(false); }} className="focus-ring mt-3 w-full rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-3 py-3 text-xs font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">＋ 次の質問を追加</button>
              </div>

              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${form.sendOnFollow ? "border-emerald-300 bg-emerald-50" : "border-line bg-white"}`}>
                <input type="checkbox" checked={form.sendOnFollow} onChange={(event) => setForm({ ...form, sendOnFollow: event.target.checked })} className="mt-0.5 size-5 accent-emerald-600" />
                <span><span className="block text-sm font-black">友だち追加時に質問1から自動で始める</span><span className="mt-1 block text-xs leading-5 text-ink/50">友だち追加Webhookを受け取ると質問1を送り、回答タップごとに次の質問へ進みます。</span></span>
              </label>

              {!tags.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">付与できるタグがありません。<Link href="/admin/tags" className="ml-1 underline">タグを作成してください。</Link></div> : null}
              <button type="button" onClick={() => void create()} disabled={createDisabled} className="focus-ring min-h-12 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-35">{working ? "保存中…" : form.sendOnFollow ? `${questions.length}問を作成して友だち追加時に設定` : `${questions.length}問のアンケートを作成`}</button>
            </div>
          </section>

          <aside className="xl:sticky xl:top-20">
            <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-4 py-3"><div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">LINE Scenario Preview</p><h2 className="mt-0.5 text-sm font-black">タップして進行を確認</h2></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-700">{previewCompleted ? "完了" : `質問 ${previewIndex + 1}/${questions.length}`}</span></div>
              <div className="flex flex-wrap gap-1.5 border-b border-line bg-[#fafcfb] p-3">{questions.map((question, index) => <button key={question.key} type="button" onClick={() => { setPreviewIndex(index); setPreviewCompleted(false); }} className={`focus-ring rounded-lg px-2.5 py-1.5 text-[10px] font-black ${previewIndex === index && !previewCompleted ? "bg-emerald-600 text-white" : "border border-line bg-white text-ink/50"}`}>Q{index + 1}</button>)}<button type="button" onClick={() => setPreviewCompleted(true)} className={`focus-ring rounded-lg px-2.5 py-1.5 text-[10px] font-black ${previewCompleted ? "bg-emerald-600 text-white" : "border border-line bg-white text-ink/50"}`}>完了</button></div>
              <div className="min-h-80 bg-[#dce8e2] px-4 py-6">
                <div className="mx-auto max-w-sm">
                  {previewCompleted ? <div><div className="flex items-end gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-xs font-black text-white">L</span><div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm"><p className="text-sm font-bold leading-6">{form.completionMessage || "回答ありがとうございました。"}</p></div></div><button type="button" onClick={() => { setPreviewIndex(0); setPreviewCompleted(false); }} className="focus-ring mt-5 w-full rounded-xl border border-emerald-300 bg-white px-3 py-2.5 text-xs font-black text-emerald-700">最初から確認</button></div> : <div>
                    <div className="flex items-end gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-xs font-black text-white">L</span><div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm"><p className="text-sm font-bold leading-6">{previewQuestion?.title.trim() || `質問${previewIndex + 1}を入力してください`}</p><p className="mt-2 text-[10px] text-ink/35">下のボタンから1つ選んでください</p></div></div>
                    <div className="mt-4 rounded-2xl bg-white p-2 shadow-sm">{previewQuestion?.options.map((option) => <button type="button" onClick={previewAnswer} key={option.key} className="focus-ring mb-2 block w-full rounded-xl border border-emerald-400 bg-white px-3 py-2.5 text-center text-xs font-black text-emerald-700 last:mb-0">{option.label || "回答ボタン"}</button>)}</div>
                    <p className="mt-3 text-center text-[10px] font-bold text-emerald-900/60">回答タップ → タグ付与 → {previewIndex < questions.length - 1 ? `質問${previewIndex + 2}を自動表示` : "完了メッセージ"}</p>
                  </div>}
                </div>
              </div>
              {!previewCompleted && previewQuestion ? <div className="p-4"><p className="text-xs font-black">この質問の回答処理</p><div className="mt-2 grid gap-2">{previewQuestion.options.map((option) => <div key={option.key} className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2 text-[10px]"><span className="truncate font-bold">{option.label || "回答ボタン"}</span><span className={option.tagId ? "shrink-0 font-black text-emerald-700" : "shrink-0 text-ink/35"}>→ {tagName(tags, option.tagId || null)}</span></div>)}</div><p className="mt-3 text-[10px] leading-5 text-ink/45">回答は質問ごとに1件だけ保存します。同じpostbackが再送されても、タグ付与と次の質問は二重処理されません。</p></div> : null}
            </div>
          </aside>
        </div>

        <section className="mt-8 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-[#fafcfb] px-5 py-4 sm:px-6">
            <div><h2 className="text-lg font-black">作成済みアンケート</h2><p className="mt-1 text-xs text-ink/45">友だち追加時の自動送信は1件だけ有効にできます。</p></div>
            <select value={targetContactId} onChange={(event) => setTargetContactId(event.target.value)} className="focus-ring min-h-10 min-w-64 rounded-xl border border-line bg-white px-3 text-xs font-bold"><option value="">手動送信先の顧客を選択</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName} / {contact.friendStatus}</option>)}</select>
          </div>
          <div className="divide-y divide-line">
            {surveys.map((survey) => {
              const surveyQuestions = questionsOf(survey);
              return <article key={survey.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center sm:p-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{survey.name}</h3><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">{survey.status}</span><span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-black text-sky-700">{surveyQuestions.length}問シナリオ</span>{survey.sendOnFollow ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-black text-violet-700">友だち追加時に送信</span> : null}</div>
                  <div className="mt-3 grid gap-2">{surveyQuestions.map((question, questionIndex) => <div key={question.id || question.key || questionIndex} className="rounded-xl border border-line bg-[#fafcfb] p-3"><p className="text-xs font-black"><span className="mr-2 text-emerald-700">Q{questionIndex + 1}</span>{question.title}</p><div className="mt-2 flex flex-wrap gap-1.5">{question.options.map((option) => <span key={option.id || option.key} className="rounded-lg border border-line bg-white px-2 py-1 text-[9px]"><b>{option.label}</b><span className="mx-1 text-emerald-500">→</span><span className={option.tagId ? "font-black text-emerald-700" : "text-ink/35"}>{tagName(tags, option.tagId)}</span></span>)}</div></div>)}</div>
                  <div className="mt-3 grid gap-1 text-[10px] text-ink/45"><p><b>挨拶：</b>{survey.greetingMessage || "設定なし"}</p><p><b>完了時：</b>{survey.completionMessage || "回答ありがとうございました。"}</p><p><b>リッチメニュー：</b>{richMenuName(menus, survey.postSurveyRichMenuId)}{survey.postSurveyRichMenuId ? `（完了時／未完了でも${survey.richMenuFallbackMinutes || 30}分後）` : ""}</p></div>
                </div>
                <div className="grid gap-2 lg:min-w-72">
                  <select aria-label={`${survey.name}完了後のリッチメニュー`} value={survey.postSurveyRichMenuId || ""} onChange={(event) => void updateSurveyExperience(survey, { postSurveyRichMenuId: event.target.value || null })} disabled={working} className="focus-ring min-h-10 rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-bold disabled:opacity-40"><option value="">完了後メニュー：設定なし</option>{menus.map((menu) => <option key={menu.id} value={menu.id}>完了後：{menu.name}</option>)}</select>
                  {survey.postSurveyRichMenuId ? <select aria-label={`${survey.name}未完了時のリッチメニュー表示時間`} value={survey.richMenuFallbackMinutes || 30} onChange={(event) => void updateSurveyExperience(survey, { richMenuFallbackMinutes: Number(event.target.value) })} disabled={working} className="focus-ring min-h-10 rounded-xl border border-violet-200 bg-white px-3 text-xs font-bold disabled:opacity-40"><option value={30}>未完了でも30分後に表示</option><option value={60}>未完了でも1時間後に表示</option><option value={180}>未完了でも3時間後に表示</option><option value={1440}>未完了でも24時間後に表示</option></select> : null}
                  <div className="flex flex-wrap gap-2 lg:justify-end"><button type="button" onClick={() => void setFollowSurvey(survey.sendOnFollow ? null : survey.id)} disabled={working} className={`focus-ring rounded-xl border px-3 py-2.5 text-xs font-black disabled:opacity-40 ${survey.sendOnFollow ? "border-violet-200 bg-violet-50 text-violet-700" : "border-line bg-white text-ink/70"}`}>{survey.sendOnFollow ? "自動送信を解除" : "友だち追加時に送る"}</button><button type="button" onClick={() => void send(survey.id)} disabled={working || !targetContactId} className="focus-ring rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-35">選択顧客1名へ開始</button></div>
                </div>
              </article>;
            })}
            {!surveys.length ? <div className="grid min-h-48 place-items-center p-8 text-center"><div><p className="text-3xl">☑</p><p className="mt-3 text-sm font-bold text-ink/55">アンケートはまだありません</p><p className="mt-1 text-xs text-ink/35">質問を追加して、最初のアンケートシナリオを作成してください。</p></div></div> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

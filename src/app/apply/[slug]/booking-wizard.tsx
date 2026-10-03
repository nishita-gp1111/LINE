"use client";

import { useMemo, useState } from "react";
import type { BookingQuestion, BookingTypeSettings, PublicBookingForm, PublicSlot } from "@/lib/bookings/domain";

type WizardMode = "form" | "booking_only";
type Result = { bookingId: string; startsAt: string; memberName: string; meetUrl: string };

const fieldClass = "focus-ring min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-emerald-500";

function stepLabels(mode: WizardMode): string[] {
  return mode === "form" ? ["基本情報", "アンケート", "日時選択", "確認", "完了"] : ["基本情報", "日時選択", "確認", "完了"];
}

function apiError(body: unknown, fallback: string): string {
  return typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

function dateLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: timezone, month: "long", day: "numeric", weekday: "short" }).format(new Date(value));
}

function timeLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function fullDateLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: timezone, year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function Progress({ labels, current }: { labels: string[]; current: number }) {
  const percent = labels.length <= 1 ? 100 : (current / (labels.length - 1)) * 100;
  return (
    <div className="border-b border-slate-100 bg-white px-5 pb-5 pt-4 sm:px-8">
      <div className="mb-3 flex items-center justify-between text-[11px] font-black text-slate-400">
        <span>{labels[current]}</span><span>{current + 1} / {labels.length}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500" style={{ width: `${percent}%` }} /></div>
      <div className="mt-3 hidden justify-between sm:flex">{labels.map((label, index) => <span key={label} className={`text-[10px] font-bold ${index <= current ? "text-emerald-700" : "text-slate-300"}`}>{label}</span>)}</div>
    </div>
  );
}

function QuestionField({ question, value, onChange }: { question: BookingQuestion; value: string | string[] | undefined; onChange: (value: string | string[]) => void }) {
  const id = `booking-${question.key}`;
  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <legend className="px-1 text-sm font-black text-slate-800">{question.label}{question.required ? <span className="ml-1 text-rose-500">*</span> : null}</legend>
      {question.description ? <p className="mb-3 mt-1 text-xs leading-5 text-slate-500">{question.description}</p> : null}
      {question.type === "long_text" ? <textarea id={id} rows={5} className={fieldClass} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /> : null}
      {question.type === "text" ? <input id={id} className={fieldClass} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /> : null}
      {question.type === "select" ? <select id={id} className={fieldClass} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}><option value="">選択してください</option>{question.options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : null}
      {question.type === "radio" ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{question.options.map((option) => <label key={option} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-bold transition ${value === option ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "border-slate-200 hover:border-emerald-300"}`}><input type="radio" name={id} value={option} checked={value === option} onChange={() => onChange(option)} className="size-4 accent-emerald-600" />{option}</label>)}</div> : null}
      {question.type === "checkbox" ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{question.options.map((option) => { const checked = Array.isArray(value) && value.includes(option); return <label key={option} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-bold transition ${checked ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "border-slate-200 hover:border-emerald-300"}`}><input type="checkbox" value={option} checked={checked} onChange={() => onChange(checked ? (value as string[]).filter((item) => item !== option) : [...(Array.isArray(value) ? value : []), option])} className="size-4 accent-emerald-600" />{option}</label>; })}</div> : null}
    </fieldset>
  );
}

export function BookingWizard({
  mode,
  slug,
  title,
  description,
  completionMessage,
  bookingType,
  questions = [],
  source
}: {
  mode: WizardMode;
  slug: string;
  title: string;
  description: string;
  completionMessage: string;
  bookingType: BookingTypeSettings;
  questions?: BookingQuestion[];
  source: string;
}) {
  const labels = stepLabels(mode);
  const questionnaireStep = mode === "form" ? 1 : -1;
  const scheduleStep = mode === "form" ? 2 : 1;
  const confirmStep = scheduleStep + 1;
  const completeStep = confirmStep + 1;
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [token, setToken] = useState("");
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [selected, setSelected] = useState<PublicSlot | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    for (const slot of slots) {
      const key = dateLabel(slot.start, bookingType.timezone);
      map.set(key, [...(map.get(key) || []), slot]);
    }
    return [...map.entries()].slice(0, 14);
  }, [slots, bookingType.timezone]);

  function validateBasic(): boolean {
    if (!name.trim()) { setError("お名前を入力してください。"); return false; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError("メールアドレスを確認してください。"); return false; }
    setError("");
    return true;
  }

  function validateQuestions(): boolean {
    for (const question of questions) {
      const value = answers[question.key];
      if (question.required && (Array.isArray(value) ? value.length === 0 : !String(value || "").trim())) {
        setError(`${question.label}を入力してください。`);
        return false;
      }
    }
    setError("");
    return true;
  }

  async function createApplication() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/booking/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, slug, name, email, source, answers, website: "" })
      });
      const body = await response.json();
      if (!response.ok || typeof body.token !== "string") throw new Error(apiError(body, "回答を保存できませんでした。"));
      setToken(body.token);
      const availability = await fetch(`/api/booking/availability?token=${encodeURIComponent(body.token)}&mode=initial`, { cache: "no-store" });
      const availabilityBody = await availability.json();
      if (!availability.ok) throw new Error(apiError(availabilityBody, "空き時間を取得できませんでした。"));
      setSlots(Array.isArray(availabilityBody.slots) ? availabilityBody.slots : []);
      setStep(scheduleStep);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "処理を完了できませんでした。");
    } finally { setBusy(false); }
  }

  async function nextFromBasic() {
    if (!validateBasic()) return;
    if (mode === "form") setStep(questionnaireStep);
    else await createApplication();
  }

  async function nextFromQuestions() {
    if (!validateQuestions()) return;
    await createApplication();
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/booking/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, startsAt: selected.start })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "予約を確定できませんでした。"));
      setResult(body as Result);
      setStep(completeStep);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "予約を確定できませんでした。");
      if (caught instanceof Error && caught.message.includes("埋まりました")) setStep(scheduleStep);
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e9fff3_0,_#f6faf8_42%,_#edf2ef_100%)] px-3 py-5 text-slate-900 sm:px-5 sm:py-10">
      <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-[28px] border border-emerald-950/10 bg-white shadow-[0_24px_80px_rgba(22,82,57,.13)]">
        <header className="bg-gradient-to-br from-[#159a5b] to-[#0d8374] px-5 py-7 text-white sm:px-8 sm:py-9">
          <p className="text-xs font-black tracking-[.16em] text-white/70">GP PRモニター窓口</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-3 max-w-xl text-sm font-medium leading-7 text-white/85">{description}</p>
          <div className="mt-5 inline-flex rounded-full bg-white/15 px-3 py-1.5 text-xs font-black">オンライン面談 {bookingType.durationMinutes}分</div>
        </header>
        <Progress labels={labels} current={step} />

        <div className="p-5 sm:p-8">
          {error ? <div role="alert" className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-6 text-rose-800">{error}</div> : null}

          {step === 0 ? <div>
            <h2 className="text-xl font-black">まずは基本情報を入力</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">予約確認とGoogle Meet URLの送付に使用します。</p>
            <div className="mt-6 grid gap-5">
              <label className="grid gap-2 text-sm font-black">お名前 <span className="text-xs font-bold text-rose-500">必須</span><input autoComplete="name" className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="山田 太郎" /></label>
              <label className="grid gap-2 text-sm font-black">メールアドレス <span className="text-xs font-bold text-rose-500">必須</span><input type="email" inputMode="email" autoComplete="email" className={fieldClass} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="example@email.com" /></label>
            </div>
            <button onClick={nextFromBasic} disabled={busy} className="focus-ring mt-7 min-h-14 w-full rounded-2xl bg-emerald-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-50">{busy ? "確認中…" : "次へ進む"}</button>
          </div> : null}

          {mode === "form" && step === questionnaireStep ? <div>
            <h2 className="text-xl font-black">簡単なアンケート</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">面談をより有意義にするため、事前にお聞かせください。</p>
            <div className="mt-6 grid gap-4">{questions.map((question) => <QuestionField key={question.id} question={question} value={answers[question.key]} onChange={(value) => setAnswers((current) => ({ ...current, [question.key]: value }))} />)}</div>
            <div className="mt-7 grid grid-cols-[auto_1fr] gap-3"><button onClick={() => setStep(0)} className="focus-ring min-h-14 rounded-2xl border border-slate-200 px-5 font-black text-slate-600">戻る</button><button onClick={nextFromQuestions} disabled={busy} className="focus-ring min-h-14 rounded-2xl bg-emerald-600 px-5 font-black text-white disabled:opacity-50">{busy ? "空き時間を確認中…" : "日時選択へ"}</button></div>
          </div> : null}

          {step === scheduleStep ? <div>
            <h2 className="text-xl font-black">面談日時を選択</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">表示されている時間は、担当者のGoogle Calendarで空いている枠だけです。</p>
            {groups.length === 0 ? <div className="mt-7 rounded-2xl bg-slate-50 px-5 py-10 text-center"><p className="font-black">現在選べる日時がありません</p><p className="mt-2 text-sm text-slate-500">時間をおいて再度お試しください。</p></div> : <div className="mt-6 grid gap-5">{groups.map(([date, daySlots]) => <section key={date}><h3 className="mb-2 text-sm font-black text-slate-700">{date}</h3><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{daySlots.map((slot) => <button key={slot.start} onClick={() => setSelected(slot)} className={`focus-ring min-h-12 rounded-xl border px-2 py-2 text-sm font-black transition ${selected?.start === slot.start ? "border-emerald-600 bg-emerald-600 text-white shadow-md" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"}`}>{timeLabel(slot.start, bookingType.timezone)}</button>)}</div></section>)}</div>}
            <button onClick={() => selected && setStep(confirmStep)} disabled={!selected} className="focus-ring mt-7 min-h-14 w-full rounded-2xl bg-emerald-600 px-5 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">この日時で確認へ</button>
          </div> : null}

          {step === confirmStep && selected ? <div>
            <h2 className="text-xl font-black">予約内容の確認</h2>
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
              <dl className="divide-y divide-slate-100">{[["お名前", name], ["面談日時", fullDateLabel(selected.start, bookingType.timezone)], ["所要時間", `${bookingType.durationMinutes}分`], ["実施方法", "Google Meet（URLはメールで送付）"]].map(([label, value]) => <div key={label} className="grid gap-1 px-5 py-4 sm:grid-cols-[120px_1fr]"><dt className="text-xs font-black text-slate-400">{label}</dt><dd className="text-sm font-black text-slate-800">{value}</dd></div>)}</dl>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">「予約を確定する」を押すと、空いている担当者へ自動で割り当て、Google Meetを発行します。</p>
            <div className="mt-7 grid grid-cols-[auto_1fr] gap-3"><button onClick={() => setStep(scheduleStep)} disabled={busy} className="focus-ring min-h-14 rounded-2xl border border-slate-200 px-5 font-black text-slate-600">戻る</button><button onClick={confirm} disabled={busy} className="focus-ring min-h-14 rounded-2xl bg-emerald-600 px-5 font-black text-white disabled:opacity-50">{busy ? "予約を確定中…" : "予約を確定する"}</button></div>
          </div> : null}

          {step === completeStep && result ? <div className="py-3 text-center">
            <div className="mx-auto grid size-20 place-items-center rounded-full bg-emerald-100 text-4xl">✓</div>
            <h2 className="mt-5 text-2xl font-black">予約が完了しました</h2>
            <p className="mx-auto mt-3 max-w-lg whitespace-pre-line text-sm leading-7 text-slate-600">{completionMessage}</p>
            <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-left"><p className="text-xs font-black text-emerald-700">面談日時</p><p className="mt-1 text-lg font-black text-emerald-950">{fullDateLabel(result.startsAt, bookingType.timezone)}</p><p className="mt-2 text-sm font-bold text-emerald-800">担当: {result.memberName}</p></div>
            <a href={result.meetUrl} target="_blank" rel="noreferrer" className="focus-ring mt-5 flex min-h-14 items-center justify-center rounded-2xl bg-emerald-600 px-5 font-black text-white">Google Meetを開く</a>
            <p className="mt-4 text-xs leading-5 text-slate-400">確認メールが届かない場合は、迷惑メールフォルダもご確認ください。</p>
          </div> : null}
        </div>
      </section>
      <p className="mx-auto mt-5 max-w-2xl text-center text-[11px] leading-5 text-slate-400">入力情報は面談調整とご連絡のためにのみ使用します。</p>
    </main>
  );
}

export function PublicFormWizard({ form, source }: { form: PublicBookingForm; source: string }) {
  return <BookingWizard mode="form" slug={form.slug} title={form.title} description={form.description} completionMessage={form.completionMessage} bookingType={form.bookingType} questions={form.questions} source={source} />;
}

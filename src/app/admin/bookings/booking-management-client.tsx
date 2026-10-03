"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { BookingAdminData } from "@/lib/bookings/admin";

type Tab = "bookings" | "form" | "members" | "settings";
type Readiness = { enabled: boolean; database: boolean; googleOAuth: boolean; encryption: boolean; stateSigning: boolean; email: boolean; reminders: boolean };

const statusLabel: Record<string, string> = { unbooked: "未予約", calendar_pending: "確定処理中", confirmed: "予約済み", attended: "出席", no_show: "欠席", rescheduled: "リスケ", cancelled: "キャンセル", won: "成約", calendar_failed: "Calendar失敗" };
const typeLabel: Record<string, string> = { text: "テキスト", long_text: "長文", radio: "ラジオ", checkbox: "チェックボックス", select: "プルダウン" };
const inputClass = "focus-ring min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500";

function text(value: unknown): string { return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value); }
function number(value: unknown, fallback = 0): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function formatDate(value: unknown): string { if (!value) return "—"; return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(value))); }

function AnswerSummary({ booking, labels }: { booking: Record<string, unknown>; labels: Map<string, string> }) {
  const raw = booking.questionnaire_answer;
  const entries = raw && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw as Record<string, unknown>) : [];
  if (!booking.questionnaire_completed_at || entries.length === 0) {
    return <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-black text-slate-600">なし</span>;
  }
  return <details><summary className="cursor-pointer list-none rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-800">回答を見る</summary><dl className="mt-2 grid w-72 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{entries.map(([key, value]) => <div key={key}><dt className="text-[10px] font-black text-slate-400">{labels.get(key) || key}</dt><dd className="mt-1 whitespace-pre-wrap text-xs font-bold leading-5 text-slate-700">{Array.isArray(value) ? value.map(String).join("、") : text(value)}</dd></div>)}</dl></details>;
}

async function postAction(body: Record<string, unknown>) {
  const response = await fetch("/api/booking/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "保存できませんでした。");
}

function SetupBadge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black ${ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}><span>{ok ? "✓" : "!"}</span>{label}</span>;
}

export function BookingManagementClient({ data, readiness, appUrl, calendarNotice, calendarCode }: { data: BookingAdminData; readiness: Readiness; appUrl: string; calendarNotice: string; calendarCode: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("bookings");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [message, setMessage] = useState(calendarNotice === "connected" ? "Google Calendarを連携しました。" : calendarNotice === "error" ? `Google Calendar連携を完了できませんでした（${calendarCode || "unknown"}）` : "");
  const [busy, setBusy] = useState(false);
  const form = data.forms[0];
  const bookingType = data.bookingTypes[0];
  const applyUrl = form && appUrl ? `${appUrl}/apply/${text(form.slug)}` : "";
  const bookingUrl = bookingType && appUrl ? `${appUrl}/booking/${text(bookingType.slug)}` : "";
  const questionLabels = useMemo(() => new Map(data.questions.map((question) => [text(question.question_key), text(question.label)])), [data.questions]);

  const filteredBookings = useMemo(() => data.bookings.filter((booking) => {
    const matchesStatus = status === "all" || text(booking.status) === status;
    const haystack = `${text(booking.applicant_name)} ${text(booking.applicant_email)} ${text(booking.cloudworks_name)} ${text(booking.source)}`.toLowerCase();
    return matchesStatus && haystack.includes(query.toLowerCase());
  }), [data.bookings, query, status]);
  const todayKey = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
  const todayCount = data.bookings.filter((booking) => booking.starts_at && new Date(String(booking.starts_at)).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) === todayKey).length;
  const connectedCount = data.members.filter((member) => member.calendarConnected).length;

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await postAction(body); setMessage(success); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "保存できませんでした。"); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage("URLをコピーしました。");
  }

  return <main className="min-h-screen px-4 py-7 sm:px-8 lg:px-10">
    <div className="mx-auto max-w-7xl">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#183e35] via-[#12604b] to-[#0d8a67] p-6 text-white shadow-xl shadow-emerald-900/10 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-black tracking-[.16em] text-emerald-200">BOOKING MANAGEMENT</p><h1 className="mt-2 text-3xl font-black tracking-tight">応募から面談予約まで、ひとつに</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-white/70">アンケート、2名の空き時間、担当者割当、Google Meet、メール通知を自動化します。</p></div><div className="flex flex-wrap gap-2"><SetupBadge ok={readiness.database} label="DB" /><SetupBadge ok={readiness.googleOAuth} label="Google OAuth" /><SetupBadge ok={readiness.encryption && readiness.stateSigning} label="暗号化" /><SetupBadge ok={readiness.email} label="メール" /><SetupBadge ok={readiness.reminders} label="リマインド" /></div></div>
      </section>

      {message ? <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm font-bold ${message.includes("できません") || message.includes("失敗") ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div> : null}

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["本日の面談", todayCount, "件"], ["未予約", data.bookings.filter((booking) => booking.status === "unbooked").length, "件"], ["予約済み", data.bookings.filter((booking) => ["confirmed", "rescheduled"].includes(text(booking.status))).length, "件"], ["Calendar連携", connectedCount, `/ ${data.members.length || 2}名`]].map(([label, value, unit]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-black text-slate-400">{label}</p><p className="mt-2 text-3xl font-black text-slate-900">{value}<span className="ml-1 text-sm text-slate-400">{unit}</span></p></article>)}</section>

      <nav className="mt-6 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5" aria-label="予約管理メニュー">{([['bookings','予約一覧'],['form','応募フォーム'],['members','担当者・Calendar'],['settings','予約枠設定']] as Array<[Tab,string]>).map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-black transition ${tab === key ? "bg-[#183e35] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}>{label}</button>)}</nav>

      {tab === "bookings" ? <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-black">予約一覧</h2><p className="mt-1 text-xs text-slate-400">応募・予約・担当・CRM紐付けをまとめて確認</p></div><div className="flex gap-2"><input className={`${inputClass} sm:w-64`} placeholder="名前・メール・CloudWorks名" value={query} onChange={(event) => setQuery(event.target.value)} /><select className={`${inputClass} w-32`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">すべて</option>{Object.entries(statusLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-y-2 text-left">
            <thead><tr className="text-[10px] font-black text-slate-400"><th className="px-3">応募者</th><th className="px-3">流入元</th><th className="px-3">アンケート</th><th className="px-3">予約日時</th><th className="px-3">担当</th><th className="px-3">CRM顧客</th><th className="px-3">ステータス</th></tr></thead>
            <tbody>
              {filteredBookings.map((booking) => <tr key={text(booking.id)} className="bg-slate-50 text-sm">
                <td className="rounded-l-xl px-3 py-3"><p className="font-black">{text(booking.applicant_name)}</p><p className="mt-1 text-xs text-slate-400">{text(booking.cloudworks_name) || text(booking.applicant_email)}</p></td>
                <td className="px-3 py-3 text-xs font-bold">{text(booking.source)}</td>
                <td className="px-3 py-3"><AnswerSummary booking={booking} labels={questionLabels} /></td>
                <td className="px-3 py-3 font-bold">{formatDate(booking.starts_at)}</td>
                <td className="px-3 py-3 font-bold">{text(booking.memberName) || "—"}</td>
                <td className="px-3 py-3"><select className="min-h-9 max-w-40 rounded-lg border border-slate-200 bg-white px-2 text-xs" value={text(booking.contact_id)} onChange={(event) => run({ action: "booking_contact_link", id: booking.id, contactId: event.target.value || null }, "CRM顧客へ紐付けました。")}><option value="">未紐付け</option>{data.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select></td>
                <td className="rounded-r-xl px-3 py-3"><select className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold" value={text(booking.status)} onChange={(event) => run({ action: "booking_status_update", id: booking.id, status: event.target.value }, "ステータスを更新しました。")}>{Object.entries(statusLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></td>
              </tr>)}
              {filteredBookings.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-sm text-slate-400">予約データはまだありません。</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section> : null}

      {tab === "form" && form ? <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-black">応募フォーム</h2><form className="mt-5 grid gap-4" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); run({ action: "form_update", id: form.id, title: values.get("title"), description: values.get("description"), completionMessage: values.get("completion"), isActive: values.get("active") === "on" }, "フォームを保存しました。"); }}><label className="grid gap-1.5 text-xs font-black text-slate-600">タイトル<input name="title" className={inputClass} defaultValue={text(form.title)} /></label><label className="grid gap-1.5 text-xs font-black text-slate-600">説明<textarea name="description" rows={3} className={inputClass} defaultValue={text(form.description)} /></label><label className="grid gap-1.5 text-xs font-black text-slate-600">完了メッセージ<textarea name="completion" rows={3} className={inputClass} defaultValue={text(form.completion_message)} /></label><label className="flex items-center gap-2 text-sm font-bold"><input name="active" type="checkbox" defaultChecked={Boolean(form.is_active)} className="size-4 accent-emerald-600" />公開する</label><button disabled={busy} className="min-h-12 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white">保存</button></form>
          <div className="mt-7 border-t border-slate-100 pt-6"><div className="flex items-center justify-between"><div><h3 className="font-black">質問項目</h3><p className="mt-1 text-xs text-slate-400">テキスト・選択式を自由に追加</p></div></div><div className="mt-4 grid gap-3">{data.questions.filter((question) => question.booking_form_id === form.id).map((question) => <QuestionEditor key={text(question.id)} question={question} busy={busy} onSave={(body) => run(body, "質問を保存しました。" )} />)}</div><NewQuestion formId={text(form.id)} busy={busy} onSave={(body) => run(body, "質問を追加しました。" )} /></div>
        </div>
        <aside className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-black">共有URL</h2><p className="mt-2 text-xs leading-5 text-slate-400">CloudWorks・LINE・メールで同じURLを利用できます。</p><UrlBox label="アンケートあり" value={applyUrl} onCopy={copy} /><UrlBox label="日程調整のみ" value={bookingUrl} onCopy={copy} /><div className="mt-5 rounded-xl bg-sky-50 p-4 text-xs leading-6 text-sky-900"><b>流入元を分ける場合</b><br />末尾へ <code>?source=cloudworks</code> などを付けてください。</div></aside>
      </section> : null}

      {tab === "members" ? <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div><h2 className="text-lg font-black">担当者とGoogle Calendar</h2><p className="mt-1 text-xs text-slate-400">各担当者が自分のGoogleアカウントを1回連携します。</p></div><div className="mt-5 grid gap-3">{data.members.map((member, index) => <article key={text(member.id)} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-lg font-black text-emerald-800">{index + 1}</span><div><p className="font-black">{text(member.display_name)}</p><p className="text-xs text-slate-400">{text(member.email)}</p></div></div><div className="flex flex-wrap items-center gap-2"><SetupBadge ok={Boolean(member.calendarConnected)} label={member.calendarConnected ? `連携済み ${text(member.calendarEmail)}` : "未連携"} /><a href={`/api/booking/google/connect?memberId=${encodeURIComponent(text(member.id))}`} className="focus-ring rounded-xl bg-[#4285f4] px-4 py-2.5 text-xs font-black text-white">{member.calendarConnected ? "再連携" : "Google Calendar連携"}</a></div></div></article>)}</div></div>
        <NewMember bookingTypeId={text(bookingType?.id)} busy={busy} onSave={(body) => run(body, "担当者を追加しました。" )} />
      </section> : null}

      {tab === "settings" && bookingType ? <BookingTypeEditor bookingType={bookingType} busy={busy} onSave={(body) => run(body, "予約枠設定を保存しました。" )} /> : null}
    </div>
  </main>;
}

function UrlBox({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) { return <div className="mt-4 rounded-xl border border-slate-200 p-3"><p className="text-xs font-black text-slate-500">{label}</p><p className="mt-2 break-all text-xs text-slate-600">{value || "APP URL未設定"}</p><button disabled={!value} onClick={() => onCopy(value)} className="mt-3 min-h-10 w-full rounded-lg bg-slate-900 text-xs font-black text-white disabled:opacity-40">URLをコピー</button></div>; }

function QuestionEditor({ question, busy, onSave }: { question: Record<string, unknown>; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  return <form className="rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); onSave({ action: "question_update", id: question.id, label: values.get("label"), description: values.get("description"), type: values.get("type"), required: values.get("required") === "on", options: String(values.get("options") || "").split("\n").map((item) => item.trim()).filter(Boolean), sortOrder: Number(values.get("order")), isActive: values.get("active") === "on" }); }}><div className="grid gap-3 sm:grid-cols-[1fr_140px]"><input name="label" className={inputClass} defaultValue={text(question.label)} /><select name="type" className={inputClass} defaultValue={text(question.question_type)}>{Object.entries(typeLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div><textarea name="description" className={`${inputClass} mt-3`} rows={2} placeholder="補足説明（任意）" defaultValue={text(question.description)} /><textarea name="options" className={`${inputClass} mt-3`} rows={3} placeholder="選択肢を1行ずつ入力" defaultValue={strings(question.options_json).join("\n")} /><div className="mt-3 flex flex-wrap items-center gap-4"><label className="text-xs font-bold"><input name="required" type="checkbox" defaultChecked={Boolean(question.is_required)} className="mr-1 accent-emerald-600" />必須</label><label className="text-xs font-bold"><input name="active" type="checkbox" defaultChecked={Boolean(question.is_active)} className="mr-1 accent-emerald-600" />表示</label><label className="flex items-center gap-2 text-xs font-bold">順番<input name="order" type="number" className="w-20 rounded-lg border border-slate-200 px-2 py-1" defaultValue={number(question.sort_order)} /></label><button disabled={busy} className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-xs font-black text-white">保存</button></div></form>;
}

function NewQuestion({ formId, busy, onSave }: { formId: string; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  return <details className="mt-4 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4"><summary className="font-black text-emerald-800">＋ 質問を追加</summary><form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); onSave({ action: "question_create", formId, key: values.get("key"), label: values.get("label"), description: "", type: values.get("type"), required: values.get("required") === "on", options: String(values.get("options") || "").split("\n").map((item) => item.trim()).filter(Boolean) }); }}><input name="key" className={inputClass} placeholder="管理用キー（例: desired_job）" required /><input name="label" className={inputClass} placeholder="質問文" required /><select name="type" className={inputClass}>{Object.entries(typeLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><textarea name="options" rows={3} className={inputClass} placeholder="選択肢（1行ずつ）" /><label className="text-xs font-bold"><input name="required" type="checkbox" className="mr-1 accent-emerald-600" />必須</label><button disabled={busy} className="min-h-11 rounded-xl bg-emerald-600 font-black text-white">追加する</button></form></details>;
}

function NewMember({ bookingTypeId, busy, onSave }: { bookingTypeId: string; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  return <aside className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-black">担当者を追加</h2><p className="mt-2 text-xs leading-5 text-slate-400">初期運用は2名を登録してください。</p><form className="mt-5 grid gap-3" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); onSave({ action: "member_create", bookingTypeId, displayName: values.get("name"), email: values.get("email"), priority: 100 }); }}><input name="name" className={inputClass} placeholder="表示名" required /><input name="email" type="email" className={inputClass} placeholder="Googleアカウントのメール" required /><button disabled={busy || !bookingTypeId} className="min-h-11 rounded-xl bg-emerald-600 font-black text-white disabled:opacity-40">担当者を追加</button></form></aside>;
}

function BookingTypeEditor({ bookingType, busy, onSave }: { bookingType: Record<string, unknown>; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const weekdays = strings(bookingType.available_weekdays).map(Number);
  return <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div><h2 className="text-lg font-black">予約枠設定</h2><p className="mt-1 text-xs text-slate-400">営業時間・面談時間・バッファ・受付期限を設定</p></div><form className="mt-6 grid gap-5" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const values = new FormData(event.currentTarget); onSave({ action: "booking_type_update", id: bookingType.id, name: values.get("name"), durationMinutes: Number(values.get("duration")), slotIntervalMinutes: Number(values.get("interval")), bufferBeforeMinutes: Number(values.get("before")), bufferAfterMinutes: Number(values.get("after")), minimumNoticeMinutes: Number(values.get("noticeHours")) * 60, maximumAdvanceDays: Number(values.get("advance")), availableWeekdays: values.getAll("weekdays").map(Number), dailyStartTime: values.get("start"), dailyEndTime: values.get("end") }); }}><label className="grid gap-1.5 text-xs font-black">予約タイプ名<input name="name" className={inputClass} defaultValue={text(bookingType.name)} /></label><div className="grid gap-4 sm:grid-cols-3"><NumberField name="duration" label="面談時間（分）" value={number(bookingType.duration_minutes,30)} /><NumberField name="interval" label="枠の間隔（分）" value={number(bookingType.slot_interval_minutes,30)} /><NumberField name="advance" label="最大予約日数" value={number(bookingType.maximum_advance_days,30)} /></div><div className="grid gap-4 sm:grid-cols-3"><NumberField name="before" label="前バッファ（分）" value={number(bookingType.buffer_before_minutes)} /><NumberField name="after" label="後バッファ（分）" value={number(bookingType.buffer_after_minutes,10)} /><NumberField name="noticeHours" label="最短予約（時間前）" value={Math.round(number(bookingType.minimum_notice_minutes,1440)/60)} /></div><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-black">開始時間<input name="start" type="time" className={inputClass} defaultValue={text(bookingType.daily_start_time).slice(0,5)} /></label><label className="grid gap-1.5 text-xs font-black">終了時間<input name="end" type="time" className={inputClass} defaultValue={text(bookingType.daily_end_time).slice(0,5)} /></label></div><fieldset><legend className="text-xs font-black">予約可能曜日</legend><div className="mt-2 flex flex-wrap gap-2">{[[1,'月'],[2,'火'],[3,'水'],[4,'木'],[5,'金'],[6,'土'],[0,'日']].map(([value,label]) => <label key={value} className="flex size-11 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-sm font-black has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-800"><input className="sr-only" name="weekdays" type="checkbox" value={value} defaultChecked={weekdays.includes(Number(value))} />{label}</label>)}</div></fieldset><button disabled={busy} className="min-h-12 rounded-xl bg-emerald-600 px-5 font-black text-white">予約枠設定を保存</button></form></section>;
}

function NumberField({ name, label, value }: { name: string; label: string; value: number }) { return <label className="grid gap-1.5 text-xs font-black">{label}<input name={name} type="number" min={0} className={inputClass} defaultValue={value} /></label>; }

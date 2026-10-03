"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicSlot } from "@/lib/bookings/domain";

function label(value: string, timezone: string, timeOnly = false): string {
  return new Intl.DateTimeFormat("ja-JP", timeOnly
    ? { timeZone: timezone, hour: "2-digit", minute: "2-digit" }
    : { timeZone: timezone, year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }
  ).format(new Date(value));
}
function shortDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: timezone, month: "long", day: "numeric", weekday: "short" }).format(new Date(value));
}

function errorMessage(body: unknown): string {
  return typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : "処理を完了できませんでした。";
}

export function RescheduleWizard({ token, applicantName, currentStartsAt, timezone }: { token: string; applicantName: string; currentStartsAt: string; timezone: string }) {
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [selected, setSelected] = useState<PublicSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState<{ startsAt: string; meetUrl: string } | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    slots.forEach((slot) => { const key = shortDate(slot.start, timezone); map.set(key, [...(map.get(key) || []), slot]); });
    return [...map.entries()].slice(0, 14);
  }, [slots, timezone]);

  useEffect(() => {
    let active = true;
    fetch(`/api/booking/availability?token=${encodeURIComponent(token)}&mode=reschedule`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok) throw new Error(errorMessage(body));
        setSlots(Array.isArray(body.slots) ? body.slots : []);
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "空き時間を取得できませんでした。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  async function submit() {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/booking/reschedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, startsAt: selected.start }) });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      setComplete({ startsAt: body.startsAt, meetUrl: body.meetUrl });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日時を変更できませんでした。");
    } finally { setSaving(false); }
  }

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e9fff3_0,_#f6faf8_45%,_#edf2ef_100%)] px-4 py-8 text-slate-900 sm:py-12">
    <section className="mx-auto max-w-2xl overflow-hidden rounded-[28px] border border-emerald-950/10 bg-white shadow-[0_24px_80px_rgba(22,82,57,.13)]">
      <header className="bg-gradient-to-br from-emerald-600 to-teal-700 px-6 py-8 text-white sm:px-8"><p className="text-xs font-black tracking-[.16em] text-white/70">GP PRモニター窓口</p><h1 className="mt-2 text-2xl font-black">面談日時の変更</h1><p className="mt-3 text-sm text-white/85">{applicantName} 様の予約</p></header>
      <div className="p-5 sm:p-8">
        {complete ? <div className="py-5 text-center"><div className="mx-auto grid size-20 place-items-center rounded-full bg-emerald-100 text-4xl">✓</div><h2 className="mt-5 text-2xl font-black">日時を変更しました</h2><p className="mt-3 text-sm text-slate-500">新しい日時とGoogle Meet URLをメールでお送りしました。</p><div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-lg font-black text-emerald-950">{label(complete.startsAt, timezone)}</div><a href={complete.meetUrl} className="focus-ring mt-5 flex min-h-14 items-center justify-center rounded-2xl bg-emerald-600 px-5 font-black text-white">Google Meetを開く</a></div> : <>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black text-slate-400">現在の予約</p><p className="mt-1 text-base font-black">{label(currentStartsAt, timezone)}</p></div>
          <h2 className="mt-7 text-xl font-black">新しい日時を選択</h2>
          {error ? <div role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{error}</div> : null}
          {loading ? <div className="py-14 text-center text-sm font-bold text-slate-400">空き時間を確認中…</div> : <div className="mt-5 grid gap-5">{groups.map(([date, items]) => <section key={date}><h3 className="mb-2 text-sm font-black text-slate-700">{date}</h3><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{items.map((slot) => <button key={slot.start} onClick={() => setSelected(slot)} className={`focus-ring min-h-12 rounded-xl border text-sm font-black ${selected?.start === slot.start ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 hover:bg-emerald-50"}`}>{label(slot.start, timezone, true)}</button>)}</div></section>)}</div>}
          <button onClick={submit} disabled={!selected || saving} className="focus-ring mt-7 min-h-14 w-full rounded-2xl bg-emerald-600 px-5 font-black text-white disabled:bg-slate-200 disabled:text-slate-400">{saving ? "変更中…" : "この日時へ変更する"}</button>
        </>}
      </div>
    </section>
  </main>;
}

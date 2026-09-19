"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AcquisitionRoute } from "@/lib/acquisition/routes";
import { assignmentRuleSchema, type AssignmentRule } from "@/lib/acquisition/assignment";

export function AssignmentEditor({ route, initial, available, canManage }: { route: AcquisitionRoute; initial?: AssignmentRule; available: boolean; canManage: boolean }) {
  const router = useRouter();
  const [names, setNames] = useState(initial?.staffNames.join("\n") || "");
  const [enabled, setEnabled] = useState(initial?.enabled || false);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const staffNames = names.split(/\r?\n/).map(name => name.trim()).filter(Boolean);

  async function save() {
    const parsed = assignmentRuleSchema.safeParse({ routeSlug: route.slug, staffNames, enabled });
    if (!parsed.success) { setMessage("担当者は重複なしで1名40文字以内、最大20名です。有効にする場合は1名以上入力してください。"); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/acquisition/assignment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "保存できませんでした。");
      setSaved(parsed.data);
      setMessage(enabled ? "保存しました。次の流入から順番に振り分けます。" : "保存しました。自動振り分けは停止しています。");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存できませんでした。"); }
    finally { setBusy(false); }
  }

  return <section aria-label={`${route.label}の担当者振り分け`} className="mt-6 border-t border-line pt-5">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black">担当者の自動振り分け</h3><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${saved?.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{saved?.enabled ? "稼働中" : "停止中"}</span></div>
    <p className="mt-2 text-xs leading-5 text-ink/60">共通ログインのまま使えます。担当者名を上から順番に割り当て、最後まで来たら先頭に戻ります。</p>
    {!available ? <p role="alert" className="mt-3 text-xs font-bold text-amber-800">担当者設定を読み込めません。DB更新・接続状況を確認してください。</p> : null}
    <fieldset disabled={!canManage || !available || busy} className="mt-3 grid gap-3 disabled:opacity-60">
      <label className="grid gap-1 text-xs font-bold">担当者名（1行に1名、上から順番）<textarea aria-label={`${route.label}の担当者名`} value={names} onChange={event => setNames(event.target.value)} rows={4} placeholder={"担当者A\n担当者B"} className="focus-ring w-full rounded-xl border border-line px-3 py-2 font-normal" /></label>
      {staffNames.length > 0 ? <p className="break-words text-xs font-bold text-emerald-800">{staffNames.join(" → ")} → 先頭へ</p> : null}
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />自動振り分けを有効にする</label>
      <button type="button" onClick={() => void save()} className="focus-ring rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">{busy ? "保存中…" : "振り分け設定を保存"}</button>
    </fieldset>
    <p className="mt-3 text-[11px] leading-5 text-ink/55">既存担当者は上書きしません。同じお客様の再アクセスでは再振り分けしません。担当者の追加・並べ替え後は先頭から再開します。担当者名の登録でログイン権限は増えません。</p>
    {message ? <p role="status" className="mt-3 text-xs font-bold text-ink">{message}</p> : null}
  </section>;
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { tagDependencyLabels, type TagDeletionCheck } from "@/lib/tags/deletion";

export function TagDeleteDialog({ tag, onClose, onDeleted }: {
  tag: { id: string; name: string }; onClose: () => void; onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [check, setCheck] = useState<TagDeletionCheck | null>(null);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/tags/delete?id=${encodeURIComponent(tag.id)}`, { signal: controller.signal });
        const data = await response.json() as TagDeletionCheck & { error?: string };
        if (!response.ok) throw new Error(data.error || "利用状況を確認できませんでした。");
        setCheck(data);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "利用状況を確認できませんでした。");
      }
    })();
    return () => controller.abort();
  }, [tag.id]);

  async function remove() {
    if (working || !confirmed || check?.status !== "ready") return;
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/tags/delete", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: tag.id, name: tag.name, confirmed: true }) });
      const data = await response.json() as TagDeletionCheck & { error?: string };
      if (data.status === "in_use") { setCheck(data); setConfirmed(false); return; }
      if (!response.ok || data.status !== "deleted") throw new Error(data.error || "削除できませんでした。一覧を再読み込みしてください。");
      onDeleted();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "通信に失敗しました。"); }
    finally { setWorking(false); }
  }
  const ready = check?.status === "ready";
  const keys = [...new Set(check?.blockers?.map(item => item.key) ?? [])];

  return <dialog ref={dialog} aria-labelledby="delete-tag-title" aria-describedby="delete-tag-description" onCancel={event => { event.preventDefault(); if (!working) onClose(); }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-6 text-ink shadow-2xl backdrop:bg-black/40">
    <h2 id="delete-tag-title" className="text-xl font-black">タグを削除しますか？</h2>
    <p id="delete-tag-description" className="mt-3 break-words rounded-xl bg-stone-50 px-4 py-3 text-sm font-bold">{tag.name}</p>
    {!check && !error ? <p role="status" className="mt-4 text-sm text-ink/60">タグの利用状況を確認中…</p> : null}
    {ready ? <div className="mt-4 space-y-3 text-sm leading-6">
      <p><strong>{check.contactCount ?? 0}人の顧客</strong>からこのタグが外れ、タグ一覧・選択肢に表示されなくなります。</p>
      <p className="text-ink/65">過去の付与履歴、アンケート回答、トークは残ります。メッセージ送信やリッチメニュー変更は行いません。</p>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3"><input type="checkbox" checked={confirmed} disabled={working} onChange={event => setConfirmed(event.target.checked)} className="mt-1 size-4 shrink-0 accent-red-600" /><span>顧客からもタグが外れることを確認しました</span></label>
    </div> : null}
    {check?.status === "in_use" ? <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <p className="font-bold">設定で使用中のため削除できません</p>
      <p className="mt-1">自動処理や配信対象を変えないため、先に以下の設定からタグの指定を外してください。下書き・停止中の設定も対象です。</p>
      <ul className="mt-2 space-y-1">{keys.map(key => {
        const dependency = tagDependencyLabels[key];
        return <li key={key}>{dependency ? <Link className="focus-ring font-bold underline underline-offset-4" href={dependency.href}>{dependency.label}を確認 →</Link> : "その他の設定"}</li>;
      })}</ul>
      {keys.includes("acquisition") ? <p className="mt-2">流入経路URLのタグは自動登録に必要なため、削除できません。</p> : null}
    </div> : null}
    {check?.status === "deleted" ? <p role="status" className="mt-4 text-sm">このタグはすでに削除されています。一覧を再読み込みしてください。</p> : null}
    {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    <div className="mt-6 flex flex-wrap justify-end gap-3">
      <button autoFocus type="button" disabled={working} onClick={onClose} className="focus-ring min-h-11 rounded-xl border border-line px-5 text-sm font-bold disabled:opacity-40">{ready ? "キャンセル" : "閉じる"}</button>
      {ready ? <button type="button" disabled={working || !confirmed} onClick={() => void remove()} className="focus-ring min-h-11 rounded-xl bg-red-600 px-5 text-sm font-bold text-white disabled:opacity-35">{working ? "削除中…" : "タグを削除"}</button> : null}
    </div>
  </dialog>;
}

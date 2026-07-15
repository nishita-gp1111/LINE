"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Tag = { id: string; name: string };
type Preview = { recipientCount: number; matchedCount: number; excludedCount: number; sample: string[]; matchMode: "all"; tagIds: string[] };
type Campaign = { id: string; name: string; status: string; recipientCount: number; excludedCount: number; acceptedCount: number; failedBatches: number; textPreview: string; createdAt: string; completedAt?: string | null };

function statusLabel(status: string): string {
  if (status === "completed") return "LINE受付完了";
  if (status === "partially_failed") return "一部失敗";
  if (status === "failed") return "失敗";
  if (status === "sending") return "配信処理中";
  return status;
}

export default function CampaignsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [requestId, setRequestId] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const [tagResponse, campaignResponse] = await Promise.all([
      fetch("/api/milestone3/foundation?resource=tags"),
      fetch("/api/milestone3/delivery?resource=campaigns")
    ]);
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    const campaignData = await campaignResponse.json() as { campaigns?: Campaign[] };
    setTags(tagData.tags ?? []);
    setCampaigns(campaignData.campaigns ?? []);
  }

  useEffect(() => { void load(); }, []);

  const selectedNames = useMemo(() => selectedTags.map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean), [selectedTags, tags]);

  function invalidatePreview() {
    setPreview(null);
    setRequestId("");
    setConfirmation("");
    setMessage("");
  }

  function toggleTag(tagId: string) {
    setSelectedTags((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]);
    invalidatePreview();
  }

  async function runPreview() {
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/milestone3/delivery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tag_audience_preview", tagIds: selectedTags, matchMode: "all" })
      });
      const data = await response.json() as { preview?: Preview; error?: string };
      if (!response.ok || data.error || !data.preview) throw new Error(data.error || "対象者を確認できませんでした。");
      setPreview(data.preview);
      setRequestId(crypto.randomUUID());
      setConfirmation("");
      setMessage(data.preview.recipientCount ? "対象者を確認しました。本文と最終確認を入力してください。" : "配信できる対象者はいません。");
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : "対象者を確認できませんでした。");
    } finally {
      setWorking(false);
    }
  }

  async function send() {
    if (!preview || !requestId) return;
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/milestone3/delivery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "tag_campaign_send",
          tagIds: selectedTags,
          matchMode: "all",
          name,
          text,
          expectedRecipientCount: preview.recipientCount,
          clientRequestId: requestId,
          confirmation
        })
      });
      const data = await response.json() as { campaign?: Campaign; error?: string };
      if (!response.ok || data.error || !data.campaign) throw new Error(data.error || "配信を実行できませんでした。");
      setMessage(`${data.campaign.acceptedCount}名分をLINE APIが受け付けました。`);
      setSelectedTags([]);
      setName("");
      setText("");
      setConfirmation("");
      setPreview(null);
      setRequestId("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配信を実行できませんでした。");
    } finally {
      setWorking(false);
    }
  }

  const canSend = Boolean(preview?.recipientCount && name.trim() && text.trim() && confirmation === "配信する" && requestId && !working);

  return <main className="min-h-screen px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
    <div className="mx-auto max-w-6xl">
      <Link href="/admin" className="text-sm font-bold text-moss">← 管理画面</Link>
      <div className="mt-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-moss">Tag segment delivery</p><h1 className="mt-1 text-3xl font-black">タグ配信</h1><p className="mt-2 text-sm leading-relaxed text-ink/60">複数タグを組み合わせ、対象人数を確認してからメッセージを1回配信します。</p></div>

      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><b>即時配信です。</b> 予約配信・全員配信・自動再送は行いません。ブロック中・配信停止中の顧客は自動で除外します。</div>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-moss font-black text-white">1</span><div><h2 className="font-black">対象タグを選ぶ</h2><p className="text-xs text-ink/50">20個まで組み合わせられます。</p></div></div>
        <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-line bg-paper/30 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => <label key={tag.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${selectedTags.includes(tag.id) ? "border-moss bg-emerald-50 font-bold text-emerald-950" : "border-line bg-white text-ink/70"}`}><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={() => toggleTag(tag.id)} />{tag.name}</label>)}
        </div>
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><b className="block text-emerald-950">選択したタグをすべて持つ人（AND）</b><span className="mt-1 block text-xs text-emerald-900/70">例：タグA・B・Cを選ぶと、3つすべてが付いている顧客だけが対象です。</span></div>
        <button type="button" onClick={() => void runPreview()} disabled={!selectedTags.length || working} className="mt-4 rounded-xl bg-ink px-5 py-3 text-sm font-black text-white disabled:opacity-35">{working ? "確認しています…" : "対象人数を確認"}</button>
      </section>

      {preview ? <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black text-emerald-800">配信対象</p><p className="mt-1 text-4xl font-black text-emerald-950">{preview.recipientCount}<span className="ml-1 text-lg">名</span></p></div><p className="text-xs text-emerald-900/70">一致 {preview.matchedCount}名 / 除外 {preview.excludedCount}名</p></div>
        <p className="mt-3 text-sm text-emerald-950"><b>すべて：</b>{selectedNames.join("、")}</p>
        {preview.sample.length ? <p className="mt-2 text-xs text-emerald-900/65">確認用サンプル：{preview.sample.join("、")}</p> : null}
      </section> : null}

      <section className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-moss font-black text-white">2</span><div><h2 className="font-black">本文と最終確認</h2><p className="text-xs text-ink/50">対象人数を確認した後だけ送信できます。</p></div></div>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5 text-xs font-black text-ink/65">管理用の配信名<input value={name} onChange={(event) => setName(event.target.value)} maxLength={150} placeholder="例：7月 モニター募集案内" className="rounded-lg border border-line px-3 py-2.5 text-sm font-normal text-ink" /></label>
          <label className="grid gap-1.5 text-xs font-black text-ink/65">LINEへ送る本文<textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={5_000} rows={8} placeholder="配信メッセージを入力" className="resize-y rounded-lg border border-line px-3 py-2.5 text-sm font-normal leading-relaxed text-ink" /><span className="font-normal text-ink/45">{text.length} / 5000文字</span></label>
          <label className="grid gap-1.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-black text-red-900">最終確認：{preview?.recipientCount ?? 0}名へ送る場合「配信する」と入力<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder="配信する" className="rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm font-normal text-ink" /></label>
        </div>
        <button type="button" onClick={() => void send()} disabled={!canSend} className="mt-4 w-full rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-30">{working ? "配信しています…" : `${preview?.recipientCount ?? 0}名へ今すぐ配信`}</button>
        {message ? <p role="status" className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm font-bold text-ink/70">{message}</p> : null}
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6"><h2 className="font-black">配信履歴</h2><div className="mt-4 grid gap-2">{campaigns.length ? campaigns.map((campaign) => <div key={campaign.id} className="rounded-xl border border-line p-4"><div className="flex flex-wrap items-center justify-between gap-2"><b>{campaign.name}</b><span className="rounded-full bg-paper px-2.5 py-1 text-xs font-bold">{statusLabel(campaign.status)}</span></div><p className="mt-2 text-xs text-ink/55">対象 {campaign.recipientCount}名 / LINE受付 {campaign.acceptedCount}名 / 除外 {campaign.excludedCount}名 / 失敗batch {campaign.failedBatches}</p><p className="mt-2 line-clamp-2 text-sm text-ink/65">{campaign.textPreview}</p></div>) : <p className="text-sm text-ink/45">配信履歴はまだありません。</p>}</div></section>
    </div>
  </main>;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import type { ConversationDetail, ConversationListItem, ConversationNote, ConversationStatus, ConversationPriority, InboxFilter, InboxRole, ProfileSummary, QuickReplyTemplate } from "@/lib/inbox/types";
import type { PublicMessage } from "@/lib/inbox/public";

type Props = {
  items: ConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: Array<{ value: InboxFilter; label: string }>;
  selected: (Omit<ConversationDetail, "messages"> & { messages: PublicMessage[] }) | null;
  quickReplies: QuickReplyTemplate[];
  profiles: ProfileSummary[];
  authProfileId: string;
  role: InboxRole;
  filter: InboxFilter;
  search: string;
  canSend: boolean;
  mockMode: boolean;
};

function date(value: string | null): string {
  return value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function statusLabel(status: ConversationStatus): string {
  return status === "open" ? "対応中" : status === "pending" ? "保留" : "完了";
}

function messageStatus(message: PublicMessage): string {
  if (message.status === "accepted") return "LINE受付済み";
  if (message.status === "queued") return "送信準備中";
  if (message.status === "sending") return "送信中";
  if (message.status === "retryable_failed") return "再試行待ち";
  if (message.status === "permanently_failed") return "送信失敗";
  if (message.status === "cancelled") return "送信中止";
  return message.status === "deleted" ? "送信取消" : "受信";
}

async function postAction(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("/api/inbox/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return await response.json() as { ok: boolean; error?: string };
}

export default function InboxClient(props: Props) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const selected = props.selected;
  const canOperate = props.role !== "viewer";
  const blocked = selected?.contact.friendStatus === "blocked";

  async function perform(payload: Record<string, unknown>) {
    setWorking(true); setError("");
    try {
      const result = await postAction(payload);
      if (!result.ok) setError(result.error || "操作に失敗しました。");
      else window.location.reload();
    } catch { setError("操作に失敗しました。"); } finally { setWorking(false); }
  }

  async function send() {
    if (!selected || !text.trim()) return;
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/inbox/messages/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: selected.conversation.id, text, clientRequestId: crypto.randomUUID() }) });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) setError(result.error || "送信に失敗しました。"); else window.location.reload();
    } catch { setError("送信に失敗しました。"); } finally { setWorking(false); }
  }

  async function retry(messageId: string) {
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/inbox/messages/retry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId, conversationId: selected?.conversation.id }) });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) setError(result.error || "再試行に失敗しました。"); else window.location.reload();
    } catch { setError("再試行に失敗しました。"); } finally { setWorking(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_300px]">
      <aside className="rounded-xl border border-line bg-white p-3">
        <form className="grid gap-2" method="get">
          <input name="q" defaultValue={props.search} placeholder="表示名・内部IDで検索" className="focus-ring min-h-10 rounded-lg border border-line px-3 text-sm" />
          <select name="filter" defaultValue={props.filter} className="focus-ring min-h-10 rounded-lg border border-line px-3 text-sm">
            {props.filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {(props.role === "owner" || props.role === "admin") ? <input name="lineUserId" placeholder="LINE user ID完全一致（管理者のみ）" className="focus-ring min-h-10 rounded-lg border border-line px-3 text-xs" /> : null}
          <button className="focus-ring min-h-10 rounded-lg bg-ink px-3 text-sm font-bold text-white">絞り込む</button>
        </form>
        <p className="mt-4 text-xs font-bold text-ink/50">{props.total}件 / 1ページ{props.pageSize}件</p>
        <div className="mt-2 grid gap-1">
          {props.items.map((item) => <Link key={item.conversation.id} href={`/admin/inbox?conversation=${encodeURIComponent(item.conversation.id)}&filter=${props.filter}&q=${encodeURIComponent(props.search)}`} className={`rounded-lg p-3 text-left hover:bg-paper ${selected?.conversation.id === item.conversation.id ? "bg-paper ring-1 ring-moss" : ""}`}>
            <div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-black">{item.contact.displayName || "名称未取得"}</span>{item.readState.unreadCount > 0 ? <span className="rounded-full bg-coral px-2 py-0.5 text-[10px] font-black text-white">{item.readState.unreadCount}</span> : null}</div>
            <p className="mt-1 truncate text-xs text-ink/60">{item.conversation.lastMessagePreview || "会話を開始"}</p>
            <div className="mt-2 flex justify-between gap-2 text-[10px] text-ink/50"><span>{statusLabel(item.conversation.status)}{item.contact.friendStatus === "blocked" ? " / ブロック" : ""}</span><span>{date(item.conversation.lastMessageAt)}</span></div>
          </Link>)}
          {!props.items.length ? <p className="px-3 py-10 text-center text-sm text-ink/50">会話はありません。</p> : null}
        </div>
        <div className="mt-3 flex justify-end gap-2 text-xs font-bold">
          {props.page > 1 ? <Link href={`/admin/inbox?page=${props.page - 1}&filter=${props.filter}&q=${encodeURIComponent(props.search)}`} className="rounded border border-line px-2 py-1">前へ</Link> : null}
          {props.page * props.pageSize < props.total ? <Link href={`/admin/inbox?page=${props.page + 1}&filter=${props.filter}&q=${encodeURIComponent(props.search)}`} className="rounded border border-line px-2 py-1">次へ</Link> : null}
        </div>
      </aside>

      <section className="min-h-[650px] rounded-xl border border-line bg-white p-4 sm:p-6">
        {selected ? <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4"><div><p className="text-xs font-bold text-moss">会話詳細</p><h2 className="mt-1 text-xl font-black">{selected.contact.displayName || "名称未取得"}</h2></div><div className="text-right text-xs text-ink/55">CRM内{selected.readState.unreadCount > 0 ? "未確認" : "確認済み"}<br />最終更新 {date(selected.conversation.lastMessageAt)}</div></div>
          <div className="mt-5 grid max-h-[520px] gap-3 overflow-y-auto pr-1">
            {selected.messages.map((message) => <article key={message.id} className={`max-w-[90%] rounded-xl p-3 ${message.direction === "outbound" ? "ml-auto bg-moss/10" : "bg-paper"}`}><div className="flex justify-between gap-4 text-[10px] font-bold text-ink/50"><span>{message.direction === "outbound" ? `管理者 ${message.sentByProfileId === props.authProfileId ? "（自分）" : ""}` : "LINEユーザー"}</span><span>{date(message.lineEventTimestamp)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{message.status === "deleted" ? "（メッセージが送信取消されました）" : message.textContent || `（${message.messageType}）`}</p>{message.direction === "outbound" ? <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-ink/55"><span>{messageStatus(message)}{message.status === "retryable_failed" ? ` / ${message.errorMessageSafe || "一時エラー"}` : ""}</span>{message.status === "retryable_failed" && !blocked && canOperate ? <button type="button" disabled={working} onClick={() => retry(message.id)} className="font-black text-moss hover:underline">再試行</button> : null}</div> : null}</article>)}
            {!selected.messages.length ? <p className="py-12 text-center text-sm text-ink/50">メッセージはありません。</p> : null}
          </div>
          {error ? <p className="mt-3 rounded-lg bg-coral/10 p-3 text-sm font-bold text-coral" role="alert">{error}</p> : null}
          <div className="mt-5 border-t border-line pt-4">
            {blocked ? <p className="rounded-lg bg-coral/10 p-3 text-sm font-bold text-coral">このユーザーは現在ブロック状態です。返信できません。</p> : null}
            {!blocked && selected.contact.friendStatus === "unknown" ? <p className="mb-2 text-xs text-ink/55">友だち状態が未確認です。送信結果はLINE受付を示すもので、到達を保証しません。</p> : null}
            <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-bold text-ink/50">テキスト返信（最大5000文字） / {props.mockMode ? "Mock Mode" : "Live Mode"}</span><span className="text-xs text-ink/50">{text.length}/5000</span></div>
            <textarea value={text} onChange={(event) => setText(event.target.value)} disabled={!canOperate || !props.canSend || blocked || working} rows={4} maxLength={5000} placeholder={!props.canSend ? "手動送信は無効です" : "メッセージを入力"} className="focus-ring w-full rounded-lg border border-line p-3 text-sm disabled:bg-paper" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-1">{props.quickReplies.map((item) => <button type="button" key={item.id} disabled={!canOperate || blocked || working} onClick={() => setText((current) => current ? `${current}\n${item.textContent}` : item.textContent)} className="rounded-full border border-line px-2 py-1 text-xs font-bold hover:bg-paper">{item.name}</button>)}</div><button type="button" onClick={send} disabled={!canOperate || !props.canSend || blocked || working || !text.trim()} className="focus-ring rounded-lg bg-ink px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{working ? "処理中…" : "テキスト送信"}</button></div>
            {!props.canSend ? <p className="mt-2 text-xs font-bold text-coral">手動送信は無効です。Mock modeでは送信できます。</p> : <p className="mt-2 text-[10px] text-ink/50">送信先: {selected.contact.displayName || "名称未取得"} / LINE受付済みは到達・既読を意味しません。</p>}
          </div>
        </> : <p className="grid min-h-[600px] place-items-center text-sm text-ink/50">左の会話を選択してください。</p>}
      </section>

      <aside className="grid content-start gap-4">
        {selected ? <>
          <section className="rounded-xl border border-line bg-white p-4"><p className="text-xs font-bold text-ink/50">対応情報</p><div className="mt-3 grid gap-3 text-sm"><label className="grid gap-1"><span className="text-xs font-bold text-ink/55">ステータス</span><select disabled={!canOperate || working} value={selected.conversation.status} onChange={(event) => perform({ action: "update", conversationId: selected.conversation.id, status: event.target.value })} className="focus-ring min-h-9 rounded border border-line px-2"><option value="open">対応中</option><option value="pending">保留</option><option value="closed">完了</option></select></label><label className="grid gap-1"><span className="text-xs font-bold text-ink/55">担当者</span><select disabled={!canOperate || working} value={selected.conversation.assigneeProfileId || ""} onChange={(event) => perform({ action: "update", conversationId: selected.conversation.id, assigneeProfileId: event.target.value || null })} className="focus-ring min-h-9 rounded border border-line px-2"><option value="">未担当</option>{props.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label><label className="grid gap-1"><span className="text-xs font-bold text-ink/55">優先度</span><select disabled={!canOperate || working} value={selected.conversation.priority} onChange={(event) => perform({ action: "update", conversationId: selected.conversation.id, priority: event.target.value as ConversationPriority })} className="focus-ring min-h-9 rounded border border-line px-2"><option value="normal">通常</option><option value="high">高</option></select></label><button type="button" disabled={!canOperate || working || selected.readState.unreadCount === 0} onClick={() => perform({ action: "read", conversationId: selected.conversation.id, lastMessageId: selected.messages.at(-1)?.id || null })} className="focus-ring rounded-lg border border-line px-3 py-2 text-xs font-bold disabled:opacity-40">CRM内確認済みにする</button></div></section>
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-black text-amber-800">顧客情報</p><dl className="mt-3 grid gap-2 text-xs"><div><dt className="text-amber-800/70">友だち状態</dt><dd className="font-bold">{selected.contact.friendStatus === "blocked" ? "ブロック" : selected.contact.friendStatus === "following" ? "友だち" : "未確認"}</dd></div><div><dt className="text-amber-800/70">最終受信</dt><dd className="font-bold">{date(selected.contact.lastMessageAt)}</dd></div><div><dt className="text-amber-800/70">内部ID</dt><dd className="break-all font-bold">{selected.contact.id}</dd></div></dl></section>
          <section className="rounded-xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-black text-violet-900">内部メモ</p><p className="mt-1 text-[10px] text-violet-900/70">LINEへは送信されません。</p><div className="mt-3 grid gap-2">{selected.notes.map((item) => <NoteCard key={item.id} note={item} disabled={!canOperate || working} onDelete={() => perform({ action: "note_delete", noteId: item.id })} />)}<textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={!canOperate || working} rows={3} placeholder="内部メモを入力" className="focus-ring rounded border border-violet-200 bg-white p-2 text-xs disabled:opacity-50" /><button type="button" disabled={!canOperate || working || !note.trim()} onClick={async () => { const result = await postAction({ action: "note_create", conversationId: selected.conversation.id, body: note }); if (result.ok) window.location.reload(); else setError(result.error || "メモを保存できませんでした。"); }} className="focus-ring rounded bg-violet-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">メモを追加</button></div></section>
        </> : null}
      </aside>
    </div>
  );
}

function NoteCard({ note, disabled, onDelete }: { note: ConversationNote; disabled: boolean; onDelete: () => void }) {
  async function edit() {
    const body = window.prompt("内部メモを編集", note.body);
    if (!body || !body.trim()) return;
    const response = await fetch("/api/inbox/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "note_update", noteId: note.id, body }) });
    const result = await response.json() as { ok: boolean };
    if (result.ok) window.location.reload();
  }
  return <article className="rounded border border-violet-200 bg-white p-2"><p className="whitespace-pre-wrap text-xs">{note.body}</p><div className="mt-2 flex justify-between gap-2 text-[10px] text-violet-900/60"><span>{note.author?.displayName || "管理者"} / {date(note.createdAt)}</span><span className="flex gap-2"><button type="button" disabled={disabled} onClick={edit} className="font-bold hover:underline disabled:opacity-40">編集</button><button type="button" disabled={disabled} onClick={onDelete} className="font-bold hover:underline disabled:opacity-40">削除</button></span></div></article>;
}

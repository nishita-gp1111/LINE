"use client";

import Link from "next/link";
import { useState } from "react";
import { ContactTagsPanel } from "@/components/contact-tags-panel";
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationNote,
  ConversationPriority,
  ConversationStatus,
  InboxFilter,
  InboxRole,
  ProfileSummary,
  QuickReplyTemplate
} from "@/lib/inbox/types";
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
  return value
    ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

function statusLabel(status: ConversationStatus): string {
  return status === "open" ? "対応中" : status === "pending" ? "保留" : "完了";
}

function statusColor(status: ConversationStatus): string {
  return status === "open" ? "bg-sky-100 text-sky-700" : status === "pending" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
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

function initials(name: string | null): string {
  return (name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function Avatar({ name, pictureUrl, size = "md" }: { name: string | null; pictureUrl: string | null; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "size-20 text-2xl" : size === "sm" ? "size-10 text-sm" : "size-12 text-base";
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full border border-emerald-100 bg-emerald-50 bg-cover bg-center font-black text-emerald-700 ${sizeClass}`}
      style={pictureUrl ? { backgroundImage: `url(${pictureUrl})` } : undefined}
    >
      {pictureUrl ? null : initials(name)}
    </span>
  );
}

async function postAction(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("/api/inbox/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
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

  function conversationHref(conversationId: string, filter = props.filter) {
    return `/admin/inbox?conversation=${encodeURIComponent(conversationId)}&filter=${filter}&q=${encodeURIComponent(props.search)}`;
  }

  async function perform(payload: Record<string, unknown>) {
    setWorking(true); setError("");
    try {
      const result = await postAction(payload);
      if (!result.ok) setError(result.error || "操作に失敗しました。");
      else window.location.reload();
    } catch {
      setError("操作に失敗しました。");
    } finally {
      setWorking(false);
    }
  }

  async function send() {
    if (!selected || !text.trim()) return;
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/inbox/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: selected.conversation.id, text, clientRequestId: crypto.randomUUID() })
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) setError(result.error || "送信に失敗しました。");
      else window.location.reload();
    } catch {
      setError("送信に失敗しました。");
    } finally {
      setWorking(false);
    }
  }

  async function retry(messageId: string) {
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/inbox/messages/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, conversationId: selected?.conversation.id })
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) setError(result.error || "再試行に失敗しました。");
      else window.location.reload();
    } catch {
      setError("再試行に失敗しました。");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="grid overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm xl:h-[calc(100vh-10rem)] xl:min-h-[700px] xl:grid-cols-[320px_minmax(440px,1fr)_330px]">
      <aside className="flex min-h-[520px] flex-col border-b border-line bg-white xl:min-h-0 xl:border-b-0 xl:border-r">
        <div className="border-b border-line p-3">
          <form className="grid gap-2" method="get">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-ink/35">⌕</span>
              <input name="q" defaultValue={props.search} placeholder="名前・メッセージを検索" className="focus-ring min-h-11 w-full rounded-xl border border-line bg-[#f8faf9] pl-9 pr-3 text-sm" />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select name="filter" defaultValue={props.filter} className="focus-ring min-h-10 rounded-lg border border-line bg-white px-3 text-xs font-bold">
                {props.filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <button className="focus-ring min-h-10 rounded-lg bg-[#263331] px-4 text-xs font-black text-white">絞り込む</button>
            </div>
            {(props.role === "owner" || props.role === "admin") ? (
              <details className="rounded-lg bg-paper/70 px-3 py-2 text-[10px] text-ink/50">
                <summary className="font-bold">管理者向け：LINE User IDで検索</summary>
                <input name="lineUserId" placeholder="完全一致で入力" className="focus-ring mt-2 min-h-9 w-full rounded-lg border border-line bg-white px-2 text-xs" />
              </details>
            ) : null}
          </form>
          <div className="mt-3 flex items-center gap-1 rounded-lg bg-[#f1f4f2] p-1 text-xs font-black">
            {[{ value: "all", label: "すべて" }, { value: "unread", label: "未確認" }].map((item) => (
              <Link key={item.value} href={`/admin/inbox?filter=${item.value}&q=${encodeURIComponent(props.search)}`} className={`flex-1 rounded-md px-3 py-2 text-center ${props.filter === item.value ? "bg-white text-emerald-700 shadow-sm" : "text-ink/50 hover:text-ink"}`}>{item.label}</Link>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px]"><span className="font-black text-ink/65">{props.total}件のトーク</span><span className="text-ink/35">最新順</span></div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {props.items.map((item) => {
            const isSelected = selected?.conversation.id === item.conversation.id;
            return (
              <Link key={item.conversation.id} href={conversationHref(item.conversation.id)} className={`flex gap-3 border-b border-line/70 px-3 py-3.5 transition hover:bg-emerald-50/60 ${isSelected ? "bg-emerald-50 shadow-[inset_3px_0_0_#10b981]" : ""}`}>
                <div className="relative">
                  <Avatar name={item.contact.displayName} pictureUrl={item.contact.pictureUrl} />
                  {item.contact.friendStatus === "following" ? <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-white bg-emerald-500" title="友だち" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-black">{item.contact.displayName || "名称未取得"}</p>
                    <span className="shrink-0 text-[10px] text-ink/35">{date(item.conversation.lastMessageAt)}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink/55">{item.conversation.lastMessagePreview || "会話を開始"}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${statusColor(item.conversation.status)}`}>{statusLabel(item.conversation.status)}</span>
                    {item.readState.unreadCount > 0 ? <span className="grid min-w-5 place-items-center rounded-full bg-coral px-1.5 py-0.5 text-[9px] font-black text-white">{item.readState.unreadCount}</span> : <span className="text-[9px] text-ink/30">確認済み</span>}
                  </div>
                </div>
              </Link>
            );
          })}
          {!props.items.length ? <div className="grid min-h-52 place-items-center px-6 text-center"><div><p className="text-3xl">💬</p><p className="mt-3 text-sm font-bold text-ink/55">該当するトークはありません</p><p className="mt-1 text-xs text-ink/35">検索条件を変えてください。</p></div></div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line p-3 text-xs font-bold">
          {props.page > 1 ? <Link href={`/admin/inbox?page=${props.page - 1}&filter=${props.filter}&q=${encodeURIComponent(props.search)}`} className="rounded-lg border border-line px-3 py-1.5">前へ</Link> : null}
          {props.page * props.pageSize < props.total ? <Link href={`/admin/inbox?page=${props.page + 1}&filter=${props.filter}&q=${encodeURIComponent(props.search)}`} className="rounded-lg border border-line px-3 py-1.5">次へ</Link> : null}
        </div>
      </aside>

      <section className="flex min-h-[700px] min-w-0 flex-col border-b border-line bg-[#e7ece9] xl:min-h-0 xl:border-b-0 xl:border-r">
        {selected ? (
          <>
            <header className="flex min-h-[72px] items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={selected.contact.displayName} pictureUrl={selected.contact.pictureUrl} size="sm" />
                <div className="min-w-0"><h2 className="truncate text-base font-black">{selected.contact.displayName || "名称未取得"}</h2><p className="mt-0.5 text-[10px] text-ink/45">{selected.contact.friendStatus === "following" ? "● 友だち" : selected.contact.friendStatus === "blocked" ? "ブロック中" : "友だち状態未確認"} ・ 最終更新 {date(selected.conversation.lastMessageAt)}</p></div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${statusColor(selected.conversation.status)}`}>{statusLabel(selected.conversation.status)}</span>
                <Link href={`/admin/contacts/${selected.contact.id}`} className="focus-ring rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-paper">顧客詳細</Link>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
              <div className="mx-auto grid max-w-3xl gap-3">
                {selected.messages.map((message) => (
                  <article key={message.id} className={`max-w-[86%] rounded-2xl px-4 py-3 shadow-sm ${message.direction === "outbound" ? "ml-auto rounded-br-md bg-[#cfeee0]" : "rounded-bl-md bg-white"}`}>
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.status === "deleted" ? "（メッセージが送信取消されました）" : message.textContent || `（${message.messageType}）`}</p>
                    <div className="mt-2 flex items-center justify-end gap-2 text-[9px] text-ink/40">
                      {message.direction === "outbound" ? <span>{messageStatus(message)}</span> : null}
                      <span>{date(message.lineEventTimestamp)}</span>
                      {message.status === "retryable_failed" && !blocked && canOperate ? <button type="button" disabled={working} onClick={() => void retry(message.id)} className="font-black text-coral hover:underline">再試行</button> : null}
                    </div>
                  </article>
                ))}
                {!selected.messages.length ? <div className="grid min-h-80 place-items-center text-center"><div><p className="text-4xl">👋</p><p className="mt-3 text-sm font-bold text-ink/50">まだメッセージはありません</p><p className="mt-1 text-xs text-ink/35">下の入力欄から1対1で送信できます。</p></div></div> : null}
              </div>
            </div>

            <div className="border-t border-black/10 bg-white p-3 sm:p-4">
              {error ? <p className="mb-3 rounded-lg bg-coral/10 p-3 text-sm font-bold text-coral" role="alert">{error}</p> : null}
              {blocked ? <p className="mb-3 rounded-lg bg-coral/10 p-3 text-sm font-bold text-coral">このユーザーはブロック中のため送信できません。</p> : null}
              <div className="rounded-xl border border-line bg-white focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void send(); } }}
                  disabled={!canOperate || !props.canSend || blocked || working}
                  rows={3}
                  maxLength={5000}
                  placeholder={!props.canSend ? "手動送信は現在OFFです" : `${selected.contact.displayName || "この顧客"}さんへメッセージを入力`}
                  className="w-full resize-none rounded-t-xl border-0 p-3 text-sm outline-none disabled:bg-paper"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {props.quickReplies.slice(0, 4).map((item) => <button type="button" key={item.id} disabled={!canOperate || blocked || working} onClick={() => setText((current) => current ? `${current}\n${item.textContent}` : item.textContent)} className="rounded-full bg-paper px-2.5 py-1 text-[10px] font-bold hover:bg-emerald-50">＋ {item.name}</button>)}
                  </div>
                  <div className="flex items-center gap-3"><span className="hidden text-[9px] text-ink/35 sm:inline">⌘ / Ctrl + Enterで送信</span><span className="text-[9px] text-ink/35">{text.length}/5000</span><button type="button" onClick={() => void send()} disabled={!canOperate || !props.canSend || blocked || working || !text.trim()} className="focus-ring rounded-lg bg-emerald-600 px-5 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-35">{working ? "処理中…" : "送信"}</button></div>
                </div>
              </div>
              <p className="mt-2 text-center text-[9px] text-ink/35">{props.mockMode ? "Mock Mode" : "Live Mode"} ・ LINE受付済みは到達や既読を意味しません</p>
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center"><div><p className="text-5xl">💬</p><h2 className="mt-4 text-lg font-black">トークを選択してください</h2><p className="mt-2 text-sm text-ink/45">左の顧客を選ぶと、会話と顧客情報を同時に確認できます。</p></div></div>
        )}
      </section>

      <aside className="min-h-[700px] overflow-y-auto bg-white xl:min-h-0">
        {selected ? (
          <>
            <section className="border-b border-line p-5 text-center">
              <div className="flex justify-center"><Avatar name={selected.contact.displayName} pictureUrl={selected.contact.pictureUrl} size="lg" /></div>
              <h2 className="mt-3 text-lg font-black">{selected.contact.displayName || "名称未取得"}</h2>
              <p className="mt-1 text-[11px] text-ink/45">登録 {date(selected.contact.firstSeenAt)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={!canOperate || working || selected.readState.unreadCount === 0} onClick={() => void perform({ action: "read", conversationId: selected.conversation.id, lastMessageId: selected.messages.at(-1)?.id || null })} className="focus-ring rounded-lg border border-line px-2 py-2 text-[10px] font-black disabled:opacity-35">✓ 確認済みにする</button>
                <Link href={`/admin/contacts/${selected.contact.id}`} className="focus-ring rounded-lg border border-line px-2 py-2 text-[10px] font-black">👤 顧客詳細</Link>
              </div>
            </section>

            <section className="border-b border-line p-4">
              <h3 className="text-xs font-black text-ink/45">対応状況</h3>
              <div className="mt-3 grid gap-3">
                <label className="grid grid-cols-[72px_1fr] items-center gap-2 text-xs"><span className="font-bold text-ink/55">ステータス</span><select disabled={!canOperate || working} value={selected.conversation.status} onChange={(event) => void perform({ action: "update", conversationId: selected.conversation.id, status: event.target.value })} className="focus-ring min-h-9 rounded-lg border border-line px-2 text-xs"><option value="open">対応中</option><option value="pending">保留</option><option value="closed">完了</option></select></label>
                <label className="grid grid-cols-[72px_1fr] items-center gap-2 text-xs"><span className="font-bold text-ink/55">担当者</span><select disabled={!canOperate || working} value={selected.conversation.assigneeProfileId || ""} onChange={(event) => void perform({ action: "update", conversationId: selected.conversation.id, assigneeProfileId: event.target.value || null })} className="focus-ring min-h-9 rounded-lg border border-line px-2 text-xs"><option value="">未担当</option>{props.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label>
                <label className="grid grid-cols-[72px_1fr] items-center gap-2 text-xs"><span className="font-bold text-ink/55">優先度</span><select disabled={!canOperate || working} value={selected.conversation.priority} onChange={(event) => void perform({ action: "update", conversationId: selected.conversation.id, priority: event.target.value as ConversationPriority })} className="focus-ring min-h-9 rounded-lg border border-line px-2 text-xs"><option value="normal">通常</option><option value="high">高</option></select></label>
              </div>
            </section>

            <section className="border-b border-line p-4"><ContactTagsPanel contactId={selected.contact.id} compact /></section>

            <section className="border-b border-line p-4">
              <h3 className="text-sm font-black">顧客情報</h3>
              <dl className="mt-3 grid gap-2 text-xs">
                <div className="flex justify-between gap-3"><dt className="text-ink/45">友だち状態</dt><dd className="font-black">{selected.contact.friendStatus === "blocked" ? "ブロック" : selected.contact.friendStatus === "following" ? "友だち" : "未確認"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink/45">最終受信</dt><dd className="font-black">{date(selected.contact.lastMessageAt)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink/45">CRM確認</dt><dd className="font-black">{selected.readState.unreadCount > 0 ? `未確認 ${selected.readState.unreadCount}件` : "確認済み"}</dd></div>
              </dl>
            </section>

            <section className="p-4">
              <div className="flex items-center justify-between"><div><h3 className="text-sm font-black">内部メモ</h3><p className="mt-0.5 text-[9px] text-ink/40">LINEユーザーには表示されません</p></div></div>
              <div className="mt-3 grid gap-2">
                {selected.notes.map((item) => <NoteCard key={item.id} note={item} disabled={!canOperate || working} onDelete={() => void perform({ action: "note_delete", noteId: item.id })} />)}
                {!selected.notes.length ? <p className="rounded-lg bg-paper p-3 text-center text-[10px] text-ink/40">メモはありません</p> : null}
                <textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={!canOperate || working} rows={3} placeholder="対応内容などをメモ" className="focus-ring rounded-lg border border-line p-2 text-xs disabled:opacity-50" />
                <button type="button" disabled={!canOperate || working || !note.trim()} onClick={async () => { const result = await postAction({ action: "note_create", conversationId: selected.conversation.id, body: note }); if (result.ok) window.location.reload(); else setError(result.error || "メモを保存できませんでした。"); }} className="focus-ring rounded-lg bg-[#263331] px-3 py-2 text-xs font-black text-white disabled:opacity-35">メモを追加</button>
              </div>
            </section>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function NoteCard({ note, disabled, onDelete }: { note: ConversationNote; disabled: boolean; onDelete: () => void }) {
  async function edit() {
    const body = window.prompt("内部メモを編集", note.body);
    if (!body || !body.trim()) return;
    const response = await fetch("/api/inbox/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "note_update", noteId: note.id, body })
    });
    const result = await response.json() as { ok: boolean };
    if (result.ok) window.location.reload();
  }

  return (
    <article className="rounded-lg border border-line bg-[#fafcfb] p-2.5">
      <p className="whitespace-pre-wrap text-xs leading-5">{note.body}</p>
      <div className="mt-2 flex justify-between gap-2 text-[9px] text-ink/40"><span>{note.author?.displayName || "管理者"} ・ {date(note.createdAt)}</span><span className="flex gap-2"><button type="button" disabled={disabled} onClick={() => void edit()} className="font-black hover:underline disabled:opacity-40">編集</button><button type="button" disabled={disabled} onClick={onDelete} className="font-black text-coral hover:underline disabled:opacity-40">削除</button></span></div>
    </article>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getContact, listContactMessages } from "@/lib/contacts/queries";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
}

export default async function ContactDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = await getContact(id);
  if (!contact) notFound();
  const messages = await listContactMessages(id);

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/admin/contacts" className="text-sm font-bold text-moss hover:underline">← 顧客一覧</Link>
        <section className="mt-5 rounded-xl border border-line bg-white p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div
              className="grid size-20 shrink-0 place-items-center rounded-full border border-line bg-paper bg-cover bg-center text-2xl font-black text-moss"
              style={contact.pictureUrl ? { backgroundImage: `url(${contact.pictureUrl})` } : undefined}
              role="img"
              aria-label="プロフィール画像"
            >
              {contact.pictureUrl ? null : "?"}
            </div>
            <div>
              <p className="text-sm font-bold text-moss">顧客詳細</p>
              <h1 className="mt-1 text-3xl font-black">{contact.displayName || "名称未取得"}</h1>
              <p className="mt-2 text-sm text-ink/60">友だち状態: {contact.friendStatus}</p>
            </div>
          </div>
          <dl className="mt-7 grid gap-4 sm:grid-cols-2">
            {[
              ["言語", contact.language || "—"],
              ["ステータスメッセージ", contact.statusMessage || "—"],
              ["初回確認日時", formatDate(contact.firstSeenAt)],
              ["友だち追加日時", formatDate(contact.followedAt)],
              ["ブロック確認日時", formatDate(contact.unfollowedAt)],
              ["最終メッセージ日時", formatDate(contact.lastMessageAt)],
              ["内部ID", contact.id]
            ].map(([label, value]) => <div key={label} className="rounded-lg bg-paper p-3"><dt className="text-xs font-bold text-ink/50">{label}</dt><dd className="mt-1 break-words text-sm font-bold">{value}</dd></div>)}
          </dl>
          <details className="mt-5 rounded-lg border border-line p-3 text-sm">
            <summary className="cursor-pointer font-bold">LINEユーザーIDを表示</summary>
            <code className="mt-3 block break-all text-xs text-ink/65">{contact.lineUserId}</code>
          </details>
        </section>

        <section className="mt-6 rounded-xl border border-line bg-white p-6">
          <h2 className="text-lg font-black">受信メッセージ（直近50件）</h2>
          <div className="mt-4 grid gap-3">
            {messages.map((message) => <article key={message.id} className="rounded-lg border border-line p-4"><div className="flex justify-between gap-3 text-xs text-ink/50"><span>{message.messageType}</span><span>{formatDate(message.lineEventTimestamp)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{message.status === "deleted" ? "（unsendにより本文削除済み）" : message.textContent || "（本文なし）"}</p></article>)}
            {!messages.length ? <p className="py-8 text-center text-sm text-ink/55">受信メッセージはまだありません。</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

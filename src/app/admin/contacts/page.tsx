import Link from "next/link";
import { listContacts } from "@/lib/contacts/queries";
import type { FriendStatus } from "@/lib/webhook/store";

const statusOptions: Array<{ value: FriendStatus | ""; label: string }> = [
  { value: "", label: "すべて" },
  { value: "following", label: "友だち" },
  { value: "blocked", label: "ブロック" },
  { value: "unknown", label: "未確認" }
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
}

function statusLabel(status: FriendStatus): string {
  return status === "following" ? "友だち" : status === "blocked" ? "ブロック" : "未確認";
}

export default async function ContactsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = one(params.q) || "";
  const statusValue = one(params.status);
  const status = statusOptions.some((option) => option.value === statusValue && option.value !== "")
    ? (statusValue as FriendStatus)
    : undefined;
  const requestedPage = Number(one(params.page) || "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const result = await listContacts({ search, status, page, pageSize: 50 });
  const nextPage = page * result.pageSize < result.total ? page + 1 : null;
  const previousPage = page > 1 ? page - 1 : null;

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin" className="text-sm font-bold text-moss hover:underline">← 管理画面</Link>
        <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-moss">Contacts</p>
            <h1 className="mt-2 text-3xl font-black">顧客一覧</h1>
            <p className="mt-2 text-sm text-ink/60">全件をブラウザへ読み込まず、1ページ50件で表示します。</p>
          </div>
          <Link href="/admin/settings/line" className="text-sm font-bold text-moss hover:underline">LINE接続状態 →</Link>
        </div>

        <form className="mt-6 flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row">
          <input name="q" defaultValue={search} placeholder="表示名で検索" className="focus-ring min-h-10 flex-1 rounded-lg border border-line px-3 text-sm" />
          <select name="status" defaultValue={status || ""} className="focus-ring min-h-10 rounded-lg border border-line px-3 text-sm">
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="submit" className="focus-ring min-h-10 rounded-lg bg-ink px-4 text-sm font-bold text-white">検索</button>
        </form>

        <div className="mt-4 text-sm font-bold text-ink/60">{result.total}件</div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="border-b border-line bg-paper text-xs text-ink/55">
              <tr>{["表示名", "友だち状態", "初回確認", "友だち追加", "最終メッセージ", "更新", "詳細"].map((label) => <th key={label} className="px-4 py-3 font-bold">{label}</th>)}</tr>
            </thead>
            <tbody>
              {result.items.map((contact) => (
                <tr key={contact.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-4 font-bold">{contact.displayName || "名称未取得"}</td>
                  <td className="px-4 py-4">{statusLabel(contact.friendStatus)}</td>
                  <td className="px-4 py-4 text-ink/65">{formatDate(contact.firstSeenAt)}</td>
                  <td className="px-4 py-4 text-ink/65">{formatDate(contact.followedAt)}</td>
                  <td className="px-4 py-4 text-ink/65">{formatDate(contact.lastMessageAt)}</td>
                  <td className="px-4 py-4 text-ink/65">{formatDate(contact.updatedAt)}</td>
                  <td className="px-4 py-4"><Link className="font-bold text-moss hover:underline" href={`/admin/contacts/${contact.id}`}>詳細</Link></td>
                </tr>
              ))}
              {!result.items.length ? <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-ink/55">顧客データはまだありません。</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end gap-3 text-sm font-bold">
          {previousPage ? <Link href={`/admin/contacts?q=${encodeURIComponent(search)}&status=${status || ""}&page=${previousPage}`} className="rounded-lg border border-line bg-white px-3 py-2">前へ</Link> : null}
          {nextPage ? <Link href={`/admin/contacts?q=${encodeURIComponent(search)}&status=${status || ""}&page=${nextPage}`} className="rounded-lg border border-line bg-white px-3 py-2">次へ</Link> : null}
        </div>
      </div>
    </main>
  );
}

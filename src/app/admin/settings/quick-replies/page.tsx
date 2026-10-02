import Link from "next/link";
import { getInboxData } from "@/lib/inbox/queries";
import QuickRepliesClient from "@/app/admin/settings/quick-replies/quick-replies-client";

export default async function QuickRepliesPage() {
  const data = await getInboxData();
  if (!data) return <main className="p-8">認証が必要です。</main>;
  if (!data.store) return <main className="p-8">Supabase設定が不足しています。</main>;
  const items = await data.store.listQuickReplies(data.auth.organizationId, true);
  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-4xl"><Link href="/admin/inbox" className="text-sm font-bold text-moss hover:underline">← トークに戻る</Link><div className="mt-4"><p className="text-sm font-bold uppercase tracking-[0.2em] text-moss">Text templates</p><h1 className="mt-2 text-3xl font-black">文章テンプレート設定</h1><p className="mt-2 text-sm text-ink/60">よく使う文章をスタッフで共有できます。トーク入力欄の「テンプレート」から選んで差し込み、確認・編集してから送信してください。</p></div><QuickRepliesClient initialItems={items} canManage={data.auth.role === "owner" || data.auth.role === "admin"} /></div></main>;
}

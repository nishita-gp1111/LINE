import Link from "next/link";
import { getServerEnv } from "@/lib/env/server";
import { getInboxData } from "@/lib/inbox/queries";
import type { InboxFilter } from "@/lib/inbox/types";
import InboxClient from "@/app/admin/inbox/inbox-client";
import { toPublicMessage } from "@/lib/inbox/public";

const filters: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "unread", label: "CRM内未確認" },
  { value: "mine", label: "自分の担当" },
  { value: "unassigned", label: "未担当" },
  { value: "open", label: "対応中" },
  { value: "pending", label: "保留" },
  { value: "closed", label: "完了" },
  { value: "blocked", label: "ブロック" },
  { value: "high", label: "高優先度" }
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilter(value: string | undefined): InboxFilter {
  return filters.some((item) => item.value === value) ? value as InboxFilter : "all";
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getInboxData();
  if (!data) return <main className="p-8">認証が必要です。</main>;
  if (!data.store) return <main className="p-8">Supabase設定が不足しています。</main>;
  const params = await searchParams;
  const filter = parseFilter(one(params.filter));
  const search = one(params.q) || "";
  const requestedPage = Number(one(params.page) || "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const result = await data.store.listConversations({ organizationId: data.auth.organizationId, profileId: data.auth.profileId, filter, search, page, pageSize: 50, ownerSearchLineUserId: data.auth.role === "owner" || data.auth.role === "admin" ? one(params.lineUserId) : undefined });
  const selectedId = one(params.conversation) || result.items[0]?.conversation.id;
  const detail = selectedId ? await data.store.getConversation(data.auth.organizationId, selectedId, data.auth.profileId) : null;
  const safeDetail = detail ? { ...detail, messages: detail.messages.map(toPublicMessage) } : null;
  const quickReplies = await data.store.listQuickReplies(data.auth.organizationId);
  const profiles = await data.store.listProfiles(data.auth.organizationId);
  const env = getServerEnv();
  const canSend = data.auth.role !== "viewer" && (env.MOCK_LINE_API || env.LINE_MANUAL_SEND_ENABLED);

  return (
    <main className="min-h-[calc(100vh-4rem)] p-3 sm:p-4">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <div className="flex items-center gap-2"><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">1対1トーク</span><span className="text-[10px] text-ink/40">Sho本人限定</span></div>
            <h1 className="mt-1 text-2xl font-black tracking-tight">顧客とのトーク</h1>
            <p className="mt-0.5 text-xs text-ink/50">会話・タグ・対応状況をこの画面だけで確認できます。</p>
          </div>
          <div className="flex gap-2"><Link href="/admin/contacts" className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-paper">顧客一覧</Link><Link href="/admin/settings/quick-replies" className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-paper">クイック返信設定</Link></div>
        </div>
        <InboxClient items={result.items} total={result.total} page={result.page} pageSize={result.pageSize} filters={filters} selected={safeDetail} quickReplies={quickReplies} profiles={profiles} authProfileId={data.auth.profileId} role={data.auth.role} filter={filter} search={search} canSend={canSend} mockMode={env.MOCK_LINE_API} />
      </div>
    </main>
  );
}

import { LogoutButton } from "@/components/logout-button";
import { getAuthMode } from "@/lib/auth/config";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import Link from "next/link";

export default async function AdminPage() {
  const user = await requireAuthenticatedUser();
  const mode = getAuthMode();

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-moss">LINE CRM</p>
            <h1 className="mt-2 text-3xl font-black">管理画面</h1>
          </div>
          <LogoutButton />
        </header>

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          <article className="rounded-xl border border-line bg-white p-5">
            <p className="text-xs font-bold text-ink/50">認証ユーザー</p>
            <p className="mt-3 break-all text-lg font-black">{user.email}</p>
          </article>
          <article className="rounded-xl border border-line bg-white p-5">
            <p className="text-xs font-bold text-ink/50">認証モード</p>
            <p className="mt-3 text-lg font-black">{mode === "mock" ? "mock mode" : "Supabase Auth"}</p>
          </article>
          <article className="rounded-xl border border-line bg-white p-5">
            <p className="text-xs font-bold text-ink/50">Milestone 0</p>
            <p className="mt-3 text-lg font-black text-moss">基盤準備完了</p>
          </article>
        </section>

        <section className="mt-6 rounded-xl border border-line bg-white p-6">
          <h2 className="text-lg font-black">Minimum Internal Launch</h2>
          <p className="mt-2 text-sm leading-7 text-ink/65">
            顧客タグ、アンケート回答タグ、タグ起点の即時1通配信、顧客単位のタグ別リッチメニューを運用できます。
          </p>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <Link href="/admin/inbox" className="rounded-xl border border-line bg-white p-5 hover:bg-paper">
            <p className="text-xs font-bold text-moss">Inbox</p>
            <p className="mt-2 text-lg font-black">会話・返信・対応管理を見る →</p>
          </Link>
          <Link href="/admin/settings/line" className="rounded-xl border border-line bg-white p-5 hover:bg-paper">
            <p className="text-xs font-bold text-moss">LINE接続</p>
            <p className="mt-2 text-lg font-black">Webhook・設定状態を見る →</p>
          </Link>
          <Link href="/admin/contacts" className="rounded-xl border border-line bg-white p-5 hover:bg-paper">
            <p className="text-xs font-bold text-moss">Contacts</p>
            <p className="mt-2 text-lg font-black">顧客一覧を見る →</p>
          </Link>
          <Link href="/admin/tags" className="rounded-xl border border-line bg-white p-5 hover:bg-paper"><p className="text-xs font-bold text-moss">① 顧客タグ</p><p className="mt-2 text-lg font-black">タグを作成する →</p></Link>
          <Link href="/admin/surveys" className="rounded-xl border border-line bg-white p-5 hover:bg-paper"><p className="text-xs font-bold text-moss">② アンケート</p><p className="mt-2 text-lg font-black">回答タグを設定・送信する →</p></Link>
          <Link href="/admin/automations" className="rounded-xl border border-line bg-white p-5 hover:bg-paper"><p className="text-xs font-bold text-moss">③ 即時配信</p><p className="mt-2 text-lg font-black">タグ起点の1通を設定する →</p></Link>
          <Link href="/admin/rich-menus" className="rounded-xl border border-line bg-white p-5 hover:bg-paper"><p className="text-xs font-bold text-moss">④ リッチメニュー</p><p className="mt-2 text-lg font-black">タグ別メニューを設定する →</p></Link>
        </section>
      </div>
    </main>
  );
}

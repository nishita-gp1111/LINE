import { LogoutButton } from "@/components/logout-button";
import { getAuthMode } from "@/lib/auth/config";
import { requireAuthenticatedUser } from "@/lib/auth/server";

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
          <h2 className="text-lg font-black">次の実装予定</h2>
          <p className="mt-2 text-sm leading-7 text-ink/65">
            LINE接続、Webhook、顧客、Inbox、配信、アンケート自動タグは後続マイルストーンで実装します。
          </p>
        </section>
      </div>
    </main>
  );
}

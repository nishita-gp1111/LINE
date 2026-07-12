import Link from "next/link";

export default function HomePage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-2xl rounded-2xl border border-line bg-white p-8 shadow-sm sm:p-12">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-moss">LINE CRM</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
          社内向けLINEマーケティング基盤
        </h1>
        <p className="mt-5 max-w-xl text-base leading-8 text-ink/65">
          Milestone 0の認証・管理画面・Supabase境界を備えた開発用基盤です。
          LINE配信やアンケート業務は後続マイルストーンで追加します。
        </p>
        <Link
          href="/login"
          className="focus-ring mt-8 inline-flex min-h-11 items-center rounded-lg bg-ink px-5 py-3 text-sm font-bold text-white hover:bg-black"
        >
          管理画面へログイン
        </Link>
      </section>
    </main>
  );
}

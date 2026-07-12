import Link from "next/link";

export default function TagsPage() {
  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl">
    <Link href="/admin" className="text-sm text-moss">← 管理画面</Link>
    <h1 className="mt-5 text-3xl font-black">タグ管理</h1>
    <p className="mt-2 text-sm text-ink/65">付与元を保持するタグ基盤です。排他グループを含む変更は監査ログへ記録されます。</p>
    <section className="mt-6 grid gap-4 md:grid-cols-3"><article className="rounded-xl border border-line bg-white p-5"><p className="text-xs font-bold text-ink/50">タググループ</p><p className="mt-2 text-2xl font-black">Mock</p><p className="mt-2 text-sm text-ink/60">同一グループを排他設定できます。</p></article><article className="rounded-xl border border-line bg-white p-5"><p className="text-xs font-bold text-ink/50">付与元</p><p className="mt-2 text-2xl font-black">manual / survey / automation</p><p className="mt-2 text-sm text-ink/60">別の付与元を相互に削除しません。</p></article><article className="rounded-xl border border-line bg-white p-5"><p className="text-xs font-bold text-ink/50">配信抑止</p><p className="mt-2 text-2xl font-black">server enforced</p><p className="mt-2 text-sm text-ink/60">blocked / suppressedは最終送信から除外します。</p></article></section>
  </div></main>;
}

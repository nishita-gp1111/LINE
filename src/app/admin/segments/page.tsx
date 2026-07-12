import Link from "next/link";

export default function SegmentsPage() {
  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">セグメント</h1><p className="mt-2 text-sm text-ink/65">許可済みフィールドだけを組み合わせる動的セグメントです。</p><div className="mt-6 grid gap-4 md:grid-cols-2"><div className="rounded-xl border border-line bg-white p-6"><p className="font-black">条件DSL</p><p className="mt-2 text-sm text-ink/65">AND / OR、ネスト最大3、条件最大20。任意SQLは受け付けません。</p></div><div className="rounded-xl border border-line bg-white p-6"><p className="font-black">配信候補</p><p className="mt-2 text-sm text-ink/65">followingかつeligibleを基本とし、blocked / suppressedは最終送信時にも再除外します。</p></div></div></div></main>;
}

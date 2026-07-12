import Link from "next/link";

export default function TemplatesPage() { return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">メッセージテンプレート</h1><p className="mt-2 text-sm text-ink/65">最大5 message objectsのsnapshotをキャンペーンへ保存します。</p><div className="mt-6 rounded-xl border border-line bg-white p-6"><p className="font-black">対応種別</p><p className="mt-2 text-sm text-ink/65">text / image / video / audio。メディアはready状態のassetからのみURLを解決します。</p></div></div></main>; }

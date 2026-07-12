import Link from "next/link";

export default function AutoRepliesPage() { return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">キーワード自動応答</h1><p className="mt-2 text-sm text-ink/65">reply tokenを保存せず同一Webhook内で優先評価します。flag OFF時は応答しません。</p></div></main>; }

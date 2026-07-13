"use client";
import Link from "next/link";
export default function TrackingSourcesPage() { return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">流入ソース</h1><p className="mt-2 text-sm text-ink/65">sourceはDBのattribution_sourcesへ登録し、deterministic / estimatedを分離して分析します。追跡URLの作成は<a className="ml-1 text-moss underline" href="/admin/tracking/links">こちら</a>。</p></div></main>; }

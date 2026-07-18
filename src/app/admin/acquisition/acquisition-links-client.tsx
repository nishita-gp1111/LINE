"use client";

import { useState } from "react";
import { ACQUISITION_ROUTES } from "@/lib/acquisition/routes";

export function AcquisitionLinksClient({ appUrl }: { appUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  function routeUrl(slug: string): string {
    const origin = appUrl || (typeof window === "undefined" ? "" : window.location.origin);
    return origin ? `${origin}/add/${slug}` : `/add/${slug}`;
  }

  async function copy(slug: string) {
    await navigator.clipboard.writeText(routeUrl(slug));
    setCopied(slug);
    window.setTimeout(() => setCopied((current) => current === slug ? null : current), 1800);
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-600 px-6 py-7 text-white shadow-lg sm:px-8">
          <span className="rounded-full bg-white/15 px-3 py-1 text-[10px] font-black tracking-wide">FRIEND ACQUISITION</span>
          <h1 className="mt-4 text-3xl font-black tracking-tight">流入経路が分かる友だち追加URL</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/80">URLごとに専用の案内ページを表示し、LINEで送られた経路メッセージから顧客へタグを自動付与します。Googleフォームなど外部ブラウザーからでも利用できます。</p>
        </div>

        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="font-black">お客様側の流れ</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-4">
            {["URLをタップ", "LINEを開いて友だち追加", "入力済み文面を送信", "経路タグが自動付与"].map((item, index) => <li key={item} className="flex items-center gap-2 rounded-xl bg-white/75 px-3 py-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-amber-500 text-xs font-black text-white">{index + 1}</span><span className="text-xs font-bold">{item}</span></li>)}
          </ol>
          <p className="mt-3 text-xs leading-5 text-amber-800">LINEの通常の友だち追加イベントには流入元URLが含まれないため、追加後に入力済みメッセージを1回送信すると個人別の経路を確定します。</p>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {ACQUISITION_ROUTES.map((route, index) => {
            const url = routeUrl(route.slug);
            return <article key={route.slug} className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-4"><div><span className={`grid size-10 place-items-center rounded-xl text-sm font-black text-white ${index === 0 ? "bg-emerald-600" : "bg-sky-600"}`}>{index + 1}</span><h2 className="mt-4 text-xl font-black">{route.label}</h2><p className="mt-1 text-xs leading-5 text-ink/50">{route.description}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">有効</span></div>
              <div className="mt-5 rounded-xl bg-paper p-3"><p className="text-[10px] font-black uppercase tracking-wider text-ink/35">共有URL</p><p className="mt-1 break-all text-sm font-bold text-ink/75">{url}</p></div>
              <dl className="mt-4 grid gap-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-ink/45">付与タグ</dt><dd className="font-black">{route.tagName}</dd></div><div className="flex justify-between gap-3"><dt className="text-ink/45">入力済み文面</dt><dd className="text-right font-bold">{route.registrationMessage}</dd></div></dl>
              <div className="mt-5 flex gap-2"><button type="button" onClick={() => void copy(route.slug)} className="focus-ring flex-1 rounded-xl bg-ink px-4 py-3 text-sm font-black text-white">{copied === route.slug ? "コピーしました ✓" : "URLをコピー"}</button><a href={url} target="_blank" rel="noreferrer" className="focus-ring rounded-xl border border-line bg-white px-4 py-3 text-sm font-black text-ink/65">開く</a></div>
            </article>;
          })}
        </section>
      </div>
    </main>
  );
}

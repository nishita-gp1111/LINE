"use client";

import { useState } from "react";
import { SHARED_ACQUISITION_ROUTES, STAFF_ACQUISITION_ROUTES } from "@/lib/acquisition/routes";
import { AssignmentEditor } from "@/app/admin/acquisition/assignment-editor";
import type { AssignmentSettings } from "@/lib/acquisition/assignment";

export function AcquisitionLinksClient({ appUrl, automaticTagging, assignments, canManage }: { appUrl: string; automaticTagging: boolean; assignments: AssignmentSettings; canManage: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const routeColors = ["bg-emerald-600", "bg-sky-600", "bg-orange-500"] as const;

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
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/80">URLごとに専用の案内ページを表示し、友だち追加した顧客へ経路タグを自動付与します。Googleフォームなど外部ブラウザーからでも利用できます。</p>
        </div>

        <section className={`mt-6 rounded-2xl border p-5 text-sm ${automaticTagging ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
          <p className="font-black">お客様側の流れ</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-4">
            {(automaticTagging
              ? ["URLをタップ", "LINEで友だち追加", "本人・友だち状態を確認", "経路タグが自動付与"]
              : ["URLをタップ", "LINEを開いて友だち追加", "入力済み文面を送信", "経路タグが自動付与"]
            ).map((item, index) => <li key={item} className="flex items-center gap-2 rounded-xl bg-white/75 px-3 py-3"><span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-black text-white ${automaticTagging ? "bg-emerald-600" : "bg-amber-500"}`}>{index + 1}</span><span className="text-xs font-bold">{item}</span></li>)}
          </ol>
          <p className={`mt-3 text-xs leading-5 ${automaticTagging ? "text-emerald-800" : "text-amber-800"}`}>
            {automaticTagging
              ? "LIFFでLINE本人・友だち状態・同一Providerをサーバー確認し、メッセージ送信なしで個人別の経路を確定します。"
              : "LIFF設定が未完了のため予備方式で動作中です。追加後に入力済みメッセージを1回送信すると個人別の経路を確定します。"}
          </p>
        </section>

        <section className="mt-6" aria-labelledby="staff-meeting-links-title">
          <h2 id="staff-meeting-links-title" className="text-xl font-black">担当者別の面談URL</h2>
          <p className="mt-2 text-sm leading-6 text-ink/65">各担当者から案内する場合はこちら。未担当のお客様を、そのURLの担当者へ固定で割り当てます。共通アカウントのまま使えます。</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {STAFF_ACQUISITION_ROUTES.map(route => <article key={route.slug} aria-label={`${route.fixedAssigneeName}さん専用URL`} className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-black">{route.label}</h3><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">固定担当：{route.fixedAssigneeName}</span></div>
              <p className="mt-4 break-all rounded-xl bg-paper p-3 text-sm font-bold text-ink/75">{routeUrl(route.slug)}</p>
              <p className="mt-3 text-xs text-ink/55">付与タグ：面談から流入</p>
              <div className="mt-4 flex gap-2"><button type="button" aria-label={`${route.fixedAssigneeName}さん用URLをコピー`} onClick={() => void copy(route.slug)} className="focus-ring flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">{copied === route.slug ? "コピーしました ✓" : "専用URLをコピー"}</button><a href={routeUrl(route.slug)} target="_blank" rel="noreferrer" className="focus-ring rounded-xl border border-line px-4 py-3 text-sm font-bold">開く</a></div>
            </article>)}
          </div>
          <p className="mt-3 text-xs leading-6 text-ink/55">既に担当者がいる方は、その担当者を維持します。複数の専用URLを開いても、最初に決まった担当者から変更しません。専用URLは共通URLの順番を進めず、共通URLの振り分けを停止しても使えます。</p>
        </section>

        <section className="mt-10" aria-labelledby="shared-acquisition-links-title">
          <h2 id="shared-acquisition-links-title" className="text-xl font-black">共通の友だち追加URL</h2>
          <p className="mt-2 text-sm text-ink/65">担当者を指定せず、これまでどおり案内する場合はこちら。</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
          {SHARED_ACQUISITION_ROUTES.map((route, index) => {
            const url = routeUrl(route.slug);
            return <article key={route.slug} className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-4"><div><span className={`grid size-10 place-items-center rounded-xl text-sm font-black text-white ${routeColors[index % routeColors.length]}`}>{index + 1}</span><h2 className="mt-4 text-xl font-black">{route.label}</h2><p className="mt-1 text-xs leading-5 text-ink/50">{route.description}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">有効</span></div>
              <div className="mt-5 rounded-xl bg-paper p-3"><p className="text-[10px] font-black uppercase tracking-wider text-ink/35">共有URL</p><p className="mt-1 break-all text-sm font-bold text-ink/75">{url}</p></div>
              <dl className="mt-4 grid gap-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-ink/45">付与タグ</dt><dd className="font-black">{route.tagName}</dd></div><div className="flex justify-between gap-3"><dt className="text-ink/45">登録方法</dt><dd className="text-right font-bold">{automaticTagging ? "友だち追加後に自動反映" : `予備文面: ${route.registrationMessage}`}</dd></div></dl>
              <div className="mt-5 flex gap-2"><button type="button" onClick={() => void copy(route.slug)} className="focus-ring flex-1 rounded-xl bg-ink px-4 py-3 text-sm font-black text-white">{copied === route.slug ? "コピーしました ✓" : "URLをコピー"}</button><a href={url} target="_blank" rel="noreferrer" className="focus-ring rounded-xl border border-line bg-white px-4 py-3 text-sm font-black text-ink/65">開く</a></div>
              <AssignmentEditor route={route} initial={assignments.rules.find(rule => rule.routeSlug === route.slug)} available={assignments.available} canManage={canManage} />
            </article>;
          })}
          </div>
        </section>
      </div>
    </main>
  );
}

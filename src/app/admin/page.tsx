import Link from "next/link";
import { getAuthMode } from "@/lib/auth/config";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import { getServerEnv } from "@/lib/env/server";

const workflows = [
  { number: "1", title: "顧客へタグを付ける", note: "トーク画面で顧客を選び、右側から付与・解除", href: "/admin/inbox", action: "トークを開く", color: "bg-emerald-600" },
  { number: "2", title: "友だち追加アンケート", note: "トーク上の回答ボタンごとに付与タグを設定", href: "/admin/surveys", action: "アンケートを作る", color: "bg-sky-600" },
  { number: "3", title: "タグ起点の即時メッセージ", note: "タグが付いた直後、その顧客1名へ1通送信", href: "/admin/automations", action: "即時配信を設定", color: "bg-amber-500" },
  { number: "4", title: "タグ別リッチメニュー", note: "条件に合う顧客1名のメニューだけを切替", href: "/admin/rich-menus", action: "メニューを設定", color: "bg-violet-600" },
  { number: "5", title: "複数タグで配信", note: "選択タグをすべて持つ人へ、人数確認後に即時配信", href: "/admin/campaigns", action: "タグ配信を作る", color: "bg-rose-600" },
  { number: "6", title: "流入経路URL", note: "面談・アンケート経由を判別し、自動でタグ付与", href: "/admin/acquisition", action: "URLをコピー", color: "bg-teal-600" }
];

export default async function AdminPage() {
  const user = await requireAuthenticatedUser();
  const mode = getAuthMode();
  const production = getServerEnv().LINE_RECIPIENT_MODE === "all_followers";

  return (
    <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#174f43] via-[#1d725f] to-[#17977b] text-white shadow-lg">
          <div className="grid gap-8 px-6 py-8 sm:px-9 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center lg:py-10">
            <div><span className="rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-black tracking-wide">MINIMUM PRODUCTION LAUNCH</span><h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">今日の顧客対応を、ここから。</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">顧客との1対1トークを中心に、タグ・アンケート・流入経路・即時メッセージ・リッチメニュー・タグ配信を迷わず操作できます。</p><div className="mt-6 flex flex-wrap gap-3"><Link href="/admin/inbox" className="focus-ring rounded-xl bg-white px-5 py-3 text-sm font-black text-emerald-800 shadow-sm">1対1トークを開く</Link><Link href="/admin/acquisition" className="focus-ring rounded-xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-black text-white">流入URLをコピー</Link></div></div>
            <div className="rounded-2xl border border-white/15 bg-black/10 p-5 backdrop-blur"><p className="text-xs font-black text-white/60">現在の運用範囲</p><div className="mt-4 grid gap-3 text-sm">{[production ? "本番フォロワーへ個別送信を許可" : "Sho本人1名だけ送信許可", production ? "タグ配信は人数確認と最終入力が必須" : "一斉・予約・自動返信は停止", "デフォルトリッチメニューは変更禁止"].map((item) => <div key={item} className="flex items-center gap-3"><span className="grid size-6 place-items-center rounded-full bg-emerald-300/20 text-xs text-emerald-200">✓</span><span className="font-bold">{item}</span></div>)}</div></div>
          </div>
        </section>

        <div className="mt-8 flex items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Quick start</p><h2 className="mt-1 text-2xl font-black">6つの運用メニュー</h2><p className="mt-1 text-sm text-ink/45">必要な機能をここから選べます。</p></div><Link href="/admin/settings/line" className="hidden text-xs font-black text-moss hover:underline sm:block">LINE接続状態を確認 →</Link></div>
        <section className="mt-5 grid gap-4 md:grid-cols-2">
          {workflows.map((item) => <Link key={item.number} href={item.href} className="group rounded-2xl border border-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md sm:p-6"><div className="flex items-start gap-4"><span className={`grid size-11 shrink-0 place-items-center rounded-xl text-base font-black text-white ${item.color}`}>{item.number}</span><div className="min-w-0 flex-1"><h3 className="text-lg font-black">{item.title}</h3><p className="mt-1 text-sm leading-6 text-ink/50">{item.note}</p><p className="mt-4 text-xs font-black text-emerald-700 group-hover:underline">{item.action} →</p></div></div></Link>)}
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <article className="rounded-xl border border-line bg-white p-4"><p className="text-[10px] font-black text-ink/40">ログイン中</p><p className="mt-2 truncate text-sm font-black">{user.email}</p></article>
          <article className="rounded-xl border border-line bg-white p-4"><p className="text-[10px] font-black text-ink/40">認証</p><p className="mt-2 text-sm font-black">{mode === "mock" ? "Mock Auth" : "Supabase Auth"}</p></article>
          <Link href="/admin/settings/line" className="rounded-xl border border-line bg-white p-4 transition hover:border-emerald-300"><p className="text-[10px] font-black text-ink/40">LINE接続</p><p className="mt-2 text-sm font-black text-emerald-700">設定・疎通を確認 →</p></Link>
        </section>
      </div>
    </main>
  );
}

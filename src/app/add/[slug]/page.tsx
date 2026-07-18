import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
  acquisitionRouteBySlug,
  buildLineAcquisitionUrl,
  buildLineFriendUrl,
  buildLineLiffAcquisitionUrl
} from "@/lib/acquisition/routes";
import { getServerEnv } from "@/lib/env/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LINEで友だち追加 | GP PRモニター窓口",
  description: "GP PRモニター窓口をLINEで友だち追加します。",
  robots: {
    index: false,
    follow: false
  }
};

export default async function AcquisitionLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const route = acquisitionRouteBySlug(slug);
  if (!route) notFound();

  const env = getServerEnv();
  const basicId = env.LINE_EXPECTED_BASIC_ID;
  if (!basicId) {
    return <UnavailablePage />;
  }

  let messageUrl: string;
  let friendUrl: string;
  let primaryUrl: string;
  let automaticTagging = false;
  try {
    messageUrl = buildLineAcquisitionUrl(basicId, route);
    friendUrl = buildLineFriendUrl(basicId);
    automaticTagging = Boolean(
      env.NEXT_PUBLIC_LIFF_ID &&
      env.LINE_LOGIN_CHANNEL_ID &&
      env.LINE_CHANNEL_ACCESS_TOKEN &&
      env.LINE_ORGANIZATION_ID &&
      env.NEXT_PUBLIC_SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY
    );
    primaryUrl = automaticTagging
      ? buildLineLiffAcquisitionUrl(env.NEXT_PUBLIC_LIFF_ID || "", route)
      : messageUrl;
  } catch {
    return <UnavailablePage />;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#eafff1_0,_#f7fbf8_42%,_#edf3ef_100%)] px-4 py-8 text-slate-900 sm:grid sm:place-items-center sm:py-12">
      <section className="mx-auto w-full max-w-md overflow-hidden rounded-[28px] border border-emerald-950/10 bg-white shadow-[0_24px_70px_rgba(20,83,45,0.14)] md:max-w-3xl">
        <div className="bg-[#06c755] px-6 pb-8 pt-7 text-center text-white">
          <div className="mx-auto grid size-16 place-items-center rounded-[22px] bg-white shadow-lg shadow-emerald-950/15" aria-hidden="true">
            <svg viewBox="0 0 48 48" className="size-10 fill-[#06c755]" role="img">
              <path d="M42 21.1C42 11.7 33.9 4 24 4S6 11.7 6 21.1c0 8.4 6.7 15.5 15.7 16.9.6.1 1.4.4 1.6.9.2.4.1 1.1.1 1.5l-.3 2.8c-.1.8-.4 3.1 2.7 1.7 3.1-1.3 16.7-9.8 16.7-23.8H42Z" />
            </svg>
          </div>
          <p className="mt-4 text-xs font-bold tracking-[0.18em] text-white/80">GP PRモニター窓口</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">LINEで続きを受け取る</h1>
          <p className="mt-3 text-sm font-medium leading-6 text-white/90">下のボタンから、友だち追加とご案内登録を進めます。</p>
        </div>

        <div className="md:grid md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="px-5 py-6 sm:px-7 md:py-8">
            <ol className="space-y-3" aria-label="友だち追加の手順">
              <Step number="1" title="LINEアプリを開く" detail="下の緑色のボタンをタップします。" />
              <Step number="2" title="友だち追加する" detail="表示されたGP PRモニター窓口を追加します。" />
              <Step
                number="3"
                title={automaticTagging ? "そのまま登録完了" : "入力済みメッセージを送る"}
                detail={automaticTagging ? "友だち追加を確認後、ご案内経路を自動で登録します。" : "送信すると、ご案内内容をあなたに合わせられます。"}
              />
            </ol>

            <a
              href={primaryUrl}
              className="focus-ring mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#06c755] px-5 py-4 text-base font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-[#05b94f] active:translate-y-px"
            >
              <svg viewBox="0 0 24 24" className="size-6 fill-current" aria-hidden="true">
                <path d="M20.5 10.2c0-4.1-3.8-7.4-8.5-7.4s-8.5 3.3-8.5 7.4c0 3.7 3.1 6.8 7.4 7.3.3.1.7.2.8.4.1.2.1.5 0 .7l-.1 1.2c0 .4-.2 1.3 1.3.7 1.4-.6 7.6-4.2 7.6-10.3Z" />
              </svg>
              LINEアプリを開く
            </a>
            <p className="mt-3 text-center text-xs font-medium leading-5 text-slate-500">Chrome・Safariから利用できます。LINEが確認画面を表示した場合は「開く」を選んでください。</p>

            <details className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-1 text-sm">
              <summary className="focus-ring -mx-1 flex min-h-12 items-center justify-between rounded-xl px-1 font-bold text-slate-700">
                LINEが開かない場合
                <span aria-hidden="true" className="text-slate-400">＋</span>
              </summary>
              <div className="border-t border-slate-200 pb-4 pt-4">
                <p className="text-xs leading-5 text-slate-600">まず友だち追加画面を開き、追加後にこのページへ戻ってメッセージ画面を開いてください。</p>
                <div className="mt-3 grid gap-2">
                  <a href={friendUrl} className="focus-ring rounded-xl border border-[#06c755] bg-white px-4 py-3 text-center text-sm font-black text-[#079447]">1. 友だち追加画面を開く</a>
                  <a href={messageUrl} className="focus-ring rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-black text-slate-700">2. メッセージ画面を開く</a>
                </div>
                <p className="mt-3 text-center text-[11px] text-slate-400">LINE ID: {basicId}</p>
              </div>
            </details>

            <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">
              {automaticTagging
                ? "LINEの認証情報は、友だち状態と登録先を安全に確認するためだけに使用します。"
                : "予備方式では、送信された経路メッセージから登録先を確認します。"}
            </p>
          </div>

          <aside className="hidden border-l border-emerald-900/10 bg-emerald-50/70 px-7 py-8 text-center md:flex md:flex-col md:items-center md:justify-center" aria-label="パソコン用QRコード">
            <span className="rounded-full bg-emerald-700 px-3 py-1 text-[10px] font-black tracking-[0.12em] text-white">パソコンで閲覧中の方</span>
            <h2 className="mt-4 text-xl font-black tracking-tight">スマホで読み取る</h2>
            <p className="mt-2 text-xs font-medium leading-5 text-slate-500">カメラをかざすと、LINEアプリが開きます。</p>
            <div className="mt-5 rounded-2xl border border-emerald-900/10 bg-white p-3 shadow-sm" data-qr-destination={primaryUrl}>
              <QRCodeSVG
                value={primaryUrl}
                size={200}
                level="M"
                bgColor="#ffffff"
                fgColor="#13261b"
                title={`${route.label}のLINE友だち追加QRコード`}
              />
            </div>
            <p className="mt-4 text-xs font-black text-emerald-800">{automaticTagging ? "読み取り → 友だち追加 → 登録完了" : "読み取り → 友だち追加 → 送信"}</p>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">{automaticTagging ? "メッセージ送信なしで経路タグを反映します。" : "送信画面には流入確認メッセージが入力されています。"}</p>
          </aside>
        </div>
      </section>
    </main>
  );
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-slate-50 p-3.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-black text-emerald-700">{number}</span>
      <span>
        <span className="block text-sm font-black">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{detail}</span>
      </span>
    </li>
  );
}

function UnavailablePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-5 text-center">
      <section className="max-w-sm rounded-3xl bg-white p-8 shadow-sm">
        <h1 className="text-xl font-black">現在LINEを開けません</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">恐れ入りますが、時間をおいてもう一度お試しください。</p>
      </section>
    </main>
  );
}

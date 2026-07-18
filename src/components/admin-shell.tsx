"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: string;
};

const sections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "顧客対応",
    items: [
      { href: "/admin/inbox", label: "1対1トーク", description: "会話・返信・顧客情報", icon: "💬" },
      { href: "/admin/contacts", label: "顧客一覧", description: "友だちと履歴", icon: "👥" },
      { href: "/admin/tags", label: "タグ管理", description: "分類ラベルを作成", icon: "🏷" },
      { href: "/admin/acquisition", label: "流入経路URL", description: "追加元ごとにタグ付与", icon: "↗" }
    ]
  },
  {
    label: "自動アクション",
    items: [
      { href: "/admin/surveys", label: "アンケート", description: "回答ボタンでタグ付与", icon: "☑" },
      { href: "/admin/automations", label: "タグ起点メッセージ", description: "付与直後に1通送信", icon: "⚡" },
      { href: "/admin/rich-menus", label: "リッチメニュー", description: "タグ別に個別切替", icon: "▦" }
    ]
  },
  {
    label: "配信",
    items: [
      { href: "/admin/campaigns", label: "タグ配信", description: "複数タグで対象を絞る", icon: "✉" }
    ]
  },
  {
    label: "設定",
    items: [
      { href: "/admin/settings/line", label: "LINE接続", description: "Webhook・接続確認", icon: "⚙" }
    ]
  }
];

const homeItem: NavItem = { href: "/admin", label: "ホーム", description: "今日の運用メニュー", icon: "⌂" };

function active(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname, compact = false }: { item: NavItem; pathname: string; compact?: boolean }) {
  const selected = active(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={selected ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${selected ? "bg-emerald-500 text-white shadow-sm" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
    >
      <span className={`grid size-8 shrink-0 place-items-center rounded-lg text-sm ${selected ? "bg-white/15" : "bg-white/5 group-hover:bg-white/10"}`}>{item.icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black">{item.label}</span>
        {!compact ? <span className={`mt-0.5 block truncate text-[10px] ${selected ? "text-white/75" : "text-white/45"}`}>{item.description}</span> : null}
      </span>
    </Link>
  );
}

function Navigation({ pathname, compact = false }: { pathname: string; compact?: boolean }) {
  return (
    <nav aria-label="管理画面メニュー" className="grid gap-5">
      <div><NavLink item={homeItem} pathname={pathname} compact={compact} /></div>
      {sections.map((section) => (
        <section key={section.label}>
          {!compact ? <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{section.label}</p> : null}
          <div className="grid gap-1">
            {section.items.map((item) => <NavLink key={item.href} item={item} pathname={pathname} compact={compact} />)}
          </div>
        </section>
      ))}
    </nav>
  );
}

export function AdminShell({ userEmail, recipientMode, children }: { userEmail: string; recipientMode: "controlled" | "all_followers"; children: ReactNode }) {
  const pathname = usePathname();
  const current = [homeItem, ...sections.flatMap((section) => section.items)].find((item) => active(pathname, item.href)) || homeItem;

  return (
    <div className="min-h-screen bg-[#eef2f0]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col bg-[#263331] text-white md:flex">
        <Link href="/admin" className="flex h-16 items-center gap-3 border-b border-white/10 bg-gradient-to-r from-emerald-500 to-teal-600 px-5">
          <span className="grid size-9 place-items-center rounded-xl bg-white text-lg font-black text-emerald-600 shadow-sm">L</span>
          <span><span className="block text-base font-black tracking-tight">LINE CRM</span><span className="block text-[10px] font-bold text-white/75">Minimum Launch</span></span>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 py-5"><Navigation pathname={pathname} /></div>
        <div className="border-t border-white/10 p-4">
          <div className="rounded-xl bg-white/5 p-3">
            <div className="flex items-center gap-2 text-xs font-black"><span className="size-2 rounded-full bg-emerald-400" />{recipientMode === "all_followers" ? "本番運用モード" : "Sho本人限定モード"}</div>
            <p className="mt-1 text-[10px] leading-4 text-white/45">{recipientMode === "all_followers" ? "タグ配信は対象確認と最終入力が必要" : "一斉配信・予約配信・自動返信は停止中"}</p>
          </div>
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center border-b border-black/5 bg-white/95 px-3 shadow-sm backdrop-blur md:left-[248px] sm:px-5">
        <details className="group relative mr-3 md:hidden">
          <summary className="focus-ring grid size-10 cursor-pointer list-none place-items-center rounded-xl bg-[#263331] text-lg text-white marker:content-none">☰</summary>
          <div className="absolute left-0 top-12 w-[286px] rounded-2xl bg-[#263331] p-3 shadow-2xl"><Navigation pathname={pathname} compact /></div>
        </details>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-ink">{current.label}</p>
          <p className="truncate text-[11px] text-ink/45">{current.description}</p>
        </div>
        <div className="hidden min-w-0 items-center gap-3 sm:flex">
          <div className="min-w-0 text-right"><p className="truncate text-xs font-bold text-ink/70">{userEmail}</p><p className="text-[10px] text-ink/40">管理者</p></div>
          <LogoutButton />
        </div>
      </header>

      <div className="min-w-0 pt-16 md:pl-[248px]">{children}</div>
    </div>
  );
}

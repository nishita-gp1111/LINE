"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useEffect, useState } from "react";

type Menu = { id: string; name: string; status: string; linkCount: number };
type Tag = { id: string; name: string };

export default function RichMenusPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [tagId, setTagId] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [menuResponse, tagResponse] = await Promise.all([fetch("/api/milestone3/interactive?resource=menus"), fetch("/api/milestone3/foundation?resource=tags")]);
    const data = await menuResponse.json() as { menus?: Menu[] };
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    setMenus(data.menus ?? []);
    setTags(tagData.tags ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    const definition = { width: 2500, height: 1686, chatBarText: "メニュー", selected: false, areas: [{ x: 0, y: 0, width: 1250, height: 843, action: { type: "uri", uri: "https://example.com" } }] };
    const data = await (await fetch("/api/milestone3/interactive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rich_menu_create", name, tagId: tagId || undefined, definition }) })).json() as { error?: string };
    setMessage(data.error || "リッチメニューを作成しました。");
    if (!data.error) { setName(""); setTagId(""); await load(); }
  }

  async function menuAction(action: string, id?: string) {
    const body = id ? { action, id } : { action };
    const data = await (await fetch("/api/milestone3/interactive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as { error?: string; richMenuId?: string };
    setMessage(data.error || (action === "rich_menu_user_get" ? `現在のユーザー別メニュー: ${data.richMenuId || "未設定"}` : "処理しました。"));
    await load();
  }

  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">リッチメニュー</h1><p className="mt-2 text-sm text-ink/65">Liveではテストユーザー1名だけへ紐付けます。デフォルトメニューは変更しません。</p><section className="mt-6 rounded-xl border border-line bg-white p-6"><div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="メニュー名" className="min-h-10 rounded border border-line px-3 text-sm" /><select value={tagId} onChange={(event) => setTagId(event.target.value)} className="min-h-10 rounded border border-line px-3 text-sm"><option value="">タグ条件なし</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}が付いた顧客</option>)}</select><button onClick={() => void create()} disabled={!name.trim()} className="rounded bg-ink px-3 py-2 text-sm font-bold text-white disabled:opacity-40">作成</button></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void menuAction("rich_menu_user_get")} className="rounded border border-line px-3 py-2 text-sm font-bold">現在のユーザーメニュー確認</button></div>{message ? <p className="mt-3 text-sm text-moss">{message}</p> : null}</section><section className="mt-6 rounded-xl border border-line bg-white p-6">{menus.map((menu) => <div key={menu.id} className="mt-2 flex flex-wrap justify-between gap-2 rounded border border-line p-3 text-sm"><span>{menu.name} / {menu.status} / links {menu.linkCount}</span><span className="flex gap-2"><button onClick={() => void menuAction("rich_menu_test_link", menu.id)} className="font-bold text-moss">テストユーザーへ紐付け</button><button onClick={() => void menuAction("rich_menu_restore")} className="font-bold text-coral">元へ戻す</button></span></div>)}</section></div></main>;
}

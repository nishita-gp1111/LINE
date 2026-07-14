"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useEffect, useState } from "react";

type Menu = { id: string; name: string; status: string; linkCount: number; tagId: string | null; tagName: string | null };
type Tag = { id: string; name: string };

export default function RichMenusPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: "", tagId: "", chatBarText: "メニュー", actionType: "uri", actionValue: "", applyExisting: true });
  const [image, setImage] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const [menuResponse, tagResponse] = await Promise.all([fetch("/api/milestone3/interactive?resource=menus"), fetch("/api/milestone3/foundation?resource=tags")]);
    const data = await menuResponse.json() as { menus?: Menu[] };
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    setMenus(data.menus ?? []);
    setTags(tagData.tags ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    if (!image) return;
    setWorking(true);
    try {
      const body = new FormData();
      body.set("name", form.name);
      body.set("tagId", form.tagId);
      body.set("chatBarText", form.chatBarText);
      body.set("actionType", form.actionType);
      body.set("actionValue", form.actionValue);
      body.set("applyExisting", String(form.applyExisting));
      body.set("image", image);
      const data = await (await fetch("/api/milestone3/rich-menus", { method: "POST", body })).json() as { error?: string; menu?: { appliedCount?: number; failedCount?: number } };
      setMessage(data.error || `リッチメニューを作成し、${data.menu?.appliedCount || 0}名へ反映しました。${data.menu?.failedCount ? ` 未反映: ${data.menu.failedCount}名` : ""}`);
      if (!data.error) { setForm({ name: "", tagId: "", chatBarText: "メニュー", actionType: "uri", actionValue: "", applyExisting: true }); setImage(null); setFileKey((value) => value + 1); await load(); }
    } finally { setWorking(false); }
  }

  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">タグ別リッチメニュー</h1><p className="mt-2 text-sm text-ink/65">タグが付くとユーザー単位で切り替え、対象タグがなくなると元のメニューへ戻します。デフォルトリッチメニューは変更しません。</p><section className="mt-6 rounded-xl border border-line bg-white p-6"><div className="grid gap-3"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={150} placeholder="管理用メニュー名" className="rounded border border-line px-3 py-2 text-sm" /><select value={form.tagId} onChange={(event) => setForm({ ...form, tagId: event.target.value })} className="rounded border border-line px-3 py-2 text-sm"><option value="">切替条件のタグを選択</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}が付いた顧客</option>)}</select><input value={form.chatBarText} onChange={(event) => setForm({ ...form, chatBarText: event.target.value })} maxLength={14} placeholder="チャットバー文字" className="rounded border border-line px-3 py-2 text-sm" /><div className="grid gap-2 sm:grid-cols-[12rem_1fr]"><select value={form.actionType} onChange={(event) => setForm({ ...form, actionType: event.target.value })} className="rounded border border-line px-3 py-2 text-sm"><option value="uri">URLを開く</option><option value="message">メッセージを送る</option></select><input value={form.actionValue} onChange={(event) => setForm({ ...form, actionValue: event.target.value })} placeholder={form.actionType === "uri" ? "https://example.com" : "タップ時に送るメッセージ"} className="rounded border border-line px-3 py-2 text-sm" /></div><label className="grid gap-1 text-xs font-bold text-ink/60">メニュー画像（JPEG/PNG、1MB以下、幅800〜2500px・高さ250px以上・縦横比1.45以上）<input key={fileKey} type="file" accept="image/jpeg,image/png" onChange={(event) => setImage(event.target.files?.[0] || null)} className="rounded border border-line px-3 py-2 text-sm font-normal" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.applyExisting} onChange={(event) => setForm({ ...form, applyExisting: event.target.checked })} />すでにこのタグを持つ顧客にも反映する</label><button onClick={() => void create()} disabled={working || !form.name.trim() || !form.tagId || !form.chatBarText.trim() || !form.actionValue.trim() || !image} className="rounded bg-ink px-3 py-2 text-sm font-bold text-white disabled:opacity-40">画像をアップロードして作成</button></div>{message ? <p className="mt-3 text-sm text-moss">{message}</p> : null}</section><section className="mt-6 rounded-xl border border-line bg-white p-6"><h2 className="font-black">メニュー一覧</h2>{menus.map((menu) => <div key={menu.id} className="mt-2 flex flex-wrap justify-between gap-2 rounded border border-line p-3 text-sm"><span><b>{menu.name}</b> / {menu.status}</span><span>{menu.tagName ? `${menu.tagName} → ` : "条件なし / "}{menu.linkCount}名に適用中</span></div>)}</section></div></main>;
}

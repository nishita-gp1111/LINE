"use client";

/* eslint-disable @next/next/no-img-element, react-hooks/set-state-in-effect */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  RICH_MENU_LAYOUTS,
  getRichMenuLayout,
  type RichMenuActionInput,
  type RichMenuLayout,
  type RichMenuLayoutId
} from "@/lib/minimum-launch/rich-menu-layouts";
import { createFriendlyRichMenuFile, GP_FRIENDLY_RICH_MENU_PRESET } from "@/lib/minimum-launch/rich-menu-preset";

type Menu = {
  id: string;
  name: string;
  status: string;
  linkCount?: number;
  links?: string[];
  tagId?: string | null;
  tagName?: string | null;
};
type Tag = { id: string; name: string };

const EMPTY_ACTION: RichMenuActionInput = { type: "uri", value: "" };

function makeActions(count: number, current: RichMenuActionInput[] = []): RichMenuActionInput[] {
  return Array.from({ length: count }, (_, index) => current[index] ? { ...current[index] } : { ...EMPTY_ACTION });
}

function actionError(action: RichMenuActionInput): string | null {
  const value = action.value.trim();
  if (!value) return "動作を入力してください。";
  if (action.type === "message") return value.length <= 300 ? null : "送信メッセージは300文字以内にしてください。";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "URLはhttpまたはhttpsで入力してください。";
    return value.length <= 1_000 ? null : "URLは1000文字以内にしてください。";
  } catch {
    return "正しいURLを入力してください。";
  }
}

function StepHeading({ number, title, description }: { number: number; title: string; description: string }) {
  return <div className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-moss text-xs font-black text-white">{number}</span><div><h2 className="font-black">{title}</h2><p className="mt-0.5 text-xs leading-relaxed text-ink/55">{description}</p></div></div>;
}

function LayoutThumbnail({ layout }: { layout: RichMenuLayout }) {
  return <div className="relative aspect-[5/3] overflow-hidden rounded-md border border-ink/20 bg-white">
    {layout.areas.map((area, index) => <span
      key={`${layout.id}-${index}`}
      className="absolute grid place-items-center border border-moss/45 bg-moss/10 text-[10px] font-black text-moss"
      style={{ left: `${area.x / 100}%`, top: `${area.y / 100}%`, width: `${area.width / 100}%`, height: `${area.height / 100}%` }}
    >{index + 1}</span>)}
  </div>;
}

export default function RichMenusPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: "", tagId: "", chatBarText: "メニュー", applyExisting: true });
  const [layoutId, setLayoutId] = useState<RichMenuLayoutId>("single");
  const [actions, setActions] = useState<RichMenuActionInput[]>([{ ...EMPTY_ACTION }]);
  const [selectedArea, setSelectedArea] = useState(0);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const layout = useMemo(() => getRichMenuLayout(layoutId), [layoutId]);
  const selectedAction = actions[selectedArea] ?? EMPTY_ACTION;
  const configuredCount = actions.filter((action) => !actionError(action)).length;
  const allActionsValid = configuredCount === layout.areas.length;

  async function load() {
    const [menuResponse, tagResponse] = await Promise.all([
      fetch("/api/milestone3/interactive?resource=menus"),
      fetch("/api/milestone3/foundation?resource=tags")
    ]);
    const data = await menuResponse.json() as { menus?: Menu[] };
    const tagData = await tagResponse.json() as { tags?: Tag[] };
    setMenus(data.menus ?? []);
    setTags(tagData.tags ?? []);
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!image) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function chooseLayout(nextId: RichMenuLayoutId) {
    const nextLayout = getRichMenuLayout(nextId);
    setLayoutId(nextId);
    setActions((current) => makeActions(nextLayout.areas.length, current));
    setSelectedArea(0);
    setMessage("");
  }

  function updateSelectedAction(patch: Partial<RichMenuActionInput>) {
    setActions((current) => current.map((action, index) => index === selectedArea ? { ...action, ...patch } as RichMenuActionInput : action));
  }

  function resetForm() {
    setForm({ name: "", tagId: "", chatBarText: "メニュー", applyExisting: true });
    setLayoutId("single");
    setActions([{ ...EMPTY_ACTION }]);
    setSelectedArea(0);
    setImage(null);
    setFileKey((value) => value + 1);
  }

  async function applyFriendlyPreset() {
    setWorking(true);
    setMessage("");
    try {
      const presetImage = await createFriendlyRichMenuFile();
      const presetTag = tags.find((tag) => tag.name === GP_FRIENDLY_RICH_MENU_PRESET.tagName);
      setForm({
        name: GP_FRIENDLY_RICH_MENU_PRESET.name,
        tagId: presetTag?.id ?? "",
        chatBarText: GP_FRIENDLY_RICH_MENU_PRESET.chatBarText,
        applyExisting: GP_FRIENDLY_RICH_MENU_PRESET.applyExisting
      });
      setLayoutId(GP_FRIENDLY_RICH_MENU_PRESET.layoutId);
      setActions(GP_FRIENDLY_RICH_MENU_PRESET.actions.map((action) => ({ ...action })));
      setSelectedArea(0);
      setImage(presetImage);
      setFileKey((value) => value + 1);
      setMessage(presetTag ? "おすすめ設定を入力しました。プレビューを確認して作成してください。" : "画像とボタンを入力しました。「基本メニュー表示」タグを選んでください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "おすすめデザインを生成できませんでした。");
    } finally {
      setWorking(false);
    }
  }

  async function create() {
    if (!image || !allActionsValid) return;
    setWorking(true);
    setMessage("");
    try {
      const body = new FormData();
      body.set("name", form.name);
      body.set("tagId", form.tagId);
      body.set("chatBarText", form.chatBarText);
      body.set("layoutId", layoutId);
      body.set("actions", JSON.stringify(actions));
      body.set("applyExisting", String(form.applyExisting));
      body.set("image", image);
      const response = await fetch("/api/milestone3/rich-menus", { method: "POST", body });
      const data = await response.json() as { error?: string; menu?: { appliedCount?: number; failedCount?: number } };
      if (!response.ok || data.error) {
        setMessage(data.error || "リッチメニューを作成できませんでした。");
        return;
      }
      setMessage(`リッチメニューを作成し、${data.menu?.appliedCount || 0}名へ反映しました。${data.menu?.failedCount ? ` 未反映: ${data.menu.failedCount}名` : ""}`);
      resetForm();
      await load();
    } catch {
      setMessage("通信に失敗しました。時間をおいてもう一度お試しください。");
    } finally {
      setWorking(false);
    }
  }

  const canCreate = !working && Boolean(form.name.trim() && form.tagId && form.chatBarText.trim() && image && allActionsValid);

  return <main className="min-h-screen px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
    <div className="mx-auto max-w-7xl">
      <Link href="/admin" className="text-sm font-bold text-moss">← 管理画面</Link>
      <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-moss">Rich menu builder</p><h1 className="mt-1 text-3xl font-black">タグ別リッチメニュー</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/60">レイアウトを選び、画像上のボタンごとに動作を設定します。タグが付いた顧客だけ、ユーザー単位でメニューが切り替わります。</p></div>
        <Link href="/admin/tags" className="w-fit rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold text-ink/70 shadow-sm">タグを管理</Link>
      </div>

      <div className="mt-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
        <span aria-hidden="true" className="text-lg">🛡️</span><div><p className="font-black">個別切替専用の安全設計</p><p className="mt-0.5 text-xs leading-relaxed text-emerald-900/75">LINE公式アカウントのデフォルトメニューや全ユーザーの設定は変更しません。タグ条件に一致する許可済みユーザーだけへ反映します。</p></div>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)]">
        <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="border-b border-line p-5 sm:p-6">
            <StepHeading number={1} title="基本情報を設定" description="管理用の名前と、切替条件にするタグを選びます。" />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-black text-ink/65">管理用メニュー名
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={150} placeholder="例：Web広告のお客様用" className="focus-ring rounded-lg border border-line bg-paper/40 px-3 py-2.5 text-sm font-normal text-ink" />
              </label>
              <label className="grid gap-1.5 text-xs font-black text-ink/65">切替条件のタグ
                <select value={form.tagId} onChange={(event) => setForm({ ...form, tagId: event.target.value })} className="focus-ring rounded-lg border border-line bg-paper/40 px-3 py-2.5 text-sm font-normal text-ink">
                  <option value="">タグを選択</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name} が付いた顧客</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-black text-ink/65 sm:col-span-2">トーク画面下の表示名
                <input value={form.chatBarText} onChange={(event) => setForm({ ...form, chatBarText: event.target.value })} maxLength={14} placeholder="メニュー" className="focus-ring rounded-lg border border-line bg-paper/40 px-3 py-2.5 text-sm font-normal text-ink" />
                <span className="text-[11px] font-normal text-ink/45">ユーザーがメニューを開閉するバーに表示されます（14文字以内）。</span>
              </label>
            </div>
          </div>

          <div className="border-b border-line p-5 sm:p-6">
            <StepHeading number={2} title="ボタンの数と位置を選択" description="画像のどこをタップできるようにするか、見た目で選べます。" />
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {RICH_MENU_LAYOUTS.map((candidate) => <button key={candidate.id} type="button" aria-pressed={layoutId === candidate.id} onClick={() => chooseLayout(candidate.id)} className={`focus-ring rounded-xl border p-2 text-left transition ${layoutId === candidate.id ? "border-moss bg-emerald-50 shadow-[0_0_0_1px_#2e6b5b]" : "border-line bg-white hover:border-moss/50 hover:bg-paper/40"}`}>
                <LayoutThumbnail layout={candidate} /><span className="mt-2 flex items-center justify-between gap-1 text-xs"><b>{candidate.label}</b><span className="text-[10px] text-ink/45">{candidate.description}</span></span>
              </button>)}
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <StepHeading number={3} title="各ボタンの動作を設定" description="プレビューまたは下の番号を選び、タップ後の動作を入力します。" />
            <div className="mt-5 flex flex-wrap gap-2">
              {actions.map((action, index) => {
                const complete = !actionError(action);
                return <button key={index} type="button" onClick={() => setSelectedArea(index)} className={`focus-ring flex min-w-24 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${selectedArea === index ? "border-moss bg-moss text-white" : "border-line bg-white text-ink/65"}`}><span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${selectedArea === index ? "bg-white/20" : complete ? "bg-emerald-100 text-emerald-800" : "bg-paper text-ink/45"}`}>{complete ? "✓" : index + 1}</span>エリア {index + 1}</button>;
              })}
            </div>
            <div className="mt-4 rounded-xl border border-line bg-paper/35 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black">エリア {selectedArea + 1} の動作</p><span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-ink/50">設定済み {configuredCount} / {layout.areas.length}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-white p-1">
                <button type="button" onClick={() => updateSelectedAction({ type: "uri", value: "" })} className={`focus-ring rounded-md px-3 py-2 text-sm font-bold ${selectedAction.type === "uri" ? "bg-moss text-white" : "text-ink/55"}`}>Webページを開く</button>
                <button type="button" onClick={() => updateSelectedAction({ type: "message", value: "" })} className={`focus-ring rounded-md px-3 py-2 text-sm font-bold ${selectedAction.type === "message" ? "bg-moss text-white" : "text-ink/55"}`}>メッセージを送る</button>
              </div>
              <label className="mt-4 grid gap-1.5 text-xs font-black text-ink/65">{selectedAction.type === "uri" ? "開くURL" : "タップ時に送るメッセージ"}
                {selectedAction.type === "uri" ? <input value={selectedAction.value} onChange={(event) => updateSelectedAction({ value: event.target.value })} maxLength={1_000} placeholder="https://example.com" inputMode="url" className="focus-ring rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-normal text-ink" /> : <textarea value={selectedAction.value} onChange={(event) => updateSelectedAction({ value: event.target.value })} maxLength={300} rows={3} placeholder="例：詳しいメニューを見せて" className="focus-ring resize-y rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-normal text-ink" />}
              </label>
              <p className={`mt-2 text-xs ${selectedAction.value.trim() && actionError(selectedAction) ? "font-bold text-red-600" : "text-ink/45"}`}>{selectedAction.value.trim() ? actionError(selectedAction) || "このエリアの設定は完了です。" : selectedAction.type === "uri" ? "タップするとLINE内ブラウザでこのURLを開きます。" : "タップすると、この文言がユーザーから送信されます。"}</p>
            </div>
          </div>
        </section>

        <aside className="space-y-6 lg:sticky lg:top-6">
          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-moss">Live preview</p><h2 className="mt-1 font-black">タップ領域プレビュー</h2></div><span className="rounded-full bg-paper px-3 py-1 text-xs font-bold text-ink/50">{layout.label}・{layout.description}</span></div>
            <p className="mt-2 text-xs leading-relaxed text-ink/50">枠をクリックすると、そのエリアの動作設定へ移動します。</p>
            <div className="mt-4 overflow-hidden rounded-xl bg-[#dce5e1] p-3 sm:p-5">
              <div className={`relative overflow-hidden rounded-lg bg-gradient-to-br from-white to-[#d6e8df] shadow-lg ${previewUrl ? "" : "aspect-[2500/1686]"}`}>
                {previewUrl ? <img src={previewUrl} alt="アップロードしたリッチメニュー画像" className="block h-auto w-full" /> : <div className="absolute inset-0 grid place-items-center px-8 text-center"><div><span className="text-3xl" aria-hidden="true">🖼️</span><p className="mt-2 text-xs font-bold text-ink/50">画像を選ぶと、ここに仕上がりが表示されます</p></div></div>}
                <div className="absolute inset-0">
                  {layout.areas.map((area, index) => {
                    const complete = !actionError(actions[index] ?? EMPTY_ACTION);
                    return <button key={index} type="button" aria-label={`エリア${index + 1}を編集`} onClick={() => setSelectedArea(index)} className={`focus-ring absolute grid place-items-center border-2 transition ${selectedArea === index ? "z-10 border-[#0a8f61] bg-[#0a8f61]/25 shadow-[inset_0_0_0_1px_white]" : "border-white/90 bg-black/10 hover:bg-[#0a8f61]/20"}`} style={{ left: `${area.x / 100}%`, top: `${area.y / 100}%`, width: `${area.width / 100}%`, height: `${area.height / 100}%` }}><span className={`grid h-7 min-w-7 place-items-center rounded-full px-2 text-xs font-black shadow ${complete ? "bg-[#0a8f61] text-white" : "bg-white text-ink/70"}`}>{complete ? `✓ ${index + 1}` : index + 1}</span></button>;
                  })}
                </div>
              </div>
              <div className="mx-auto mt-2 h-1.5 w-1/3 rounded-full bg-ink/20" />
            </div>
            <label className="mt-5 grid gap-1.5 text-xs font-black text-ink/65">メニュー画像
              <input key={fileKey} type="file" accept="image/jpeg,image/png" onChange={(event) => setImage(event.target.files?.[0] || null)} className="focus-ring rounded-lg border border-dashed border-moss/40 bg-emerald-50/40 px-3 py-3 text-xs font-normal" />
              <span className="text-[11px] font-normal leading-relaxed text-ink/45">JPEG/PNG、1MB以下、幅800〜2500px・高さ250px以上・横長画像に対応。</span>
            </label>
            <button type="button" onClick={() => void applyFriendlyPreset()} disabled={working} className="focus-ring mt-3 w-full rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-900 shadow-sm transition hover:bg-emerald-100 disabled:opacity-40">✨ GPおすすめデザインを使う</button>
            <p className="mt-2 text-center text-[11px] leading-relaxed text-ink/45">明るい3ボタン画像・予約URL・チャット・会社情報をまとめて入力します。</p>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-black">作成前の確認</h2>
            <div className="mt-4 grid gap-2 text-xs">
              <p className={`flex items-center gap-2 rounded-lg px-3 py-2 ${form.name.trim() && form.tagId ? "bg-emerald-50 text-emerald-900" : "bg-paper text-ink/55"}`}><b>{form.name.trim() && form.tagId ? "✓" : "1"}</b> 名前とタグ</p>
              <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900"><b>✓</b> {layout.label}（{layout.description}）</p>
              <p className={`flex items-center gap-2 rounded-lg px-3 py-2 ${allActionsValid ? "bg-emerald-50 text-emerald-900" : "bg-paper text-ink/55"}`}><b>{allActionsValid ? "✓" : "3"}</b> ボタン動作 {configuredCount}/{layout.areas.length}</p>
              <p className={`flex items-center gap-2 rounded-lg px-3 py-2 ${image ? "bg-emerald-50 text-emerald-900" : "bg-paper text-ink/55"}`}><b>{image ? "✓" : "4"}</b> {image ? image.name : "画像を選択"}</p>
            </div>
            <label className="mt-4 flex items-start gap-2 rounded-lg border border-line p-3 text-xs leading-relaxed"><input type="checkbox" checked={form.applyExisting} onChange={(event) => setForm({ ...form, applyExisting: event.target.checked })} className="mt-0.5" /><span><b className="block">既存の対象顧客にも反映</b>すでにこのタグを持つ許可済み顧客へ、作成後すぐ切り替えます。</span></label>
            <button type="button" onClick={() => void create()} disabled={!canCreate} className="focus-ring mt-4 w-full rounded-xl bg-ink px-4 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-35">{working ? "作成しています…" : "リッチメニューを作成"}</button>
            {message ? <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${message.includes("作成し、") ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{message}</p> : null}
          </section>
        </aside>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-black">作成済みメニュー</h2><p className="mt-1 text-xs text-ink/50">タグ条件ごとの適用状況を確認できます。</p></div><span className="rounded-full bg-paper px-3 py-1 text-xs font-bold text-ink/55">{menus.length}件</span></div>
        {menus.length ? <div className="mt-4 grid gap-2">{menus.map((menu) => <div key={menu.id} className="flex flex-col justify-between gap-2 rounded-xl border border-line p-4 text-sm sm:flex-row sm:items-center"><span><b>{menu.name}</b><span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">{menu.status}</span></span><span className="text-xs text-ink/55">{menu.tagName ? `${menu.tagName} → ` : "条件なし / "}{menu.linkCount ?? menu.links?.length ?? 0}名に適用中</span></div>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-line bg-paper/35 py-8 text-center text-sm text-ink/45">作成済みのリッチメニューはまだありません。</div>}
      </section>
    </div>
  </main>;
}

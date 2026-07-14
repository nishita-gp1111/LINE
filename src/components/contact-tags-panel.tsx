"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Tag = { id: string; name: string };
type Assignment = { id: string; contactId: string; tagId: string; sourceType: string };

function sourceLabel(sourceType: string): string {
  if (sourceType === "survey") return "アンケート回答";
  if (sourceType === "automation") return "自動処理";
  return "手動";
}

export function ContactTagsPanel({ contactId, compact = false }: { contactId: string; compact?: boolean }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const response = await fetch("/api/milestone3/foundation?resource=tags");
    const data = await response.json() as { tags?: Tag[]; assignments?: Assignment[] };
    setTags(data.tags ?? []);
    setAssignments((data.assignments ?? []).filter((item) => item.contactId === contactId));
  }

  useEffect(() => { void load(); }, [contactId]);

  const availableTags = useMemo(
    () => tags.filter((tag) => !assignments.some((assignment) => assignment.tagId === tag.id)),
    [tags, assignments]
  );

  async function assign() {
    if (!selectedTag) return;
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/milestone3/foundation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tag_assign", contactId, tagId: selectedTag, sourceType: "manual" })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || "タグを付与しました。");
      if (!data.error) { setSelectedTag(""); await load(); }
    } finally { setWorking(false); }
  }

  async function remove(id: string) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/milestone3/foundation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tag_remove", assignmentId: id })
      });
      const data = await response.json() as { error?: string };
      setMessage(data.error || "タグを解除しました。");
      if (!data.error) await load();
    } finally { setWorking(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className={`${compact ? "text-sm" : "text-base"} font-black`}>タグ</h3>
          <p className="mt-0.5 text-[10px] text-ink/45">顧客の分類と自動アクションの起点</p>
        </div>
        <Link href="/admin/tags" className="text-[11px] font-black text-moss hover:underline">タグ管理</Link>
      </div>

      <div className="mt-3 flex min-h-8 flex-wrap gap-2">
        {assignments.map((item) => {
          const tag = tags.find((candidate) => candidate.id === item.tagId);
          return (
            <span key={item.id} className="group inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 py-1 pl-2.5 pr-1 text-[11px] font-bold text-emerald-800">
              <span>{tag?.name || "タグ"}</span>
              <span className="text-[9px] font-normal text-emerald-700/60">{sourceLabel(item.sourceType)}</span>
              <button type="button" aria-label={`${tag?.name || "タグ"}を解除`} title="タグを解除" disabled={working} onClick={() => void remove(item.id)} className="grid size-5 place-items-center rounded-full text-emerald-800/60 hover:bg-emerald-200 hover:text-emerald-950 disabled:opacity-40">×</button>
            </span>
          );
        })}
        {!assignments.length ? <p className="py-1 text-xs text-ink/40">タグはまだ付いていません</p> : null}
      </div>

      <div className="mt-3 flex gap-2">
        <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)} disabled={working || !availableTags.length} className="focus-ring min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-xs disabled:bg-paper">
          <option value="">付与するタグを選択</option>
          {availableTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
        <button type="button" onClick={() => void assign()} disabled={working || !selectedTag} className="focus-ring rounded-lg bg-[#263331] px-3 text-xs font-black text-white disabled:opacity-35">付与</button>
      </div>
      {message ? <p className={`mt-2 text-[11px] font-bold ${message.includes("失敗") || message.includes("できません") ? "text-coral" : "text-moss"}`}>{message}</p> : null}
    </div>
  );
}

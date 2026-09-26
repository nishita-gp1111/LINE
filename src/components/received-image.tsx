"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";

export function ReceivedImage({ messageId }: { messageId: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let url = "";
    void fetch(`/api/inbox/messages/${encodeURIComponent(messageId)}/image`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json() as { error?: string };
          throw new Error(body.error || "写真を読み込めませんでした。");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "写真を読み込めませんでした。");
      });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [messageId, visible, attempt]);
  return <div ref={element} className="w-64 max-w-full sm:w-80">
    {image ? <a href={`/api/inbox/messages/${encodeURIComponent(messageId)}/image`} target="_blank" rel="noreferrer" aria-label="受信した写真を拡大する" className="focus-ring block overflow-hidden rounded-xl bg-black/5">
      <img src={image} alt="お客様から届いた写真" className="max-h-80 w-full object-contain" decoding="async" />
      <span className="block bg-paper px-3 py-2 text-center text-[11px] font-bold text-ink/60">↗ 写真を拡大</span>
    </a> : <div className="grid min-h-40 place-items-center rounded-xl bg-paper p-4 text-center">
      {error ? <div><p className="text-2xl" aria-hidden="true">🖼</p><p role="status" className="mt-2 text-xs leading-5 text-ink/65">{error}</p><button type="button" className="focus-ring mt-3 rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold" onClick={() => { setError(""); setAttempt(value => value + 1); }}>再読み込み</button></div> : <p role="status" className="text-xs text-ink/50">写真を読み込み中…</p>}
    </div>}
  </div>;
}

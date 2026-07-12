"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthMode } from "@/lib/auth/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const mode = getAuthMode();
  const [email, setEmail] = useState("owner@example.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setIsSubmitting(true);

    if (mode === "mock") {
      const response = await fetch("/api/auth/mock", { method: "POST" });
      if (!response.ok) {
        setError("mock認証を開始できませんでした。");
        setIsSubmitting(false);
        return;
      }
      router.replace("/admin");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase Authの設定が不足しています。");
      setIsSubmitting(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (signInError) {
      setError(signInError.message);
      setIsSubmitting(false);
      return;
    }
    router.replace("/admin");
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-line bg-white p-7 shadow-sm sm:p-9">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-moss">LINE CRM</p>
        <h1 className="mt-3 text-3xl font-black">管理画面ログイン</h1>
        <p className="mt-3 text-sm leading-6 text-ink/60">
          {mode === "mock"
            ? "現在はmock modeです。秘密情報なしで基盤を確認できます。"
            : "Supabase Authのアカウントでログインします。"}
        </p>

        <form onSubmit={submit} className="mt-7 grid gap-5">
          <label className="grid gap-2 text-sm font-bold">
            メールアドレス
            <input
              className="focus-ring min-h-11 rounded-lg border border-line px-3 font-normal"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          {mode === "supabase" ? (
            <label className="grid gap-2 text-sm font-bold">
              パスワード
              <input
                className="focus-ring min-h-11 rounded-lg border border-line px-3 font-normal"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          ) : null}
          {error ? <p className="text-sm font-bold text-coral">{error}</p> : null}
          <button
            className="focus-ring min-h-11 rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white hover:bg-black disabled:cursor-wait disabled:opacity-60"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "確認中…" : "ログイン"}
          </button>
        </form>
      </section>
    </main>
  );
}

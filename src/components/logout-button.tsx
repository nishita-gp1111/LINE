"use client";

import { useRouter } from "next/navigation";
import { getAuthMode } from "@/lib/auth/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    if (getAuthMode() === "mock") {
      await fetch("/api/auth/mock", { method: "DELETE" });
    } else {
      await createSupabaseBrowserClient()?.auth.signOut();
    }
    router.replace("/login");
  }

  return (
    <button
      className="focus-ring rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold hover:bg-paper"
      type="button"
      onClick={() => void logout()}
    >
      ログアウト
    </button>
  );
}

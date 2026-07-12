export type AuthMode = "mock" | "supabase";

export const MOCK_AUTH_COOKIE = "line_crm_mock_auth";
export const MOCK_USER = {
  id: "mock-user",
  email: "owner@example.local",
  name: "LINE CRMオーナー"
} as const;

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getAuthMode(): AuthMode {
  if (process.env.NEXT_PUBLIC_AUTH_MODE === "mock") return "mock";
  return isSupabaseAuthConfigured() ? "supabase" : "mock";
}

export function isProtectedPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

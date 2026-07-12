import { NextResponse } from "next/server";
import { getAuthMode } from "@/lib/auth/config";
import { getServerEnv } from "@/lib/env/server";

export function GET() {
  const env = getServerEnv();

  return NextResponse.json({
    ok: true,
    environment: env.APP_ENV,
    timezone: env.APP_TIMEZONE,
    authMode: getAuthMode(),
    mockLineApi: env.MOCK_LINE_API,
    configured: {
      appUrl: Boolean(env.NEXT_PUBLIC_APP_URL),
      supabaseUrl: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
      supabaseAnonKey: Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      adminEmailAllowlist: env.ADMIN_EMAIL_ALLOWLIST.length > 0
    }
  });
}

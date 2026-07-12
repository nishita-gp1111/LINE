import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/launch/cron";
import { getServerEnv } from "@/lib/env/server";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const env = getServerEnv();
  return NextResponse.json({ ok: true, provider: env.SCHEDULER_PROVIDER, processed: 0, note: "Mock-safe dispatcher; production job execution requires the approved worker implementation." });
}

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/launch/cron";
import { getServerEnv } from "@/lib/env/server";
import { dispatchDueJobs } from "@/lib/launch/dispatcher";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const env = getServerEnv();
  try {
    const summary = await dispatchDueJobs(new Date(), 50);
    return NextResponse.json({ ok: true, provider: env.SCHEDULER_PROVIDER, ...summary });
  } catch {
    return NextResponse.json({ ok: false, error: "dispatcher_failed" }, { status: 503 });
  }
}

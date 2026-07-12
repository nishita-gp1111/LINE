import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/launch/cron";
import { getServerEnv } from "@/lib/env/server";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const env = getServerEnv();
  return NextResponse.json({ ok: true, retention: { campaignDetailDays: env.CAMPAIGN_DETAIL_RETENTION_DAYS, jobDays: env.JOB_RETENTION_DAYS, analyticsEventDays: env.ANALYTICS_EVENT_RETENTION_DAYS }, processed: 0 });
}

import { NextResponse } from "next/server";
import { isCronAuthorized, publicLaunchStatus } from "@/lib/launch/cron";
import { launchBlockers, launchFlagStatus } from "@/lib/launch/flags";

export function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, scheduler: publicLaunchStatus(), flags: launchFlagStatus(), blockers: launchBlockers() }, { headers: { "cache-control": "no-store" } });
}

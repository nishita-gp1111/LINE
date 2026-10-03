import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/launch/cron";
import { getServerEnv } from "@/lib/env/server";
import { dispatchDueJobs } from "@/lib/launch/dispatcher";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchDueBookingReminders } from "@/lib/bookings/service";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const env = getServerEnv();
  try {
    const summary = await dispatchDueJobs(new Date(), 50);
    let bookingReminders: { scanned: number; sent: number; failed: number; skipped: number } | { unavailable: true } = { scanned: 0, sent: 0, failed: 0, skipped: 0 };
    if (env.BOOKING_REMINDERS_ENABLED) {
      const client = createSupabaseAdminClient();
      if (!client) bookingReminders = { unavailable: true };
      else {
        try {
          bookingReminders = await dispatchDueBookingReminders({ client, env, now: new Date(), limit: 30 });
        } catch {
          bookingReminders = { unavailable: true };
        }
      }
    }
    return NextResponse.json({ ok: true, provider: env.SCHEDULER_PROVIDER, ...summary, bookingReminders });
  } catch {
    return NextResponse.json({ ok: false, error: "dispatcher_failed" }, { status: 503 });
  }
}

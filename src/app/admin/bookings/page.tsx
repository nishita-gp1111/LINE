import { redirect } from "next/navigation";
import { BookingManagementClient } from "./booking-management-client";
import { getBookingAdminData } from "@/lib/bookings/admin";
import { bookingReadiness } from "@/lib/bookings/runtime";
import { getServerEnv } from "@/lib/env/server";
import { getInboxAuthContext } from "@/lib/inbox/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function BookingManagementPage({ searchParams }: { searchParams: Promise<{ calendar?: string; code?: string }> }) {
  const auth = await getInboxAuthContext();
  if (!auth) redirect("/login");
  const client = createSupabaseAdminClient();
  if (!client) return <Unavailable />;
  let data;
  let query;
  try {
    [data, query] = await Promise.all([getBookingAdminData(client, auth.organizationId), searchParams]);
  } catch {
    return <Unavailable />;
  }
  const env = getServerEnv();
  return <BookingManagementClient data={data} readiness={bookingReadiness()} appUrl={env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || ""} calendarNotice={query.calendar || ""} calendarCode={query.code || ""} />;
}

function Unavailable() {
  return <main className="min-h-screen px-5 py-8 sm:px-10"><section className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-black text-amber-950">Booking Managementを準備中です</h1><p className="mt-2 text-sm leading-6 text-amber-800">予約用migrationを適用すると、この画面からフォームとGoogle Calendar連携を設定できます。</p></section></main>;
}

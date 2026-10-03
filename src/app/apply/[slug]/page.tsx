import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicFormWizard } from "./booking-wizard";
import { bookingRuntime } from "@/lib/bookings/runtime";
import { loadPublicBookingForm } from "@/lib/bookings/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "面談のお申し込み | GP PRモニター窓口", robots: { index: false, follow: false } };

export default async function ApplyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ source?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  let form;
  try {
    const runtime = bookingRuntime();
    form = await loadPublicBookingForm(runtime.client, runtime.organizationId, slug);
  } catch {
    return <BookingUnavailable />;
  }
  if (!form) notFound();
  return <PublicFormWizard form={form} source={query.source || "direct"} />;
}

function BookingUnavailable() {
  return <main className="grid min-h-screen place-items-center bg-slate-50 px-5 text-center"><section className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><div className="text-4xl">🗓️</div><h1 className="mt-4 text-xl font-black">予約ページを準備中です</h1><p className="mt-3 text-sm leading-6 text-slate-500">恐れ入りますが、時間をおいてもう一度お試しください。</p></section></main>;
}

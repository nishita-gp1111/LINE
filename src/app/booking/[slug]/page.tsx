import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingWizard } from "@/app/apply/[slug]/booking-wizard";
import { bookingRuntime } from "@/lib/bookings/runtime";
import { loadPublicBookingType } from "@/lib/bookings/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "面談日時を選ぶ | GP PRモニター窓口", robots: { index: false, follow: false } };

export default async function BookingOnlyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ source?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  let bookingType;
  try {
    const runtime = bookingRuntime();
    bookingType = await loadPublicBookingType(runtime.client, runtime.organizationId, slug);
  } catch {
    return <main className="grid min-h-screen place-items-center bg-slate-50 px-5 text-center"><section className="rounded-3xl bg-white p-8 shadow-sm"><h1 className="text-xl font-black">予約ページを準備中です</h1><p className="mt-3 text-sm text-slate-500">時間をおいてもう一度お試しください。</p></section></main>;
  }
  if (!bookingType) notFound();
  return <BookingWizard mode="booking_only" slug={bookingType.slug} title={bookingType.name} description="アンケートなしで、そのまま面談日時を選択できます。" completionMessage="ご予約ありがとうございます。確認メールをご確認ください。" bookingType={bookingType} source={query.source || "direct"} />;
}

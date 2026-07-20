import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RescheduleWizard } from "./reschedule-wizard";
import { bookingRuntime } from "@/lib/bookings/runtime";
import { getRescheduleSummary } from "@/lib/bookings/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "面談日時の変更 | GP PRモニター窓口", robots: { index: false, follow: false } };

export default async function ReschedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let summary;
  try {
    const runtime = bookingRuntime();
    summary = await getRescheduleSummary(runtime.client, token);
  } catch {
    notFound();
  }
  if (!summary || !["confirmed", "rescheduled"].includes(summary.status)) notFound();
  return <RescheduleWizard token={token} applicantName={summary.applicantName} currentStartsAt={summary.startsAt} timezone={summary.timezone} />;
}

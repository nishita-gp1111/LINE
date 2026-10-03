import { confirmBookingSchema } from "@/lib/bookings/domain";
import { bookingErrorResponse, bookingJson } from "@/lib/bookings/http";
import { bookingRuntime } from "@/lib/bookings/runtime";
import { confirmBooking, getRescheduleSummary } from "@/lib/bookings/service";
import { isTrustedOrigin } from "@/lib/inbox/auth";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const runtime = bookingRuntime();
    const summary = await getRescheduleSummary(runtime.client, token);
    if (!summary) return bookingJson({ error: "予約情報が見つかりません。", code: "booking_not_found" }, 404);
    return bookingJson(summary);
  } catch (error) {
    return bookingErrorResponse(error);
  }
}
export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return bookingJson({ error: "不正な送信元です。", code: "origin_rejected" }, 403);
  try {
    const parsed = confirmBookingSchema.parse(await request.json());
    const runtime = bookingRuntime();
    const result = await confirmBooking({ ...runtime, ...parsed, mode: "reschedule" });
    return bookingJson(result);
  } catch (error) {
    return bookingErrorResponse(error);
  }
}

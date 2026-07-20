import { confirmBookingSchema } from "@/lib/bookings/domain";
import { bookingErrorResponse, bookingJson } from "@/lib/bookings/http";
import { bookingRuntime } from "@/lib/bookings/runtime";
import { confirmBooking } from "@/lib/bookings/service";
import { isTrustedOrigin } from "@/lib/inbox/auth";

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return bookingJson({ error: "不正な送信元です。", code: "origin_rejected" }, 403);
  try {
    const parsed = confirmBookingSchema.parse(await request.json());
    const runtime = bookingRuntime();
    const result = await confirmBooking({ ...runtime, ...parsed, mode: "initial" });
    return bookingJson(result);
  } catch (error) {
    return bookingErrorResponse(error);
  }
}

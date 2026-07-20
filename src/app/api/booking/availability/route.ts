import { availabilitySchema } from "@/lib/bookings/domain";
import { bookingErrorResponse, bookingJson } from "@/lib/bookings/http";
import { bookingRuntime } from "@/lib/bookings/runtime";
import { getBookingAvailability } from "@/lib/bookings/service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = availabilitySchema.parse({ token: url.searchParams.get("token"), mode: url.searchParams.get("mode") || "initial" });
    const runtime = bookingRuntime();
    const result = await getBookingAvailability({ ...runtime, ...parsed });
    return bookingJson(result);
  } catch (error) {
    return bookingErrorResponse(error);
  }
}

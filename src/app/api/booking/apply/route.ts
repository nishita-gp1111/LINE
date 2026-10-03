import { bookingOnlyApplySchema, publicApplySchema } from "@/lib/bookings/domain";
import { bookingErrorResponse, bookingJson } from "@/lib/bookings/http";
import { bookingRuntime } from "@/lib/bookings/runtime";
import {
  BookingServiceError,
  createBookingOnlyApplication,
  createPublicApplication,
  loadPublicBookingForm,
  loadPublicBookingType
} from "@/lib/bookings/service";
import { isTrustedOrigin } from "@/lib/inbox/auth";

async function enforceSubmissionLimit(client: ReturnType<typeof bookingRuntime>["client"], organizationId: string, email: string) {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error } = await client.from("bookings").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("applicant_email", email).gte("created_at", since);
  if (error) throw new BookingServiceError("booking_application_save_failed", 503);
  if ((count || 0) >= 3) throw new BookingServiceError("booking_rate_limited", 429);
}

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return bookingJson({ error: "不正な送信元です。", code: "origin_rejected" }, 403);
  try {
    const runtime = bookingRuntime();
    const body = await request.json() as { mode?: unknown };
    const mode = body.mode === "booking_only" ? "booking_only" : "form";
    if (mode === "booking_only") {
      const parsed = bookingOnlyApplySchema.parse(body);
      await enforceSubmissionLimit(runtime.client, runtime.organizationId, parsed.email);
      const bookingType = await loadPublicBookingType(runtime.client, runtime.organizationId, parsed.slug);
      if (!bookingType) throw new BookingServiceError("booking_type_not_found", 404);
      const result = await createBookingOnlyApplication({
        ...runtime,
        bookingType,
        applicant: parsed
      });
      return bookingJson(result, 201);
    }
    const parsed = publicApplySchema.parse(body);
    await enforceSubmissionLimit(runtime.client, runtime.organizationId, parsed.email);
    const form = await loadPublicBookingForm(runtime.client, runtime.organizationId, parsed.slug);
    if (!form) throw new BookingServiceError("booking_form_not_found", 404);
    const result = await createPublicApplication({
      ...runtime,
      form,
      applicant: parsed
    });
    return bookingJson(result, 201);
  } catch (error) {
    return bookingErrorResponse(error);
  }
}

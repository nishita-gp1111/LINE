import { bookingErrorResponse, bookingJson } from "@/lib/bookings/http";
import { executeBookingAdminAction, getBookingAdminData } from "@/lib/bookings/admin";
import { canAdminister, canOperate, getInboxAuthContext, isTrustedOrigin } from "@/lib/inbox/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const auth = await getInboxAuthContext();
    if (!auth) return bookingJson({ error: "unauthorized" }, 401);
    const client = createSupabaseAdminClient();
    if (!client) return bookingJson({ error: "database_not_configured" }, 503);
    return bookingJson(await getBookingAdminData(client, auth.organizationId));
  } catch (error) {
    return bookingErrorResponse(error);
  }
}
export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return bookingJson({ error: "origin_rejected" }, 403);
  try {
    const auth = await getInboxAuthContext();
    if (!auth || !canOperate(auth.role)) return bookingJson({ error: "forbidden" }, 403);
    const body = await request.json() as { action?: unknown };
    const adminActions = new Set(["member_create", "member_update", "question_create", "question_update", "form_update", "booking_type_update"]);
    if (adminActions.has(String(body.action)) && !canAdminister(auth.role)) return bookingJson({ error: "admin_required" }, 403);
    const client = createSupabaseAdminClient();
    if (!client) return bookingJson({ error: "database_not_configured" }, 503);
    await executeBookingAdminAction({ client, organizationId: auth.organizationId, body });
    return bookingJson({ ok: true });
  } catch (error) {
    return bookingErrorResponse(error);
  }
}

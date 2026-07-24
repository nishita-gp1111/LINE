import "server-only";

import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BookingServiceError } from "@/lib/bookings/service";

export function bookingRuntime() {
  const env = getServerEnv();
  if (!env.BOOKING_MANAGEMENT_ENABLED) throw new BookingServiceError("booking_management_disabled", 404);
  const client = createSupabaseAdminClient();
  if (!client || !env.LINE_ORGANIZATION_ID) throw new BookingServiceError("booking_database_not_configured", 503);
  return { env, client, organizationId: env.LINE_ORGANIZATION_ID };
}
export function bookingReadiness() {
  const env = getServerEnv();
  return {
    enabled: env.BOOKING_MANAGEMENT_ENABLED,
    database: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LINE_ORGANIZATION_ID),
    googleOAuth: Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET),
    encryption: Boolean(env.BOOKING_TOKEN_ENCRYPTION_KEY),
    stateSigning: Boolean(env.BOOKING_OAUTH_STATE_SECRET),
    email: Boolean(env.RESEND_API_KEY && (env.BOOKING_EMAIL_FROM || env.INBOUND_EMAIL_NOTIFICATION_FROM)),
    reminders: env.BOOKING_REMINDERS_ENABLED
  };
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { signBookingState } from "@/lib/bookings/crypto";
import { buildGoogleAuthorizationUrl } from "@/lib/bookings/google-calendar";
import { bookingErrorResponse, bookingJson } from "@/lib/bookings/http";
import { bookingRuntime } from "@/lib/bookings/runtime";
import { BookingServiceError } from "@/lib/bookings/service";
import { canAdminister, getInboxAuthContext } from "@/lib/inbox/auth";

export async function GET(request: Request) {
  try {
    const auth = await getInboxAuthContext();
    if (!auth) return bookingJson({ error: "unauthorized" }, 401);
    if (!canAdminister(auth.role)) return bookingJson({ error: "forbidden" }, 403);
    const runtime = bookingRuntime();
    if (runtime.organizationId !== auth.organizationId) throw new BookingServiceError("organization_mismatch", 403);
    const memberId = new URL(request.url).searchParams.get("memberId") || "";
    if (!/^[0-9a-f-]{36}$/i.test(memberId)) return bookingJson({ error: "担当者が不正です。" }, 400);
    const env = runtime.env;
    if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET || !env.BOOKING_OAUTH_STATE_SECRET || !env.NEXT_PUBLIC_APP_URL) {
      throw new BookingServiceError("google_calendar_not_configured", 503);
    }
    const state = signBookingState({
      organizationId: auth.organizationId,
      profileId: auth.profileId,
      memberId,
      expiresAt: Date.now() + 10 * 60_000,
      nonce: randomUUID()
    }, env.BOOKING_OAUTH_STATE_SECRET);
    const redirectUri = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/booking/google/callback`;
    return NextResponse.redirect(buildGoogleAuthorizationUrl({
      config: { clientId: env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET, redirectUri },
      state,
      loginHint: auth.profile.email
    }), 302);
  } catch (error) {
    return bookingErrorResponse(error);
  }
}

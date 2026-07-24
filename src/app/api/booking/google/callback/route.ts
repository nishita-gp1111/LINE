import { NextResponse } from "next/server";
import { verifyBookingState } from "@/lib/bookings/crypto";
import { exchangeGoogleAuthorizationCode, getGoogleUserInfo, GOOGLE_BOOKING_SCOPES, GoogleCalendarError } from "@/lib/bookings/google-calendar";
import { bookingRuntime } from "@/lib/bookings/runtime";
import { BookingServiceError, connectBookingMemberCalendar } from "@/lib/bookings/service";
import { canAdminister, getInboxAuthContext } from "@/lib/inbox/auth";

type OAuthState = {
  organizationId: string;
  profileId: string;
  memberId: string;
  expiresAt: number;
  nonce: string;
};

function adminRedirect(appUrl: string, status: "connected" | "error", code?: string) {
  const url = new URL("/admin/bookings", appUrl);
  url.searchParams.set("calendar", status);
  if (code) url.searchParams.set("code", code);
  return NextResponse.redirect(url, 302);
}

export async function GET(request: Request) {
  const fallbackAppUrl = new URL(request.url).origin;
  try {
    const runtime = bookingRuntime();
    const appUrl = runtime.env.NEXT_PUBLIC_APP_URL || fallbackAppUrl;
    const auth = await getInboxAuthContext();
    if (!auth || !canAdminister(auth.role)) return adminRedirect(appUrl, "error", "unauthorized");
    const url = new URL(request.url);
    if (url.searchParams.get("error")) return adminRedirect(appUrl, "error", "consent_denied");
    const code = url.searchParams.get("code") || "";
    const stateValue = url.searchParams.get("state") || "";
    const env = runtime.env;
    if (!env.BOOKING_OAUTH_STATE_SECRET || !env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
      throw new BookingServiceError("google_calendar_not_configured", 503);
    }
    const state = verifyBookingState<OAuthState>(stateValue, env.BOOKING_OAUTH_STATE_SECRET);
    if (state.expiresAt < Date.now()) throw new BookingServiceError("oauth_state_expired", 400);
    if (state.organizationId !== auth.organizationId || state.profileId !== auth.profileId || runtime.organizationId !== auth.organizationId) {
      throw new BookingServiceError("oauth_state_mismatch", 403);
    }
    const redirectUri = `${appUrl.replace(/\/$/, "")}/api/booking/google/callback`;
    const token = await exchangeGoogleAuthorizationCode({
      config: { clientId: env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET, redirectUri },
      code
    });
    if (!token.refreshToken) throw new BookingServiceError("oauth_refresh_token_missing", 400);
    if (GOOGLE_BOOKING_SCOPES.filter((scope) => scope.includes("/auth/calendar.")).some((scope) => !token.scopes.includes(scope))) {
      throw new BookingServiceError("oauth_required_scope_missing", 400);
    }
    const user = await getGoogleUserInfo(token.accessToken);
    await connectBookingMemberCalendar({
      client: runtime.client,
      env,
      organizationId: auth.organizationId,
      memberId: state.memberId,
      providerUserId: user.id,
      providerEmail: user.email,
      refreshToken: token.refreshToken,
      scopes: token.scopes
    });
    return adminRedirect(appUrl, "connected");
  } catch (error) {
    if (error instanceof BookingServiceError) return adminRedirect(fallbackAppUrl, "error", error.code);
    if (error instanceof GoogleCalendarError) return adminRedirect(fallbackAppUrl, "error", error.code);
    return adminRedirect(fallbackAppUrl, "error", "oauth_callback_failed");
  }
}

import "server-only";

import { randomUUID } from "node:crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_URL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_FREE_BUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_BOOKING_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.freebusy"
] as const;

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export class GoogleCalendarError extends Error {
  constructor(public readonly code: string, public readonly status: number | null = null) {
    super(code);
    this.name = "GoogleCalendarError";
  }
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export type GoogleCalendarEvent = {
  id: string;
  htmlLink: string | null;
  meetUrl: string | null;
};

function withTimeout(milliseconds = 10_000): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function googleFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  errorCode: string
): Promise<Response> {
  const timeout = withTimeout();
  try {
    const response = await fetchImpl(url, { ...init, signal: timeout.signal, redirect: "error" });
    if (!response.ok) throw new GoogleCalendarError(errorCode, response.status);
    return response;
  } catch (error) {
    if (error instanceof GoogleCalendarError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new GoogleCalendarError(`${errorCode}_timeout`);
    throw new GoogleCalendarError(`${errorCode}_network`);
  } finally {
    timeout.clear();
  }
}

export function buildGoogleAuthorizationUrl(input: {
  config: GoogleOAuthConfig;
  state: string;
  loginHint?: string | null;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", GOOGLE_BOOKING_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode(input: {
  config: GoogleOAuthConfig;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number; scopes: string[] }> {
  const fetchImpl = input.fetchImpl || fetch;
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    redirect_uri: input.config.redirectUri,
    grant_type: "authorization_code"
  });
  const response = await googleFetch(
    GOOGLE_TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    fetchImpl,
    "oauth_code_exchange_failed"
  );
  const token = await response.json() as GoogleTokenResponse;
  if (!token.access_token) throw new GoogleCalendarError("oauth_access_token_missing");
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    expiresIn: Number(token.expires_in || 3600),
    scopes: String(token.scope || "").split(" ").filter(Boolean)
  };
}

export async function refreshGoogleAccessToken(input: {
  config: GoogleOAuthConfig;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const fetchImpl = input.fetchImpl || fetch;
  const body = new URLSearchParams({
    refresh_token: input.refreshToken,
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    grant_type: "refresh_token"
  });
  const response = await googleFetch(
    GOOGLE_TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    fetchImpl,
    "oauth_refresh_failed"
  );
  const token = await response.json() as GoogleTokenResponse;
  if (!token.access_token) throw new GoogleCalendarError("oauth_access_token_missing");
  return { accessToken: token.access_token, expiresIn: Number(token.expires_in || 3600) };
}

export async function getGoogleUserInfo(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string | null; email: string | null }> {
  const response = await googleFetch(
    GOOGLE_USERINFO_URL,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl,
    "google_userinfo_failed"
  );
  const body = await response.json() as { sub?: unknown; email?: unknown };
  return {
    id: typeof body.sub === "string" ? body.sub : null,
    email: typeof body.email === "string" ? body.email.toLowerCase() : null
  };
}

export async function queryGoogleFreeBusy(input: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timezone: string;
  fetchImpl?: typeof fetch;
}): Promise<Array<{ start: string; end: string }>> {
  const fetchImpl = input.fetchImpl || fetch;
  const response = await googleFetch(
    GOOGLE_FREE_BUSY_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        timeZone: input.timezone,
        items: [{ id: input.calendarId }]
      })
    },
    fetchImpl,
    "calendar_freebusy_failed"
  );
  const body = await response.json() as {
    calendars?: Record<string, { busy?: Array<{ start?: unknown; end?: unknown }>; errors?: unknown[] }>;
  };
  const calendar = body.calendars?.[input.calendarId];
  if (!calendar || (calendar.errors?.length || 0) > 0) throw new GoogleCalendarError("calendar_freebusy_unavailable");
  return (calendar.busy || []).flatMap((range) =>
    typeof range.start === "string" && typeof range.end === "string"
      ? [{ start: range.start, end: range.end }]
      : []
  );
}

function meetUrlFromEvent(body: Record<string, unknown>): string | null {
  if (typeof body.hangoutLink === "string") return body.hangoutLink;
  const conference = body.conferenceData as { entryPoints?: Array<{ entryPointType?: unknown; uri?: unknown }> } | undefined;
  const video = conference?.entryPoints?.find((entry) => entry.entryPointType === "video" && typeof entry.uri === "string");
  return typeof video?.uri === "string" ? video.uri : null;
}

function eventResult(body: Record<string, unknown>): GoogleCalendarEvent {
  if (typeof body.id !== "string") throw new GoogleCalendarError("calendar_event_id_missing");
  return {
    id: body.id,
    htmlLink: typeof body.htmlLink === "string" ? body.htmlLink : null,
    meetUrl: meetUrlFromEvent(body)
  };
}

export async function createGoogleBookingEvent(input: {
  accessToken: string;
  calendarId: string;
  bookingId: string;
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleCalendarEvent> {
  const fetchImpl = input.fetchImpl || fetch;
  const url = new URL(`${GOOGLE_CALENDAR_URL}/calendars/${encodeURIComponent(input.calendarId)}/events`);
  url.searchParams.set("conferenceDataVersion", "1");
  url.searchParams.set("sendUpdates", "none");
  const response = await googleFetch(
    url.toString(),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startsAt, timeZone: input.timezone },
        end: { dateTime: input.endsAt, timeZone: input.timezone },
        extendedProperties: { private: { bookingId: input.bookingId, source: "line-crm" } },
        conferenceData: {
          createRequest: {
            requestId: `${input.bookingId}-${randomUUID()}`.slice(0, 120),
            conferenceSolutionKey: { type: "hangoutsMeet" }
          }
        }
      })
    },
    fetchImpl,
    "calendar_event_create_failed"
  );
  let event = eventResult(await response.json() as Record<string, unknown>);
  if (event.meetUrl) return event;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    event = await getGoogleBookingEvent({
      accessToken: input.accessToken,
      calendarId: input.calendarId,
      eventId: event.id,
      fetchImpl
    });
    if (event.meetUrl) break;
  }
  return event;
}

export async function getGoogleBookingEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleCalendarEvent> {
  const response = await googleFetch(
    `${GOOGLE_CALENDAR_URL}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
    input.fetchImpl || fetch,
    "calendar_event_read_failed"
  );
  return eventResult(await response.json() as Record<string, unknown>);
}

export async function updateGoogleBookingEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleCalendarEvent> {
  const url = new URL(`${GOOGLE_CALENDAR_URL}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`);
  url.searchParams.set("conferenceDataVersion", "1");
  url.searchParams.set("sendUpdates", "none");
  const response = await googleFetch(
    url.toString(),
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startsAt, timeZone: input.timezone },
        end: { dateTime: input.endsAt, timeZone: input.timezone }
      })
    },
    input.fetchImpl || fetch,
    "calendar_event_update_failed"
  );
  return eventResult(await response.json() as Record<string, unknown>);
}

export async function deleteGoogleBookingEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  await googleFetch(
    `${GOOGLE_CALENDAR_URL}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=none`,
    { method: "DELETE", headers: { Authorization: `Bearer ${input.accessToken}` } },
    input.fetchImpl || fetch,
    "calendar_event_delete_failed"
  );
}

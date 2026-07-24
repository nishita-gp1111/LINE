import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthorizationUrl,
  createGoogleBookingEvent,
  queryGoogleFreeBusy,
  refreshGoogleAccessToken
} from "../src/lib/bookings/google-calendar";

const config = { clientId: "client-id", clientSecret: "client-secret", redirectUri: "https://example.com/api/booking/google/callback" };

describe("Google Calendar booking client", () => {
  it("requests offline calendar access with state and forced consent", () => {
    const url = new URL(buildGoogleAuthorizationUrl({ config, state: "signed-state", loginHint: "staff@example.com" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/calendar.events.owned");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/calendar.freebusy");
    expect(url.searchParams.get("scope")?.split(" ")).not.toContain("https://www.googleapis.com/auth/calendar");
    expect(url.searchParams.get("state")).toBe("signed-state");
  });

  it("refreshes an access token without exposing the refresh token in a URL", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe("https://oauth2.googleapis.com/token");
      expect(String(init?.body)).toContain("refresh_token=refresh-token");
      return Response.json({ access_token: "access-token", expires_in: 3600 });
    });
    await expect(refreshGoogleAccessToken({ config, refreshToken: "refresh-token", fetchImpl: fetchImpl as typeof fetch })).resolves.toEqual({ accessToken: "access-token", expiresIn: 3600 });
  });

  it("queries only the connected calendar free/busy range", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.items).toEqual([{ id: "primary" }]);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer access" });
      return Response.json({ calendars: { primary: { busy: [{ start: "2026-07-20T01:00:00Z", end: "2026-07-20T02:00:00Z" }] } } });
    });
    const busy = await queryGoogleFreeBusy({ accessToken: "access", calendarId: "primary", timeMin: "2026-07-20T00:00:00Z", timeMax: "2026-07-21T00:00:00Z", timezone: "Asia/Tokyo", fetchImpl: fetchImpl as typeof fetch });
    expect(busy).toHaveLength(1);
  });

  it("creates a unique Google Meet and suppresses Google invitation emails", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url));
      expect(parsed.searchParams.get("conferenceDataVersion")).toBe("1");
      expect(parsed.searchParams.get("sendUpdates")).toBe("none");
      const body = JSON.parse(String(init?.body));
      expect(body.conferenceData.createRequest.requestId).toContain("booking-id");
      expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
      expect(body.extendedProperties.private.bookingId).toBe("booking-id");
      return Response.json({ id: "event-id", htmlLink: "https://calendar.google.com/event", hangoutLink: "https://meet.google.com/abc-defg-hij" });
    });
    const event = await createGoogleBookingEvent({ accessToken: "access", calendarId: "primary", bookingId: "booking-id", summary: "面談", description: "応募者", startsAt: "2026-07-20T01:00:00Z", endsAt: "2026-07-20T01:30:00Z", timezone: "Asia/Tokyo", fetchImpl: fetchImpl as typeof fetch });
    expect(event.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
  });
});

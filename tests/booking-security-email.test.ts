import { describe, expect, it, vi } from "vitest";
import { decryptBookingSecret, encryptBookingSecret, signBookingState, verifyBookingState } from "../src/lib/bookings/crypto";
import { buildBookingEmail, sendBookingEmail } from "../src/lib/bookings/email";
import { parseEnv } from "../src/lib/env/schema";

const key = Buffer.alloc(32, 7).toString("base64url");

describe("booking security and email", () => {
  it("encrypts refresh and reschedule tokens with authenticated encryption", () => {
    const encrypted = encryptBookingSecret("secret-token", key);
    expect(encrypted).not.toContain("secret-token");
    expect(decryptBookingSecret(encrypted, key)).toBe("secret-token");
    const parts = encrypted.split(".");
    parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("A") ? "B" : "A"}`;
    expect(() => decryptBookingSecret(parts.join("."), key)).toThrow();
  });

  it("signs OAuth state and rejects tampering", () => {
    const state = signBookingState({ memberId: "m1", expiresAt: 123 }, "state-secret");
    expect(verifyBookingState<{ memberId: string }>(state, "state-secret").memberId).toBe("m1");
    expect(() => verifyBookingState(`${state}x`, "state-secret")).toThrow("invalid");
  });

  it("builds confirmation email with Meet and reschedule links", () => {
    const email = buildBookingEmail({ idempotencyKey: "id", kind: "confirmation", recipient: "user@example.com", applicantName: "山田", memberName: "担当A", startsAt: "2026-07-20T01:00:00Z", timezone: "Asia/Tokyo", meetUrl: "https://meet.google.com/test", rescheduleUrl: "https://example.com/booking/reschedule/token" });
    expect(email.subject).toContain("面談予約");
    expect(email.text).toContain("https://meet.google.com/test");
    expect(email.html).toContain("予約日時を変更する");
  });

  it("sends through the existing Resend provider with an idempotency key", async () => {
    const env = parseEnv({ RESEND_API_KEY: "key", BOOKING_EMAIL_FROM: "booking@example.com" });
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "Idempotency-Key": "booking/1/1/confirmation" });
      return Response.json({ id: "email-id" });
    });
    const result = await sendBookingEmail({ env, fetchImpl: fetchImpl as typeof fetch, message: { idempotencyKey: "booking/1/1/confirmation", kind: "confirmation", recipient: "user@example.com", applicantName: "山田", memberName: "担当A", startsAt: "2026-07-20T01:00:00Z", timezone: "Asia/Tokyo", meetUrl: "https://meet.google.com/test", rescheduleUrl: "https://example.com/reschedule" } });
    expect(result).toEqual({ status: "sent", providerMessageId: "email-id" });
  });
});

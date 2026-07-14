import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enrollControlledRecipient,
  hashControlledEnrollmentMessage,
  isControlledEnrollmentMessage,
  normalizeControlledEnrollmentMessage
} from "@/lib/launch/controlled-recipient";
import { hashLineUserId } from "@/lib/launch/recipient-policy";

describe("Controlled Launch recipient bootstrap", () => {
  it("matches only the enabled, exact one-time phrase hash", () => {
    const phrase = "CODEX SHO ENROLL 8d0b4fd6";
    const expectedHash = hashControlledEnrollmentMessage(phrase);
    expect(normalizeControlledEnrollmentMessage(`  ${phrase}\n`)).toBe(phrase);
    expect(isControlledEnrollmentMessage({ enabled: true, expectedHash, message: phrase })).toBe(true);
    expect(isControlledEnrollmentMessage({ enabled: true, expectedHash, message: `  ${phrase}\n` })).toBe(true);
    expect(isControlledEnrollmentMessage({ enabled: true, expectedHash, message: `${phrase}!` })).toBe(false);
    expect(isControlledEnrollmentMessage({ enabled: false, expectedHash, message: phrase })).toBe(false);
    expect(isControlledEnrollmentMessage({ enabled: true, message: phrase })).toBe(false);
  });

  it("sends only a SHA-256 LINE user ID to the atomic enrollment RPC", async () => {
    let captured: Record<string, unknown> | undefined;
    const client = {
      rpc: async (name: string, input: Record<string, unknown>) => {
        expect(name).toBe("enroll_controlled_launch_recipient");
        captured = input;
        return { data: [{ result_status: "enrolled" }], error: null };
      }
    } as unknown as SupabaseClient;

    await expect(enrollControlledRecipient({
      client,
      organizationId: "00000000-0000-4000-8000-000000000001",
      contactId: "00000000-0000-4000-8000-000000000002",
      lineUserId: "Usho-secret-id",
      webhookEventId: "evt-enroll-1"
    })).resolves.toBe("enrolled");
    expect(captured?.target_line_user_id_hash).toBe(hashLineUserId("Usho-secret-id"));
    expect(JSON.stringify(captured)).not.toContain("Usho-secret-id");
  });

  it.each(["already_enrolled", "locked"] as const)("accepts the idempotent RPC status %s", async (resultStatus) => {
    const client = {
      rpc: async () => ({ data: [{ result_status: resultStatus }], error: null })
    } as unknown as SupabaseClient;
    await expect(enrollControlledRecipient({
      client,
      organizationId: "00000000-0000-4000-8000-000000000001",
      contactId: "00000000-0000-4000-8000-000000000002",
      lineUserId: "Usho",
      webhookEventId: "evt-enroll-2"
    })).resolves.toBe(resultStatus);
  });
});

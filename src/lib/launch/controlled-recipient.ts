import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env/server";
import {
  configuredRecipientHashes,
  evaluateRecipientPolicy,
  hashLineUserId,
  type RecipientPolicyState
} from "@/lib/launch/recipient-policy";

type Row = Record<string, unknown>;

export const CONTROLLED_ENROLLMENT_REDACTED_TEXT = "（Controlled Launch本人登録メッセージ）";

export type ControlledRecipientRecord = {
  contactId: string;
  lineUserIdHash: string;
  enrolledAt: string;
};

export type ControlledEnrollmentResult = {
  matched: boolean;
  status: "not_enrollment" | "enrolled" | "already_enrolled" | "locked";
};

function row(value: unknown): Row {
  return value && typeof value === "object" ? value as Row : {};
}

export function normalizeControlledEnrollmentMessage(message: string): string {
  return message.trim();
}

export function hashControlledEnrollmentMessage(message: string): string {
  return createHash("sha256")
    .update(normalizeControlledEnrollmentMessage(message), "utf8")
    .digest("hex");
}

export function isControlledEnrollmentMessage(input: {
  enabled: boolean;
  expectedHash?: string;
  message?: string | null;
}): boolean {
  if (!input.enabled || !input.message || !/^[0-9a-f]{64}$/.test(input.expectedHash || "")) return false;
  const actual = Buffer.from(hashControlledEnrollmentMessage(input.message), "hex");
  const expected = Buffer.from(input.expectedHash || "", "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function getControlledRecipientRecord(
  client: SupabaseClient,
  organizationId: string
): Promise<ControlledRecipientRecord | null> {
  const { data, error } = await client
    .from("controlled_launch_recipients")
    .select("contact_id, line_user_id_hash, enrolled_at")
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .limit(2);
  if (error) throw new Error("Controlled Launch allowlistを確認できませんでした。");
  const records = (data || []).map((value) => row(value));
  if (records.length > 1) throw new Error("Controlled Launch allowlistが1名を超えています。");
  const record = records[0];
  if (!record) return null;
  const lineUserIdHash = String(record.line_user_id_hash || "");
  if (!/^[0-9a-f]{64}$/.test(lineUserIdHash)) throw new Error("Controlled Launch allowlistが不正です。");
  return {
    contactId: String(record.contact_id),
    lineUserIdHash,
    enrolledAt: String(record.enrolled_at)
  };
}

export async function getEffectiveControlledRecipientHashes(
  client: SupabaseClient,
  organizationId: string
): Promise<string[]> {
  const env = getServerEnv();
  const record = await getControlledRecipientRecord(client, organizationId);
  if (record) return [record.lineUserIdHash];
  return configuredRecipientHashes(env.LINE_TEST_USER_IDS, env.LINE_TEST_USER_HASHES);
}

export async function evaluateControlledRecipient(
  client: SupabaseClient,
  organizationId: string,
  lineUserId: string
): Promise<RecipientPolicyState> {
  const env = getServerEnv();
  const hashes = await getEffectiveControlledRecipientHashes(client, organizationId);
  return evaluateRecipientPolicy({
    appEnvironment: env.APP_ENV,
    mockLineApi: env.MOCK_LINE_API,
    recipientMode: env.LINE_RECIPIENT_MODE,
    allowedLineUserIds: [],
    allowedLineUserHashes: hashes,
    lineUserId
  });
}

export async function assertControlledRecipient(
  client: SupabaseClient,
  organizationId: string,
  lineUserId: string
): Promise<void> {
  const policy = await evaluateControlledRecipient(client, organizationId, lineUserId);
  if (!policy.allowed) throw new Error(policy.reason || "送信先が許可されていません。");
}

export async function enrollControlledRecipient(input: {
  client: SupabaseClient;
  organizationId: string;
  contactId: string;
  lineUserId: string;
  webhookEventId: string;
}): Promise<Exclude<ControlledEnrollmentResult["status"], "not_enrollment">> {
  const { data, error } = await input.client.rpc("enroll_controlled_launch_recipient", {
    target_organization_id: input.organizationId,
    target_contact_id: input.contactId,
    target_line_user_id_hash: hashLineUserId(input.lineUserId),
    target_webhook_event_id: input.webhookEventId
  });
  if (error) throw new Error("Controlled Launch本人登録に失敗しました。");
  const result = row(Array.isArray(data) ? data[0] : data);
  const status = String(result.result_status || "");
  if (status === "enrolled" || status === "already_enrolled" || status === "locked") return status;
  throw new Error("Controlled Launch本人登録の応答が不正です。");
}

export async function tryEnrollControlledRecipient(input: {
  client: SupabaseClient;
  organizationId: string;
  contactId: string;
  lineUserId: string;
  webhookEventId: string;
  message?: string | null;
}): Promise<ControlledEnrollmentResult> {
  const env = getServerEnv();
  if (env.MOCK_LINE_API || !isControlledEnrollmentMessage({
    enabled: env.LINE_CONTROLLED_LAUNCH_ENROLLMENT_ENABLED,
    expectedHash: env.LINE_CONTROLLED_LAUNCH_ENROLLMENT_TOKEN_HASH,
    message: input.message
  })) {
    return { matched: false, status: "not_enrollment" };
  }
  const status = await enrollControlledRecipient(input);
  return { matched: true, status };
}

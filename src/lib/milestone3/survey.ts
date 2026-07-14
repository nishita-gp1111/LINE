import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const surveyQuestionTypeSchema = z.enum(["single_choice", "multiple_choice", "free_text", "number", "date", "confirm"]);
export const surveyActionSchema = z.object({ type: z.enum(["add_tag", "remove_tag", "set_custom_field", "start_scenario", "stop_scenario", "next_question", "finish", "conversion"]), value: z.string().max(200).optional() });

export function createOpaquePostbackToken(secret: string, expiresAt: number): string {
  const nonce = randomBytes(18).toString("base64url");
  const body = `${nonce}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64url").slice(0, 32);
  return `${body}.${signature}`;
}

export function verifyOpaquePostbackToken(token: string, secret: string, now = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !/^\d+$/.test(parts[1])) return false;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(body).digest("base64url").slice(0, 32);
  if (expected.length !== parts[2].length || !timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return false;
  return Number(parts[1]) > now;
}

export function selectMultiple(current: string[], option: string, max: number): string[] {
  const next = current.includes(option) ? current.filter((item) => item !== option) : [...current, option];
  if (next.length > max) throw new Error("選択数上限を超えています。");
  return next;
}

export function answerIsEligible(input: { status: string; expiresAt: string; allowMultipleResponses: boolean; hasPreviousResponse: boolean }): boolean {
  if (input.status !== "active" || Date.parse(input.expiresAt) <= Date.now()) return false;
  return input.allowMultipleResponses || !input.hasPreviousResponse;
}

export function surveyInputPriority(hasWaitingText: boolean, hasPostback: boolean): "free_text" | "postback" | "none" {
  if (hasWaitingText) return "free_text";
  if (hasPostback) return "postback";
  return "none";
}

import { createHmac, timingSafeEqual } from "node:crypto";

export function validateTrackingDestination(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("追跡先はHTTPS URLのみ許可します。");
  if (url.username || url.password) throw new Error("認証情報を含むURLは許可しません。");
  return url;
}

export function signRecipientToken(recipientId: string, expiresAt: number, secret: string): string {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(recipientId)) throw new Error("recipient token idが不正です。");
  const body = `${recipientId}.${expiresAt}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verifyRecipientToken(token: string, secret: string, now = Date.now()): string | null {
  const [recipientId, expires, signature] = token.split(".");
  if (!recipientId || !expires || !signature || Number(expires) <= now || !/^\d+$/.test(expires)) return null;
  const body = `${recipientId}.${expires}`;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  return recipientId;
}

export type AttributionType = "deterministic" | "estimated";
export function attributionLabel(type: AttributionType): string { return type === "deterministic" ? "決定的" : "推定"; }

export function csvHeaderInjectionSafe(value: string): string { return /^[=+\-@]/.test(value) ? `'${value}` : value; }

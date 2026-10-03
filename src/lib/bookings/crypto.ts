import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function encryptionKey(secret: string): Buffer {
  const decoded = Buffer.from(secret, "base64url");
  if (decoded.length !== 32) throw new Error("BOOKING_TOKEN_ENCRYPTION_KEY must be a 32-byte base64url value");
  return decoded;
}
export function encryptBookingSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptBookingSecret(value: string, secret: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Encrypted booking token is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export function signBookingState(payload: Record<string, unknown>, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyBookingState<T extends Record<string, unknown>>(value: string, secret: string): T {
  const [encoded, provided] = value.split(".");
  if (!encoded || !provided) throw new Error("OAuth state is invalid");
  const expected = createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(provided, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("OAuth state is invalid");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
}

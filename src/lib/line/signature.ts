import { createHmac, timingSafeEqual } from "node:crypto";

export function createLineSignature(rawBody: string, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
}

export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string
): boolean {
  if (!signature || !channelSecret) return false;

  const expected = Buffer.from(createLineSignature(rawBody, channelSecret), "utf8");
  const actual = Buffer.from(signature, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";

export const ACCEPTANCE_MAX_BODY_BYTES = 2048;
export const ACCEPTANCE_MIN_INTERVAL_MS = 10_000;
export const ACCEPTANCE_TIMEOUT_MS = 15_000;

let running = false;
let lastStartedAt = 0;

export function acceptanceRuntimeAllowed(): boolean {
  try {
    const env = getServerEnv();
    return process.env.VERCEL_ENV === "preview" && env.APP_ENV === "development" && env.LAUNCH_ACCEPTANCE_ENABLED;
  } catch {
    return false;
  }
}

export function safeTokenEqual(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function startAcceptanceRun(now = Date.now()): "started" | "busy" | "rate_limited" {
  if (running) return "busy";
  if (now - lastStartedAt < ACCEPTANCE_MIN_INTERVAL_MS) return "rate_limited";
  running = true;
  lastStartedAt = now;
  return "started";
}

export function finishAcceptanceRun(): void {
  running = false;
}

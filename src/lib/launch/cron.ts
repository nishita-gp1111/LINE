import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";

const SUPABASE_CRON_CONTEXT = "line-crm:supabase-cron:v1";

export function deriveSupabaseCronSecret(serviceRoleKey: string): string {
  return createHmac("sha256", serviceRoleKey).update(SUPABASE_CRON_CONTEXT, "utf8").digest("hex");
}

function cronCredential(): { secret?: string; mode: "explicit" | "derived" | "missing" } {
  const env = getServerEnv();
  if (env.CRON_SECRET) return { secret: env.CRON_SECRET, mode: "explicit" };
  if (env.APP_ENV === "production" && env.SCHEDULER_PROVIDER === "supabase_cron" && env.SUPABASE_SERVICE_ROLE_KEY) {
    return { secret: deriveSupabaseCronSecret(env.SUPABASE_SERVICE_ROLE_KEY), mode: "derived" };
  }
  return { mode: "missing" };
}

export function isCronAuthorized(request: Request): boolean {
  const { secret } = cronCredential();
  if (!secret) return false;
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBytes = Buffer.from(secret, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function publicLaunchStatus() {
  const env = getServerEnv();
  const credential = cronCredential();
  return {
    provider: env.SCHEDULER_PROVIDER,
    staleAfterMinutes: env.SCHEDULER_STALE_AFTER_MINUTES,
    cronSecretConfigured: Boolean(credential.secret),
    cronAuthMode: credential.mode,
    trackingSigningSecretConfigured: Boolean(env.TRACKING_SIGNING_SECRET),
    mediaBucket: env.LINE_MEDIA_BUCKET,
    hostingCommercialUseConfirmed: env.HOSTING_COMMERCIAL_USE_CONFIRMED
  };
}

import { getServerEnv } from "@/lib/env/server";

export function isCronAuthorized(request: Request): boolean {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export function publicLaunchStatus() {
  const env = getServerEnv();
  return {
    provider: env.SCHEDULER_PROVIDER,
    staleAfterMinutes: env.SCHEDULER_STALE_AFTER_MINUTES,
    cronSecretConfigured: Boolean(env.CRON_SECRET),
    trackingSigningSecretConfigured: Boolean(env.TRACKING_SIGNING_SECRET),
    mediaBucket: env.LINE_MEDIA_BUCKET,
    hostingCommercialUseConfirmed: env.HOSTING_COMMERCIAL_USE_CONFIRMED
  };
}

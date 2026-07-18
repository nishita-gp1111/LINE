import { AcquisitionLinksClient } from "@/app/admin/acquisition/acquisition-links-client";
import { getServerEnv } from "@/lib/env/server";

export default function AcquisitionPage() {
  const env = getServerEnv();
  const appUrl = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  const automaticTagging = Boolean(
    env.NEXT_PUBLIC_LIFF_ID &&
    env.LINE_LOGIN_CHANNEL_ID &&
    env.LINE_CHANNEL_ACCESS_TOKEN &&
    env.LINE_ORGANIZATION_ID &&
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY
  );
  return <AcquisitionLinksClient appUrl={appUrl} automaticTagging={automaticTagging} />;
}

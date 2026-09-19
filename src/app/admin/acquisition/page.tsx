import { AcquisitionLinksClient } from "@/app/admin/acquisition/acquisition-links-client";
import { getServerEnv } from "@/lib/env/server";
import { canAdminister, getInboxAuthContext } from "@/lib/inbox/auth";
import { getAssignmentSettings } from "@/lib/acquisition/assignment-store";

export default async function AcquisitionPage() {
  const auth = await getInboxAuthContext();
  if (!auth) return <main className="p-8">認証が必要です。</main>;
  const assignments = await getAssignmentSettings(auth.organizationId);
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
  return <AcquisitionLinksClient appUrl={appUrl} automaticTagging={automaticTagging} assignments={assignments} canManage={canAdminister(auth.role)} />;
}

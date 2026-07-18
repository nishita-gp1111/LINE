import { AcquisitionLinksClient } from "@/app/admin/acquisition/acquisition-links-client";
import { getServerEnv } from "@/lib/env/server";

export default function AcquisitionPage() {
  const appUrl = getServerEnv().NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  return <AcquisitionLinksClient appUrl={appUrl} />;
}

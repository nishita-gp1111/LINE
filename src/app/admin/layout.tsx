import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import { ensureInitialOrganization } from "@/lib/auth/organization";
import { AdminShell } from "@/components/admin-shell";
import { getServerEnv } from "@/lib/env/server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAuthenticatedUser();
  await ensureInitialOrganization(user);
  return <AdminShell userEmail={user.email || "管理者"} recipientMode={getServerEnv().LINE_RECIPIENT_MODE}>{children}</AdminShell>;
}

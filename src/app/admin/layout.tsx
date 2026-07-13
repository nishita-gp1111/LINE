import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import { ensureInitialOrganization } from "@/lib/auth/organization";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAuthenticatedUser();
  await ensureInitialOrganization(user);
  return children;
}

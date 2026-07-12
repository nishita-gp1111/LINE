import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAuthenticatedUser();
  return children;
}

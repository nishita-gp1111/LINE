import "server-only";

import { getInboxAuthContext } from "@/lib/inbox/auth";
import { getInboxStore } from "@/lib/inbox/store";

export async function getInboxData() {
  const auth = await getInboxAuthContext();
  if (!auth) return null;
  const store = getInboxStore(auth.organizationId);
  if (!store) return { auth, store: null };
  return { auth, store };
}

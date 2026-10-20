import { createHash } from "node:crypto";

// Only opaque change metadata leaves the server, never message text or LINE IDs.
export function inboxRevision(organizationId: string, profileId: string, changes: unknown): string {
  return createHash("sha256").update(JSON.stringify([organizationId, profileId, changes])).digest("hex");
}

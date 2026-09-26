import { NextResponse } from "next/server";
import { getInboxAuthContext } from "@/lib/inbox/auth";
import { getAuthMode } from "@/lib/auth/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getMockWebhookStore } from "@/lib/webhook/store";
import { encodeNotificationCursor, parseNotificationCursor, NOTIFICATION_PAGE_SIZE, type InboxNotification, type NotificationCursor } from "@/lib/notifications/inbox-feed";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const value = new URL(request.url).searchParams.get("after");
  const cursor = value ? parseNotificationCursor(value) : null;
  if (value && !cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400, headers });
  try {
    let items: InboxNotification[];
    if (getAuthMode() === "mock") {
      items = getMockWebhookStore().listInboundNotifications(auth.organizationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      items = cursor ? items.filter(item => item.createdAt > cursor.at || (item.createdAt === cursor.at && item.id > cursor.id)).slice(0, NOTIFICATION_PAGE_SIZE + 1) : items.slice(-1);
    } else {
      const client = createSupabaseAdminClient();
      if (!client) throw new Error("not_configured");
      let query = client.from("messages").select("id, conversation_id, contact_id, created_at, message_type")
        .eq("organization_id", auth.organizationId).eq("direction", "inbound").eq("status", "received")
        .is("deleted_at", null).not("conversation_id", "is", null);
      if (cursor) query = query.or(`created_at.gt.${cursor.at},and(created_at.eq.${cursor.at},id.gt.${cursor.id})`);
      const result = await query.order("created_at", { ascending: Boolean(cursor) }).order("id", { ascending: Boolean(cursor) }).limit(cursor ? NOTIFICATION_PAGE_SIZE + 1 : 1);
      if (result.error) throw new Error("query_failed");
      const rows = result.data || [];
      const contacts = cursor && rows.length ? await client.from("contacts").select("id, display_name").eq("organization_id", auth.organizationId).in("id", [...new Set(rows.map(row => String(row.contact_id)))]) : { data: [], error: null };
      if (contacts.error) throw new Error("query_failed");
      const names = new Map((contacts.data || []).map(contact => [String(contact.id), String(contact.display_name || "お客様")]));
      items = rows.map(row => ({ id: String(row.id), conversationId: String(row.conversation_id), createdAt: String(row.created_at), messageType: String(row.message_type), displayName: names.get(String(row.contact_id)) || "お客様" }));
    }
    const page = items.slice(0, NOTIFICATION_PAGE_SIZE);
    const last = page.at(-1);
    const next: NotificationCursor = last ? { at: last.createdAt, id: last.id } : cursor || { at: new Date().toISOString(), id: "00000000-0000-0000-0000-000000000000" };
    // The initial request establishes a baseline, never alerts for historical messages.
    return NextResponse.json({ items: cursor ? page : [], cursor: encodeNotificationCursor(next), hasMore: Boolean(cursor) && items.length > NOTIFICATION_PAGE_SIZE, scope: `${auth.organizationId}:${auth.profileId}` }, { headers });
  } catch {
    return NextResponse.json({ error: "新着情報を取得できませんでした。" }, { status: 503, headers });
  }
}

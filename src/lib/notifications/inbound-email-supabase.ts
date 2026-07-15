import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InboundEmailHistory,
  InboundEmailNotificationInput
} from "@/lib/notifications/inbound-email";

export class SupabaseInboundEmailHistory implements InboundEmailHistory {
  constructor(private readonly client: SupabaseClient) {}

  async hasEarlierInboundMessageWithinCooldown(
    input: InboundEmailNotificationInput,
    cooldownMinutes: number
  ): Promise<boolean> {
    if (cooldownMinutes <= 0) return false;
    const createdAt = Date.parse(input.createdAt);
    if (!Number.isFinite(createdAt)) throw new Error("受信メッセージ時刻が不正です。");
    const cutoff = new Date(createdAt - cooldownMinutes * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from("messages")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("contact_id", input.contactId)
      .eq("direction", "inbound")
      .gte("created_at", cutoff)
      .lt("created_at", input.createdAt)
      .limit(1);
    if (error) throw new Error("通知の連投抑制状態を確認できませんでした。");
    return Boolean(data?.length);
  }
}
